//
//  APNSPushRegistrar.swift
//  Services — `PushRegistering` on UserNotifications + APNs.
//
//  STUBBED IN PHASE 1: permission and registration are real, and the resulting token
//  is POSTed to `/devices` (upserted server-side on (user, platform, pushToken)), but
//  the app carries no push entitlement yet — on a development build the system will
//  not hand back a usable token. The whole path is written so enabling it becomes a
//  provisioning change, not a code change. Delivery itself is backend-side
//  (constitution §10) and stubbed there too.
//

import Foundation
import UIKit
import UserNotifications
import os

/// Bridges the UIApplicationDelegate push callbacks (the only place APNs tokens
/// arrive) to whoever is waiting for them.
final class PushTokenBroker {

    static let shared = PushTokenBroker()

    private let lock = NSLock()
    private var latestToken: String?
    private var observer: ((String) -> Void)?

    private init() {}

    /// Called by the app delegate with the raw APNs token.
    func deliver(tokenData: Data) {
        let token = tokenData.map { String(format: "%02x", $0) }.joined()
        lock.lock()
        latestToken = token
        let observer = self.observer
        lock.unlock()
        observer?(token)
    }

    func observe(_ handler: @escaping (String) -> Void) {
        lock.lock()
        observer = handler
        let existing = latestToken
        lock.unlock()
        if let existing {
            handler(existing)
        }
    }
}

final class APNSPushRegistrar: PushRegistering {

    private let api: APIClient
    private let config: AppConfig
    private let logger = Logger(subsystem: "de.preisora.app", category: "Push")

    init(api: APIClient, config: AppConfig) {
        self.api = api
        self.config = config
    }

    func requestAuthorization() async -> Bool {
        do {
            return try await UNUserNotificationCenter.current()
                .requestAuthorization(options: [.alert, .badge, .sound])
        } catch {
            logger.error("Notification authorization failed: \(String(describing: error), privacy: .public)")
            return false
        }
    }

    @MainActor
    func registerForRemoteNotifications() {
        UIApplication.shared.registerForRemoteNotifications()
    }

    @discardableResult
    func submitDeviceToken(_ token: String) async throws -> Device {
        let request = DeviceRegisterRequest(
            platform: .ios,
            pushToken: token,
            appVersion: config.appVersion,
            locale: config.deviceLocaleIdentifier
        )
        return try await api.registerDevice(request)
    }

    /// Permission → system registration → device upload.
    ///
    /// Without a push entitlement the system will not hand back a usable token, so in
    /// this build the flow usually ends at `didFailToRegisterForRemoteNotifications`.
    /// Everything up to that point is real.
    func enablePushDelivery() async {
        let granted = await requestAuthorization()
        guard granted else {
            logger.info("Push permission not granted — skipping device registration")
            return
        }

        // The token arrives later, through the app delegate.
        PushTokenBroker.shared.observe { [weak self] token in
            guard let self else { return }
            Task {
                do {
                    let device = try await self.submitDeviceToken(token)
                    self.logger.info("Registered device \(device.id, privacy: .public)")
                } catch {
                    self.logger.error("Device registration failed: \(String(describing: error), privacy: .public)")
                }
            }
        }

        // `registerForRemoteNotifications()` is `@MainActor`; awaiting it directly is
        // the hop — no `MainActor.run` closure (and no capture) needed.
        await registerForRemoteNotifications()
    }
}
