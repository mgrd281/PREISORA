//
//  AppServices.swift
//  App — dependency injection, one struct, no container framework.
//
//  Every platform capability (constitution §6) is reached through this struct of
//  protocol existentials, handed down through a custom `EnvironmentKey`. Features
//  never construct a service and never import VisionKit/CoreLocation/MapKit.
//
//  All service implementations are deliberately NON-isolated, so this struct can be
//  built in any context — including the environment's static default value.
//

import Foundation
import SwiftUI

struct AppServices {

    let config: AppConfig
    let api: APIClient
    let scanner: any BarcodeScanning
    let location: any LocationProviding
    let maps: any MapsProviding
    let push: any PushRegistering
    let secureStore: any SecureStoring
    let analytics: any AnalyticsTracking
    let images: any ImageLoading
    let sharing: any Sharing
    let recentScans: RecentScansStore
    /// True when `api` is wired to the bundled fixtures instead of a backend.
    /// Read by Settings and by the demo banner — never by networking code, which
    /// cannot tell the difference and must not try.
    let isDemoMode: Bool

    init(
        config: AppConfig,
        api: APIClient,
        scanner: any BarcodeScanning,
        location: any LocationProviding,
        maps: any MapsProviding,
        push: any PushRegistering,
        secureStore: any SecureStoring,
        analytics: any AnalyticsTracking,
        images: any ImageLoading,
        sharing: any Sharing,
        recentScans: RecentScansStore,
        isDemoMode: Bool = false
    ) {
        self.config = config
        self.api = api
        self.scanner = scanner
        self.location = location
        self.maps = maps
        self.push = push
        self.secureStore = secureStore
        self.analytics = analytics
        self.images = images
        self.sharing = sharing
        self.recentScans = recentScans
        self.isDemoMode = isDemoMode
    }

    /// The real graph. Built once in `PreisoraApp`.
    ///
    /// `VisionBarcodeScanner` is always installed; it decides per presentation whether
    /// to show the camera or the seeded demo surface. Availability is a main-actor
    /// question (`DataScannerViewController` is a main-actor type), and this factory
    /// is deliberately non-isolated so it can run anywhere — so the choice belongs
    /// inside the scanner, not here.
    ///
    /// DEMO MODE (`DemoMode.isEnabled`, ON by default on a fresh install) swaps
    /// exactly two things and nothing else:
    ///   • the `URLSession` handed to `APIClient` — `DemoBackend.makeSession()`
    ///     answers every request from `Resources/DemoData/*.json`, so the client,
    ///     its headers, its decoder, the anonymous-auth bootstrap and the whole
    ///     `APIError` path still run for real;
    ///   • the secure store — demo tokens live in memory only, so they can never be
    ///     mistaken for a real session or outlive the process.
    /// Every other service is the same object it is in live mode.
    static func live(
        config: AppConfig = .resolve(),
        isDemoMode: Bool = DemoMode.isEnabled()
    ) -> AppServices {
        let secureStore: any SecureStoring = isDemoMode
            ? InMemorySecureStorage()
            : KeychainSecureStorage()
        let api = isDemoMode
            ? APIClient(config: config, secureStore: secureStore, urlSession: DemoBackend.makeSession())
            : APIClient(config: config, secureStore: secureStore)

        return AppServices(
            config: config,
            api: api,
            scanner: VisionBarcodeScanner(),
            location: CoreLocationService(),
            maps: MapKitService(),
            push: APNSPushRegistrar(api: api, config: config),
            secureStore: secureStore,
            analytics: ConsoleAnalyticsTracker(config: config),
            images: AsyncImageLoader(),
            sharing: ShareLinkService(),
            recentScans: RecentScansStore(),
            isDemoMode: isDemoMode
        )
    }

    /// Inert graph for SwiftUI previews and as the environment default. It still
    /// points at a real `APIClient` (so previews exercise the app's own networking
    /// code) but stores nothing and tracks nothing. Its session is the DEMO one, so
    /// previews render the bundled fixtures instead of failing against a backend
    /// that is not running — `isDemoMode` is `true` here for the same reason.
    static let preview: AppServices = {
        let config = AppConfig(
            apiBaseURL: URL(string: AppConfig.defaultBaseURLString)!,
            appVersion: "1.0.0",
            buildNumber: "1",
            acceptLanguage: "de-DE",
            deviceLocaleIdentifier: "de-DE",
            countryCode: "DE"
        )
        let secureStore = InMemorySecureStorage()
        return AppServices(
            config: config,
            api: APIClient(
                config: config,
                secureStore: secureStore,
                urlSession: DemoBackend.makeSession()
            ),
            scanner: MockBarcodeScanner(),
            location: MockLocationProvider(),
            maps: MockMapsService(),
            push: MockPushRegistrar(),
            secureStore: secureStore,
            analytics: RecordingAnalyticsTracker(),
            images: MockImageLoader(),
            sharing: ShareLinkService(),
            recentScans: RecentScansStore(),
            isDemoMode: true
        )
    }()
}

// MARK: - Environment plumbing

private struct AppServicesEnvironmentKey: EnvironmentKey {
    static let defaultValue: AppServices = AppServices.preview
}

extension EnvironmentValues {
    /// `@Environment(\.services) private var services`
    var services: AppServices {
        get { self[AppServicesEnvironmentKey.self] }
        set { self[AppServicesEnvironmentKey.self] = newValue }
    }
}
