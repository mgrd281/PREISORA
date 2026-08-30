//
//  VisionBarcodeScanner.swift
//  Services — `BarcodeScanning` on VisionKit's DataScannerViewController.
//
//  AVAILABILITY IS TWO QUESTIONS, both asked before the camera is offered:
//    • `DataScannerViewController.isSupported`  — the device can run the scanner
//      (false on the Simulator, false without the required hardware).
//    • `DataScannerViewController.isAvailable`  — right now (camera permission
//      granted, not restricted by Screen Time…).
//  When either is false, `makeScannerView` returns the seeded `DemoScannerView`
//  instead of a camera. Manual GTIN entry sits underneath the scanner surface in
//  every case, so the journey never depends on a camera being there.
//

import Foundation
import SwiftUI
import VisionKit
import Vision

struct VisionBarcodeScanner: BarcodeScanning {

    @MainActor
    var isLiveScanningAvailable: Bool {
        DataScannerViewController.isSupported && DataScannerViewController.isAvailable
    }

    /// Degrades to the seeded demo scanner instead of a dead panel, so the same
    /// service works on device and in the Simulator without the service graph having
    /// to know which one it is.
    @MainActor
    func makeScannerView(onScan: @escaping (String) -> Void) -> AnyView {
        guard isLiveScanningAvailable else {
            return AnyView(
                DemoScannerView(gtins: MockBarcodeScanner.demoGTINs, onScan: onScan)
            )
        }
        return AnyView(DataScannerRepresentable(onScan: onScan))
    }
}

/// UIViewControllerRepresentable wrapper around the system data scanner.
///
/// `@MainActor` is spelled out rather than left to conformance inference, so the
/// representable's members and the coordinator's isolation line up identically on
/// Xcode 15 and Xcode 16.
@MainActor
struct DataScannerRepresentable: UIViewControllerRepresentable {

    let onScan: (String) -> Void

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let controller = DataScannerViewController(
            recognizedDataTypes: [
                .barcode(symbologies: [
                    VNBarcodeSymbology.ean13,
                    VNBarcodeSymbology.ean8,
                    VNBarcodeSymbology.upce,
                    VNBarcodeSymbology.code128,
                    VNBarcodeSymbology.itf14
                ])
            ],
            qualityLevel: .balanced,
            recognizesMultipleItems: false,
            isHighFrameRateTrackingEnabled: false,
            isPinchToZoomEnabled: true,
            isGuidanceEnabled: true,
            isHighlightingEnabled: true
        )
        controller.delegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ uiViewController: DataScannerViewController, context: Context) {
        guard !context.coordinator.isScanning else { return }
        context.coordinator.isScanning = true
        try? uiViewController.startScanning()
    }

    // NOTE: `dismantleUIViewController` is deliberately NOT implemented. It is a
    // *static* protocol requirement whose actor isolation has moved between SDK
    // versions, and it buys nothing here: the sheet dismissal releases the
    // controller, which stops the capture session on deinit.

    func makeCoordinator() -> Coordinator {
        Coordinator(onScan: onScan)
    }

    /// The coordinator's own state (`onScan`, `isScanning`) is `@MainActor`, because
    /// that is where it is read and written from: `updateUIViewController` and the
    /// scan callback both end up touching view state.
    ///
    /// The DELEGATE METHODS are explicitly `nonisolated`. `DataScannerViewControllerDelegate`
    /// has moved between "no isolation" and "main-actor isolated" across SDK versions,
    /// and a `nonisolated` witness satisfies the requirement either way (the reverse —
    /// an isolated witness for a non-isolated requirement — does not). Each callback
    /// therefore extracts plain `String` payloads and hops to the main actor before
    /// anything main-actor-isolated is touched.
    @MainActor
    final class Coordinator: NSObject, DataScannerViewControllerDelegate {

        private let onScan: (String) -> Void
        var isScanning = false

        init(onScan: @escaping (String) -> Void) {
            self.onScan = onScan
        }

        nonisolated func dataScanner(
            _ dataScanner: DataScannerViewController,
            didAdd addedItems: [RecognizedItem],
            allItems: [RecognizedItem]
        ) {
            deliver(Coordinator.barcodePayloads(in: addedItems))
        }

        nonisolated func dataScanner(
            _ dataScanner: DataScannerViewController,
            didTapOn item: RecognizedItem
        ) {
            deliver(Coordinator.barcodePayloads(in: [item]))
        }

        /// `[String]` is `Sendable`, so the hop carries no VisionKit type across it.
        nonisolated private func deliver(_ payloads: [String]) {
            guard !payloads.isEmpty else { return }
            Task { @MainActor in
                self.forward(payloads)
            }
        }

        nonisolated private static func barcodePayloads(in items: [RecognizedItem]) -> [String] {
            var payloads: [String] = []
            for item in items {
                guard case .barcode(let barcode) = item else { continue }
                guard let payload = barcode.payloadStringValue, !payload.isEmpty else { continue }
                payloads.append(payload)
            }
            return payloads
        }

        private func forward(_ payloads: [String]) {
            for payload in payloads {
                onScan(payload)
            }
        }
    }
}

