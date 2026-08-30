//
//  MockBarcodeScanner.swift
//  Services/Mocks — `BarcodeScanning` without a camera.
//
//  WHY IT EXISTS: `DataScannerViewController.isSupported` is false on the Simulator,
//  so the scan → product → prices journey would be untestable there. This scanner
//  renders tappable demo GTIN buttons instead of a viewfinder, which exercises the
//  exact same code path as a real detection.
//
//  THE GTINs BELOW MUST MATCH `backend/ npm run seed`. They are fictional DEMO codes
//  in the 4012345 range with valid GS1 check digits (so the client-side pre-flight
//  and the server-side validation both pass). If the seed changes, change this list —
//  ios/README.md says so too.
//

import Foundation
import SwiftUI

struct MockBarcodeScanner: BarcodeScanning {

    /// Fictional, checksum-valid demo GTINs — the first five `SEED_PRODUCTS` of
    /// `backend/src/seed/seed-data.ts`: milk, butter, nut-nougat cream, flour and
    /// free-range eggs.
    static let demoGTINs: [String] = [
        "4012345000016",
        "4012345000023",
        "4012345000030",
        "4012345000047",
        "4012345000054"
    ]

    /// There is no camera behind this scanner — reporting `false` keeps the
    /// `input_mode` analytics property and the Settings readout honest.
    @MainActor
    var isLiveScanningAvailable: Bool { false }

    @MainActor
    func makeScannerView(onScan: @escaping (String) -> Void) -> AnyView {
        AnyView(DemoScannerView(gtins: MockBarcodeScanner.demoGTINs, onScan: onScan))
    }
}

/// The scanner surface the app falls back to whenever live scanning cannot run
/// (Simulator, denied permission, unsupported hardware). Also used directly by
/// `MockBarcodeScanner` in previews and tests.
struct DemoScannerView: View {

    let gtins: [String]
    let onScan: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
            Text("scan.mock.title")
                .font(Tokens.Typography.headline)
                .foregroundStyle(Tokens.Color.textPrimary)

            Text("scan.mock.subtitle")
                .font(Tokens.Typography.caption)
                .foregroundStyle(Tokens.Color.textSecondary)

            ForEach(gtins, id: \.self) { gtin in
                Button {
                    onScan(gtin)
                } label: {
                    HStack(spacing: Tokens.Spacing.sm) {
                        Image(systemName: "barcode")
                        Text(verbatim: gtin)
                            .font(Tokens.Typography.body.monospacedDigit())
                        Spacer()
                        Image(systemName: "chevron.right")
                            .foregroundStyle(Tokens.Color.textSecondary)
                    }
                    .padding(Tokens.Spacing.md)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Tokens.Color.backgroundElevated)
                    .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.medium, style: .continuous))
                }
                .buttonStyle(.plain)
                .foregroundStyle(Tokens.Color.textPrimary)
            }

            Spacer(minLength: 0)
        }
        .padding(Tokens.Spacing.md)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Tokens.Color.backgroundSecondary)
    }
}
