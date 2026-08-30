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
//  It is also the home of the DEMO MODE switch. Demo mode is decided once per
//  launch (`AppServices.live` builds the whole service graph from it), so the toggle
//  writes the flag and the app picks it up on the next start — the footnote says so,
//  and the section keeps showing what the CURRENT process is actually talking to.
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

    /// The persisted flag, which is what the NEXT launch will use. It can differ from
    /// `services.isDemoMode` (what this launch is using) until the app restarts.
    @State private var isDemoModeEnabled = DemoMode.isEnabled()

    /// Names of demo fixtures the bundle is missing. Empty is the healthy answer.
    @State private var missingFixtures: [String] = []

    var body: some View {
        List {
            if services.isDemoMode {
                Section {
                    DemoModeBanner()
                        .listRowInsets(EdgeInsets(
                            top: Tokens.Spacing.sm,
                            leading: Tokens.Spacing.md,
                            bottom: Tokens.Spacing.sm,
                            trailing: Tokens.Spacing.md
                        ))
                        .listRowBackground(Color.clear)
                }
            }
            demoSection
            backendSection
            featuresSection
            accountSection
            capabilitiesSection
            aboutSection
        }
        .listStyle(.insetGrouped)
        .navigationTitle(Text("tab.settings"))
        .task {
            missingFixtures = services.isDemoMode ? DemoBackend.missingFixtures() : []
            await viewModel.load(services: services)
        }
    }

    // MARK: - Sections

    /// The demo switch, plus an honest readout of what THIS launch is using.
    private var demoSection: some View {
        Section {
            Toggle(isOn: $isDemoModeEnabled) {
                Text("settings.demo_mode")
            }
            .tint(Tokens.Color.accentPrimary)
            .onChange(of: isDemoModeEnabled) { _, newValue in
                DemoMode.setEnabled(newValue)
            }

            LabeledContent {
                Text(services.isDemoMode
                     ? L10n.string("settings.demo_source_fixtures")
                     : services.config.displayBaseURL)
                    .font(Tokens.Typography.caption)
                    .foregroundStyle(Tokens.Color.textSecondary)
            } label: {
                Text("settings.demo_data_source")
            }

            if isDemoModeEnabled != services.isDemoMode {
                Label {
                    Text("settings.demo_restart_required")
                        .font(Tokens.Typography.caption)
                } icon: {
                    Image(systemName: "arrow.clockwise")
                }
                .foregroundStyle(Tokens.Color.warning)
            }

            // Only reachable if `Resources/DemoData/*.json` did not make it into the
            // build — surfaced here instead of leaving the app inexplicably empty.
            if !missingFixtures.isEmpty {
                Label {
                    Text(L10n.string(
                        "settings.demo_fixtures_missing",
                        missingFixtures.joined(separator: ", ")
                    ))
                    .font(Tokens.Typography.caption)
                } icon: {
                    Image(systemName: "exclamationmark.triangle")
                }
                .foregroundStyle(Tokens.Color.error)
            }
        } header: {
            Text("settings.section.demo")
        } footer: {
            Text(L10n.string("settings.demo_footer", services.config.displayBaseURL))
        }
    }

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


// MARK: - Demo indicator

/// The "this is not live data" banner.
///
/// It lives next to the switch that turns demo mode on, but it is a standalone view
/// on purpose: dropping `DemoModeBanner()` at the top of any screen (Home, for
/// instance) labels that screen's content as sample data. Show it only when
/// `services.isDemoMode` is true.
@MainActor
struct DemoModeBanner: View {

    var body: some View {
        HStack(alignment: .top, spacing: Tokens.Spacing.sm) {
            Image(systemName: "info.circle.fill")
                .foregroundStyle(Tokens.Color.accentPrimary)

            VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
                Text("demo.banner.title")
                    .font(Tokens.Typography.headline)
                    .foregroundStyle(Tokens.Color.textPrimary)
                Text("demo.banner.message")
                    .font(Tokens.Typography.caption)
                    .foregroundStyle(Tokens.Color.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 0)
        }
        .padding(Tokens.Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Tokens.Color.accentSubtle)
        .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.medium, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
