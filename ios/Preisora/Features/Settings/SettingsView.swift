//
//  SettingsView.swift
//  Features/Settings — where the app points, what the backend allows, who you are.
//
//  "Sign in with Apple" is a DISABLED PLACEHOLDER: the contract's `/auth/oauth`
//  operation is `x-preisora-status: stubbed` (501 `FEATURE_NOT_AVAILABLE`) and the
//  app carries no Sign-in-with-Apple capability yet. It is shown disabled rather than
//  hidden so the shape of the account model (§11: linked identities, not a primary
//  Apple ID) is visible from day one.
//

import SwiftUI
import Observation

@MainActor
@Observable
final class SettingsViewModel {

    private(set) var capabilities: LoadState<Capabilities> = .idle
    private(set) var user: LoadState<User> = .idle

    init() {}

    func load(services: AppServices) async {
        capabilities = .loading
        do {
            capabilities = .loaded(try await services.api.capabilities())
        } catch {
            capabilities = .failed(APIError.from(error))
        }

        user = .loading
        do {
            user = .loaded(try await services.api.currentUser())
        } catch {
            user = .failed(APIError.from(error))
        }
    }
}

@MainActor
struct SettingsView: View {

    @Environment(\.services) private var services
    @State private var viewModel = SettingsViewModel()

    var body: some View {
        List {
            backendSection
            featuresSection
            accountSection
            capabilitiesSection
            aboutSection
        }
        .listStyle(.insetGrouped)
        .navigationTitle(Text("tab.settings"))
        .task {
            await viewModel.load(services: services)
        }
    }

    // MARK: - Sections

    private var backendSection: some View {
        Section {
            LabeledContent {
                Text(services.config.displayBaseURL)
                    .font(Tokens.Typography.caption)
                    .foregroundStyle(Tokens.Color.textSecondary)
                    .textSelection(.enabled)
            } label: {
                Text("settings.backend_url")
            }

            LabeledContent {
                Text(AppConfig.baseURLEnvironmentKey)
                    .font(Tokens.Typography.caption.monospaced())
                    .foregroundStyle(Tokens.Color.textSecondary)
            } label: {
                Text("settings.backend_env_var")
            }
        } header: {
            Text("settings.section.backend")
        } footer: {
            Text("settings.backend_footer")
        }
    }

    /// Alerts and Shopping lists are typed empty states in phase 1, so they live here
    /// rather than occupying a tab of their own.
    private var featuresSection: some View {
        Section {
            NavigationLink {
                AlertsView()
            } label: {
                Label("tab.alerts", systemImage: "bell")
            }
            NavigationLink {
                ShoppingListsView()
            } label: {
                Label("tab.lists", systemImage: "list.bullet.rectangle")
            }
        } header: {
            Text("settings.section.features")
        }
    }

    @ViewBuilder
    private var accountSection: some View {
        Section {
            switch viewModel.user {
            case .idle, .loading:
                ProgressView()
            case .failed:
                Text("settings.account_unavailable")
                    .font(Tokens.Typography.caption)
                    .foregroundStyle(Tokens.Color.textSecondary)
            case .loaded(let user):
                LabeledContent {
                    Text(user.isAnonymous
                         ? L10n.string("settings.account_anonymous")
                         : (user.email ?? ""))
                        .font(Tokens.Typography.caption)
                        .foregroundStyle(Tokens.Color.textSecondary)
                } label: {
                    Text("settings.account")
                }
                LabeledContent {
                    Text(verbatim: "\(user.countryCode) · \(user.locale)")
                        .font(Tokens.Typography.caption)
                        .foregroundStyle(Tokens.Color.textSecondary)
                } label: {
                    Text("settings.market")
                }
            }

            Button {
                // Intentionally unreachable: the button is disabled.
            } label: {
                Label("settings.sign_in_apple", systemImage: "apple.logo")
            }
            .disabled(true)

            Text("settings.sign_in_apple_hint")
                .font(Tokens.Typography.caption)
                .foregroundStyle(Tokens.Color.textSecondary)

            Button {
                Task { await services.push.enablePushDelivery() }
            } label: {
                Label("settings.enable_push", systemImage: "bell.badge")
            }

            Text("settings.enable_push_hint")
                .font(Tokens.Typography.caption)
                .foregroundStyle(Tokens.Color.textSecondary)
        } header: {
            Text("settings.section.account")
        }
    }

    @ViewBuilder
    private var capabilitiesSection: some View {
        Section {
            switch viewModel.capabilities {
            case .idle, .loading:
                ProgressView()
            case .failed(let error):
                ErrorStateView(error: error) {
                    Task { await viewModel.load(services: services) }
                }
            case .loaded(let capabilities):
                capabilityRow("capability.price_history", capabilities.features.priceHistory)
                capabilityRow("capability.price_alerts", capabilities.features.priceAlerts)
                capabilityRow("capability.shopping_optimizer", capabilities.features.shoppingOptimizer)
                capabilityRow("capability.receipt_scanner", capabilities.features.receiptScanner)
                capabilityRow("capability.visual_product_scan", capabilities.features.visualProductScan)
            }
        } header: {
            Text("settings.section.capabilities")
        } footer: {
            Text("settings.capabilities_footer")
        }
    }

    private var aboutSection: some View {
        Section {
            LabeledContent {
                Text(verbatim: "\(services.config.appVersion) (\(services.config.buildNumber))")
                    .font(Tokens.Typography.caption.monospacedDigit())
                    .foregroundStyle(Tokens.Color.textSecondary)
            } label: {
                Text("settings.app_version")
            }
            LabeledContent {
                Text(Tokens.version)
                    .font(Tokens.Typography.caption.monospacedDigit())
                    .foregroundStyle(Tokens.Color.textSecondary)
            } label: {
                Text("settings.tokens_version")
            }
            LabeledContent {
                Text(services.scanner.isLiveScanningAvailable
                     ? L10n.string("settings.scanner_camera")
                     : L10n.string("settings.scanner_mock"))
                    .font(Tokens.Typography.caption)
                    .foregroundStyle(Tokens.Color.textSecondary)
            } label: {
                Text("settings.scanner")
            }
        } header: {
            Text("settings.section.about")
        }
    }

    private func capabilityRow(_ titleKey: String, _ isEnabled: Bool) -> some View {
        LabeledContent {
            Image(systemName: isEnabled ? "checkmark.circle.fill" : "xmark.circle")
                .foregroundStyle(isEnabled ? Tokens.Color.success : Tokens.Color.textSecondary)
        } label: {
            Text(L10n.string(titleKey))
        }
    }
}
