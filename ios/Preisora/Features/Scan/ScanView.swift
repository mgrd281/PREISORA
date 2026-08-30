//
//  ScanView.swift
//  Features/Scan — camera (device) or seeded mock scanner (Simulator), always with
//  manual GTIN entry underneath.
//

import SwiftUI

@MainActor
struct ScanView: View {

    @Environment(\.services) private var services
    @Environment(\.dismiss) private var dismiss

    /// Called with a normalized, checksum-valid GTIN.
    let onGTIN: (String) -> Void

    @State private var viewModel = ScanViewModel()
    @FocusState private var isManualFieldFocused: Bool

    init(onGTIN: @escaping (String) -> Void) {
        self.onGTIN = onGTIN
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                scannerSurface
                    .frame(maxWidth: .infinity)
                    .frame(height: 320)
                    .clipShape(
                        RoundedRectangle(cornerRadius: Tokens.Radius.large, style: .continuous)
                    )
                    .padding(Tokens.Spacing.md)

                manualEntrySection

                Spacer(minLength: 0)
            }
            .background(Tokens.Color.backgroundPrimary)
            .navigationTitle(Text("scan.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("action.cancel") {
                        dismiss()
                    }
                }
            }
            .onAppear {
                viewModel.trackOpened(services: services)
            }
        }
    }

    // MARK: - Sections

    private var scannerSurface: some View {
        services.scanner.makeScannerView { payload in
            // The scanner delivers on the main thread, but hop explicitly so the
            // main-actor view model is never touched from an unknown context.
            Task { @MainActor in
                if let gtin = viewModel.handleScannedPayload(payload, services: services) {
                    onGTIN(gtin)
                }
            }
        }
    }

    private var manualEntrySection: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.sm) {
            Text("scan.manual.title")
                .font(Tokens.Typography.headline)
                .foregroundStyle(Tokens.Color.textPrimary)

            Text("scan.manual.hint")
                .font(Tokens.Typography.caption)
                .foregroundStyle(Tokens.Color.textSecondary)

            HStack(spacing: Tokens.Spacing.sm) {
                TextField("scan.manual.placeholder", text: $viewModel.manualEntry)
                    .keyboardType(.numberPad)
                    .textContentType(.none)
                    .autocorrectionDisabled(true)
                    .font(Tokens.Typography.body.monospacedDigit())
                    .focused($isManualFieldFocused)
                    .padding(Tokens.Spacing.sm)
                    .background(Tokens.Color.backgroundSecondary)
                    .clipShape(
                        RoundedRectangle(cornerRadius: Tokens.Radius.small, style: .continuous)
                    )

                Button {
                    submitManual()
                } label: {
                    Text("action.lookup")
                        .font(Tokens.Typography.headline)
                }
                .buttonStyle(.borderedProminent)
                .tint(Tokens.Color.accentPrimary)
                .disabled(!viewModel.isManualEntryValid)
            }

            if let key = viewModel.validationMessageKey {
                Text(L10n.string(key))
                    .font(Tokens.Typography.caption)
                    .foregroundStyle(Tokens.Color.error)
            }
        }
        .padding(Tokens.Spacing.md)
    }

    private func submitManual() {
        isManualFieldFocused = false
        if let gtin = viewModel.submitManualEntry(services: services) {
            onGTIN(gtin)
        }
    }
}
