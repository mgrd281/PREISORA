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

    /// Deliberately NOT `@MainActor`-annotated: VisionKit delivers these callbacks on
    /// the main thread, and a non-isolated conformance satisfies the delegate whether
    /// or not the SDK declares it main-actor-isolated. The call site hops to the main
    /// actor before touching view-model state.
    final class Coordinator: NSObject, DataScannerViewControllerDelegate {

        private let onScan: (String) -> Void
        var isScanning = false

        init(onScan: @escaping (String) -> Void) {
            self.onScan = onScan
        }

        func dataScanner(
            _ dataScanner: DataScannerViewController,
            didAdd addedItems: [RecognizedItem],
            allItems: [RecognizedItem]
        ) {
            forward(addedItems)
        }

        func dataScanner(
            _ dataScanner: DataScannerViewController,
            didTapOn item: RecognizedItem
        ) {
            forward([item])
        }

        private func forward(_ items: [RecognizedItem]) {
            for item in items {
                guard case .barcode(let barcode) = item else { continue }
                guard let payload = barcode.payloadStringValue, !payload.isEmpty else { continue }
                onScan(payload)
            }
        }
    }
}

