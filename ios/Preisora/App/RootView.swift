//
//  RootView.swift
//  App — the tab shell and the ONE place `Route` becomes a destination.
//
//  Each tab owns a `NavigationStack` with its own path, and all three content tabs
//  register the same `navigationDestination(for: Route.self)` so a route pushed from
//  anywhere renders the same screen.
//

import SwiftUI

struct RootView: View {

    @Bindable var router: AppRouter

    var body: some View {
        TabView(selection: $router.selectedTab) {
            NavigationStack(path: $router.homePath) {
                HomeView(router: router)
                    .navigationDestination(for: Route.self) { route in
                        RouteDestination(route: route)
                    }
            }
            .tabItem {
                Label("tab.home", systemImage: "house")
            }
            .tag(AppTab.home)

            NavigationStack(path: $router.searchPath) {
                SearchView()
                    .navigationDestination(for: Route.self) { route in
                        RouteDestination(route: route)
                    }
            }
            .tabItem {
                Label("tab.search", systemImage: "magnifyingglass")
            }
            .tag(AppTab.search)

            NavigationStack(path: $router.favoritesPath) {
                FavoritesView()
                    .navigationDestination(for: Route.self) { route in
                        RouteDestination(route: route)
                    }
            }
            .tabItem {
                Label("tab.favorites", systemImage: "heart")
            }
            .tag(AppTab.favorites)

            NavigationStack {
                SettingsView()
            }
            .tabItem {
                Label("tab.settings", systemImage: "gearshape")
            }
            .tag(AppTab.settings)
        }
        .tint(Tokens.Color.accentPrimary)
    }
}

/// Maps a `Route` to its screen. Reserved deep links land on a graceful placeholder
/// instead of crashing (docs/deep-links.md).
struct RouteDestination: View {

    let route: Route

    var body: some View {
        switch route {
        case .product(let reference):
            ProductDetailView(reference: reference)
        case .store(let id):
            StoreDetailView(storeId: id)
        case .storesMap(let productId):
            StoresMapView(productId: productId)
        case .reservedDeepLink(let reserved):
            ReservedDeepLinkView(reserved: reserved)
        }
    }
}

/// Minimal store screen behind `https://preisora.de/store/{storeId}`.
struct StoreDetailView: View {

    @Environment(\.services) private var services
    let storeId: String

    @State private var state: LoadState<Store> = .idle

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                switch state {
                case .idle, .loading:
                    LoadingView()
                case .failed(let error):
                    ErrorStateView(error: error) {
                        Task { await load() }
                    }
                case .loaded(let store):
                    Text(store.name)
                        .font(Tokens.Typography.title)
                        .foregroundStyle(Tokens.Color.textPrimary)
                    Text(store.address.singleLine)
                        .font(Tokens.Typography.body)
                        .foregroundStyle(Tokens.Color.textSecondary)
                    if let distanceMeters = store.distanceMeters {
                        Text(DistanceFormatting.string(meters: distanceMeters))
                            .font(Tokens.Typography.caption)
                            .foregroundStyle(Tokens.Color.textSecondary)
                    }
                    if let hours = store.openingHours, !hours.isEmpty {
                        openingHours(hours)
                    }
                    Button {
                        services.maps.openDirections(to: store.coordinate, name: store.name)
                    } label: {
                        Label("stores.directions", systemImage: "arrow.triangle.turn.up.right.circle")
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Tokens.Color.accentPrimary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Tokens.Spacing.md)
        }
        .background(Tokens.Color.backgroundPrimary)
        .navigationTitle(Text("stores.detail_title"))
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await load()
        }
    }

    private func openingHours(_ hours: [OpeningHoursInterval]) -> some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
            Text("stores.opening_hours")
                .font(Tokens.Typography.headline)
                .foregroundStyle(Tokens.Color.textPrimary)
            ForEach(hours) { interval in
                HStack {
                    Text(L10n.string("weekday.\(interval.dayOfWeek)"))
                        .font(Tokens.Typography.caption)
                        .foregroundStyle(Tokens.Color.textSecondary)
                    Spacer()
                    Text(verbatim: "\(interval.opensAt) – \(interval.closesAt)")
                        .font(Tokens.Typography.caption.monospacedDigit())
                        .foregroundStyle(Tokens.Color.textPrimary)
                }
            }
        }
    }

    private func load() async {
        state = .loading
        do {
            state = .loaded(try await services.api.store(id: storeId))
        } catch {
            state = .failed(APIError.from(error))
        }
    }
}

/// Grammar that is fixed but not yet implemented — never a crash.
struct ReservedDeepLinkView: View {

    let reserved: ReservedDeepLink

    var body: some View {
        VStack(spacing: Tokens.Spacing.sm) {
            EmptyStateView(
                systemImage: "clock.badge.questionmark",
                titleKey: "deeplink.reserved.title",
                messageKey: "deeplink.reserved.message"
            )
            Text(verbatim: identifierText)
                .font(Tokens.Typography.caption.monospaced())
                .foregroundStyle(Tokens.Color.textSecondary)
        }
        .frame(maxHeight: .infinity)
        .background(Tokens.Color.backgroundPrimary)
        .navigationTitle(Text("deeplink.reserved.nav_title"))
        .navigationBarTitleDisplayMode(.inline)
    }

    private var identifierText: String {
        switch reserved {
        case .listInvite(let token): return "list-invite/\(token)"
        case .alert(let id): return "alert/\(id)"
        case .promotion(let id): return "promotion/\(id)"
        }
    }
}
