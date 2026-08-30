//
//  HomeView.swift
//  Features/Home — scan CTA + recent scans.
//

import SwiftUI

@MainActor
struct HomeView: View {

    @Environment(\.services) private var services
    // Read from the environment (injected once in `PreisoraApp`) instead of being
    // stored as a `@Bindable` property; `body` makes the local `@Bindable` copy the
    // `.sheet(isPresented:)` binding needs.
    @Environment(AppRouter.self) private var router
    @State private var viewModel = HomeViewModel()
    /// Set by the scanner, consumed after the sheet has actually gone away.
    @State private var pendingGTIN: String?

    var body: some View {
        @Bindable var router = router
        return ScrollView {
            VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                scanCard
                backendCard
                recentSection
            }
            .padding(Tokens.Spacing.md)
        }
        .background(Tokens.Color.backgroundPrimary)
        .navigationTitle(Text("tab.home"))
        .onAppear {
            viewModel.refresh(services: services)
        }
        .task {
            await viewModel.probeBackend(services: services)
        }
        // Pushing while the sheet is still on screen can drop the navigation, so the
        // scan result is handed over in `onDismiss` instead.
        .sheet(
            isPresented: $router.isPresentingScanner,
            onDismiss: { handleScannerDismissed() }
        ) {
            ScanView { gtin in
                pendingGTIN = gtin
                router.isPresentingScanner = false
            }
        }
    }

    private func handleScannerDismissed() {
        guard let gtin = pendingGTIN else { return }
        pendingGTIN = nil
        router.push(.product(.gtin(gtin)), in: .home)
    }

    // MARK: - Sections

    private var scanCard: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
            Text("home.hero.title")
                .font(Tokens.Typography.title)
                .foregroundStyle(Tokens.Color.textPrimary)

            Text("home.hero.subtitle")
                .font(Tokens.Typography.body)
                .foregroundStyle(Tokens.Color.textSecondary)

            Button {
                services.analytics.track(
                    .scanStarted(
                        inputMode: services.scanner.isLiveScanningAvailable ? .camera : .manual
                    )
                )
                router.isPresentingScanner = true
            } label: {
                HStack(spacing: Tokens.Spacing.sm) {
                    Image(systemName: "barcode.viewfinder")
                    Text("home.scan_cta")
                        .font(Tokens.Typography.headline)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, Tokens.Spacing.sm)
            }
            .buttonStyle(.borderedProminent)
            .tint(Tokens.Color.accentPrimary)
        }
        .padding(Tokens.Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Tokens.Color.accentSubtle)
        .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.large, style: .continuous))
    }

    @ViewBuilder
    private var backendCard: some View {
        switch viewModel.backendStatus {
        case .idle, .loading:
            EmptyView()
        case .loaded(let health):
            Label {
                Text(L10n.string("home.backend_ok", health.version ?? "—"))
                    .font(Tokens.Typography.caption)
                    .foregroundStyle(Tokens.Color.textSecondary)
            } icon: {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(Tokens.Color.success)
            }
        case .failed:
            Label {
                Text("home.backend_unreachable")
                    .font(Tokens.Typography.caption)
                    .foregroundStyle(Tokens.Color.textSecondary)
            } icon: {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(Tokens.Color.warning)
            }
        }
    }

    @ViewBuilder
    private var recentSection: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.sm) {
            HStack {
                Text("home.recent.title")
                    .font(Tokens.Typography.title)
                    .foregroundStyle(Tokens.Color.textPrimary)
                Spacer()
                if !viewModel.recentScans.isEmpty {
                    Button("action.clear") {
                        viewModel.clearRecents(services: services)
                    }
                    .font(Tokens.Typography.caption)
                    .tint(Tokens.Color.accentPrimary)
                }
            }

            if viewModel.recentScans.isEmpty {
                EmptyStateView(
                    systemImage: "clock.arrow.circlepath",
                    titleKey: "home.recent.empty.title",
                    messageKey: "home.recent.empty.message"
                )
            } else {
                ForEach(viewModel.recentScans) { scan in
                    NavigationLink(value: Route.product(.gtin(scan.gtin))) {
                        recentRow(scan)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func recentRow(_ scan: RecentScan) -> some View {
        HStack(spacing: Tokens.Spacing.md) {
            Image(systemName: "barcode")
                .foregroundStyle(Tokens.Color.accentPrimary)
            VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
                Text(verbatim: scan.productName)
                    .font(Tokens.Typography.headline)
                    .foregroundStyle(Tokens.Color.textPrimary)
                Text(verbatim: scan.gtin)
                    .font(Tokens.Typography.caption.monospacedDigit())
                    .foregroundStyle(Tokens.Color.textSecondary)
            }
            Spacer()
            Text(verbatim: RelativeDateFormatting.string(for: scan.scannedAt))
                .font(Tokens.Typography.caption)
                .foregroundStyle(Tokens.Color.textSecondary)
        }
        .padding(Tokens.Spacing.md)
        .background(Tokens.Color.backgroundSecondary)
        .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.medium, style: .continuous))
    }
}
