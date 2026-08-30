//
//  AlertsView.swift
//  Features/Alerts — TYPED EMPTY STATE (phase 1).
//
//  STUBBED UI, FINAL MODEL: `PriceAlert` and the `/alerts` operations are fully
//  specified and implemented backend-side, and `AlertsViewModel` already loads them.
//  What is missing is the creation flow (target price + radius picker), which is why
//  this screen offers no "add" affordance yet.
//
//  Gated on `capabilities.priceAlerts` — the backend decides whether the section
//  exists at all (§16–17), the client never hardcodes it.
//

import SwiftUI
import Observation

@MainActor
@Observable
final class AlertsViewModel {

    private(set) var state: LoadState<[PriceAlert]> = .idle
    private(set) var capabilities: Capabilities = .allDisabled

    init() {}

    func load(services: AppServices) async {
        state = .loading
        capabilities = (try? await services.api.capabilities()) ?? .allDisabled

        guard capabilities.features.priceAlerts else {
            state = .loaded([])
            return
        }

        do {
            let page = try await services.api.alerts()
            state = .loaded(page.data)
        } catch {
            state = .failed(APIError.from(error))
        }
    }
}

@MainActor
struct AlertsView: View {

    @Environment(\.services) private var services
    @State private var viewModel = AlertsViewModel()

    var body: some View {
        content
            .background(Tokens.Color.backgroundPrimary)
            .navigationTitle(Text("tab.alerts"))
            .task {
                await viewModel.load(services: services)
            }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle, .loading:
            LoadingView()
        case .failed(let error):
            ScrollView {
                ErrorStateView(error: error) {
                    Task { await viewModel.load(services: services) }
                }
                .padding(Tokens.Spacing.md)
            }
        case .loaded(let alerts):
            if !viewModel.capabilities.features.priceAlerts {
                EmptyStateView(
                    systemImage: "bell.slash",
                    titleKey: "alerts.disabled.title",
                    messageKey: "alerts.disabled.message"
                )
            } else if alerts.isEmpty {
                EmptyStateView(
                    systemImage: "bell",
                    titleKey: "alerts.empty.title",
                    messageKey: "alerts.empty.message"
                )
            } else {
                List(alerts) { alert in
                    VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
                        PriceLabel(price: alert.targetPrice, size: .row)
                        Text(verbatim: DistanceFormatting.string(meters: alert.radiusMeters))
                            .font(Tokens.Typography.caption)
                            .foregroundStyle(Tokens.Color.textSecondary)
                    }
                    .listRowBackground(Tokens.Color.backgroundPrimary)
                }
                .listStyle(.plain)
            }
        }
    }
}
