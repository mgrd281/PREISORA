//
//  AppRouter.swift
//  App — tab selection + one navigation path per tab.
//
//  Deep links always land in the Home tab: it is the only tab whose stack can show
//  every destination, so an incoming link never depends on where the user was.
//

import Foundation
import Observation

enum AppTab: Hashable {
    case home
    case search
    case favorites
    case settings
}

@MainActor
@Observable
final class AppRouter {

    var selectedTab: AppTab = .home
    var homePath: [Route] = []
    var searchPath: [Route] = []
    var favoritesPath: [Route] = []

    /// True while the scan sheet is presented (Home CTA).
    var isPresentingScanner: Bool = false

    init() {}

    // MARK: - Programmatic navigation

    func push(_ route: Route, in tab: AppTab) {
        switch tab {
        case .home:
            homePath.append(route)
        case .search:
            searchPath.append(route)
        case .favorites:
            favoritesPath.append(route)
        case .settings:
            // Settings is a leaf tab; anything pushed from it belongs on Home.
            selectedTab = .home
            homePath.append(route)
        }
    }

    func pushOnCurrentTab(_ route: Route) {
        push(route, in: selectedTab)
    }

    // MARK: - Deep links

    /// Handles an incoming URL. Unknown-but-well-formed patterns are ignored rather
    /// than crashing (docs/deep-links.md).
    @discardableResult
    func handle(deepLink url: URL, analytics: any AnalyticsTracking) -> Bool {
        guard let route = Route(deepLinkURL: url) else {
            return false
        }
        if let linkType = route.deepLinkType {
            analytics.track(.deepLinkOpened(linkType: linkType))
        }
        selectedTab = .home
        isPresentingScanner = false
        homePath = [route]
        return true
    }
}
