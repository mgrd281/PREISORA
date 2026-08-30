//
//  PreisoraApp.swift
//  App — entry point: builds the service graph, injects it, handles deep links.
//

import SwiftUI
import UIKit
import os

@main
struct PreisoraApp: App {

    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    @State private var services = AppServices.live()
    @State private var router = AppRouter()

    private let logger = Logger(subsystem: "de.preisora.app", category: "App")

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(\.services, services)
                // The router travels through the environment (iOS 17 `Observable`
                // injection) instead of being passed down as a view property.
                .environment(router)
                .task {
                    // Anonymous-first: get a session before the user taps anything
                    // user-scoped, so favoriting feels instant (§11).
                    do {
                        try await services.api.ensureSession()
                    } catch {
                        logger.info("Anonymous session bootstrap deferred: \(String(describing: error), privacy: .public)")
                    }
                }
                .onOpenURL { url in
                    let handled = router.handle(deepLink: url, analytics: services.analytics)
                    if !handled {
                        logger.info("Ignoring unrecognized URL: \(url.absoluteString, privacy: .public)")
                    }
                }
        }
    }
}

/// The only reason an app delegate exists: APNs device tokens are delivered nowhere
/// else. Everything it receives is forwarded to `PushTokenBroker`.
final class AppDelegate: NSObject, UIApplicationDelegate {

    private let logger = Logger(subsystem: "de.preisora.app", category: "AppDelegate")

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        PushTokenBroker.shared.deliver(tokenData: deviceToken)
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        // Expected until a push entitlement exists — see APNSPushRegistrar.
        logger.info("Remote notification registration failed: \(String(describing: error), privacy: .public)")
    }
}
