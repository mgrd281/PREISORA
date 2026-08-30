//
//  ServiceProtocols.swift
//  Services — the EIGHT platform abstractions of constitution §6.
//
//      BarcodeScanning · LocationProviding · MapsProviding · PushRegistering
//      SecureStoring   · AnalyticsTracking · ImageLoading   · Sharing
//
//  Feature code depends on these protocols only. The iOS implementations
//  (VisionKit, CoreLocation, MapKit, APNs, Keychain, os.Logger, URLSession,
//  ShareLink) live beside this file; the Android app will implement the same eight
//  concepts with CameraX / FusedLocation / Google Maps / FCM / Keystore.
//
//  Rules honoured here:
//   • No platform type crosses a protocol boundary — coordinates are `Coordinate`,
//     locations are the contract's `Location`, never CLLocation / CLLocationCoordinate2D.
//   • Only members that must touch UIKit are `@MainActor`; the conforming types stay
//     non-isolated so services can be constructed anywhere (including previews).
//

import Foundation
import SwiftUI

// MARK: - 1. BarcodeScanning

/// Live barcode capture. The recognized payload is a raw string; GTIN normalization
/// and checksum pre-flight happen in the feature layer (`GTINValidator`), and the
/// server remains the authority.
protocol BarcodeScanning {
    /// Whether live camera scanning can actually run here (false on the Simulator and
    /// on devices without the required capability). Drives the manual-entry fallback
    /// and the `input_mode` analytics property.
    ///
    /// `@MainActor` because the answer comes from UIKit-side state on iOS
    /// (`DataScannerViewController` is a main-actor type); the conforming types
    /// themselves stay non-isolated so the service graph can be built anywhere.
    @MainActor var isLiveScanningAvailable: Bool { get }

    /// A platform scanner surface. `onScan` is called for every recognized payload;
    /// the caller is responsible for debouncing/dismissing.
    @MainActor func makeScannerView(onScan: @escaping (String) -> Void) -> AnyView
}

// MARK: - 2. LocationProviding

/// Coarse authorization state, platform-neutral.
enum LocationAuthorization: Hashable {
    case notDetermined
    case denied
    case restricted
    case authorized

    var isUsable: Bool { self == .authorized }
}

/// One-shot location access. Output is the contract's generic `Location` (§8).
protocol LocationProviding {
    var authorization: LocationAuthorization { get }

    /// Asks the system for When-In-Use permission (no-op if already decided).
    func requestAuthorization()

    /// Best available current location, or `nil` when unavailable/denied/timed out.
    /// Callers fall back to `Coordinate.berlinFallback` — never to a hardcoded
    /// country default in business logic.
    func currentLocation() async -> Location?
}

// MARK: - 3. MapsProviding

/// Handing a destination to the platform maps app.
protocol MapsProviding {
    /// Opens turn-by-turn directions to a store in the system maps application.
    @MainActor func openDirections(to coordinate: Coordinate, name: String)
}

// MARK: - 4. PushRegistering

/// Push registration (constitution §10). The wire model is `Device`
/// (`platform: ios | android`) — never an APNs-specific shape.
protocol PushRegistering {
    /// Asks the user for notification permission. Returns whether push is authorized.
    func requestAuthorization() async -> Bool

    /// Asks the system for a push token. The token arrives asynchronously via the
    /// app delegate and is forwarded to `submitDeviceToken(_:)`.
    @MainActor func registerForRemoteNotifications()

    /// Uploads a platform push token to `POST /devices` (upserted server-side on
    /// (user, platform, pushToken)).
    @discardableResult
    func submitDeviceToken(_ token: String) async throws -> Device

    /// The whole flow in one call: permission → system registration → device upload.
    /// Never throws — push is an enhancement, not a blocker.
    func enablePushDelivery() async
}

// MARK: - 5. SecureStoring

/// Small secret storage. iOS: Keychain. Android: Keystore-backed storage.
protocol SecureStoring {
    func string(forKey key: String) throws -> String?
    func setString(_ value: String, forKey key: String) throws
    func removeValue(forKey key: String) throws
}

// MARK: - 6. AnalyticsTracking

/// Event tracking. Implementations attach the common properties
/// (`platform`, `app_version`, `locale`, `country_code`) CENTRALLY —
/// call sites never pass them (docs/analytics-taxonomy.md).
protocol AnalyticsTracking {
    func track(_ event: AnalyticsEvent)
}

// MARK: - 7. ImageLoading

/// Remote image fetching. Returns raw bytes so the protocol stays platform-neutral;
/// the SwiftUI `RemoteImage` component turns them into a `UIImage`.
protocol ImageLoading {
    func imageData(for url: URL) async throws -> Data
}

// MARK: - 8. Sharing

/// Canonical deep-link construction for share sheets (docs/deep-links.md).
/// Building the URL is platform-neutral; presenting the share sheet is SwiftUI's
/// `ShareLink` at the call site.
protocol Sharing {
    func productURL(id: String) -> URL
    func productURL(slug: String) -> URL
    func storeURL(id: String) -> URL
}
