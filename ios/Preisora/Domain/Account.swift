//
//  Account.swift
//  Domain — mirrors `User.yaml`, `UserIdentity.yaml`, `UserPreferences.yaml`,
//  `Device.yaml`, `AuthTokens.yaml`, `Capabilities.yaml`.
//

import Foundation

/// Contract: `User` — `id` is the ONLY primary identity (constitution §11).
struct User: Codable, Hashable, Identifiable {
    let id: String
    /// `null` when no email identity is linked yet (anonymous-only account).
    let email: String?
    let displayName: String?
    /// Resolved home market.
    let countryCode: String
    /// BCP-47 locale used for localization precedence.
    let locale: String
    let createdAt: Date

    init(
        id: String,
        email: String?,
        displayName: String?,
        countryCode: String,
        locale: String,
        createdAt: Date
    ) {
        self.id = id
        self.email = email
        self.displayName = displayName
        self.countryCode = countryCode
        self.locale = locale
        self.createdAt = createdAt
    }

    var isAnonymous: Bool { email == nil }
}

/// Contract: `UserIdentity` — a linked sign-in method resolving to one User.
/// The identity-management operations are stubbed (501) in v1.0.0; the shape is final.
struct UserIdentity: Codable, Hashable, Identifiable {
    let id: String
    let provider: IdentityProvider
    /// Display-safe identifier at the provider; `null` for `anonymous`.
    let providerSubject: String?
    let createdAt: Date

    init(id: String, provider: IdentityProvider, providerSubject: String?, createdAt: Date) {
        self.id = id
        self.provider = provider
        self.providerSubject = providerSubject
        self.createdAt = createdAt
    }
}

/// Contract: `UserPreferences` — cross-device preferences (§12 sync seam).
/// The endpoints serving it answer 501 `FEATURE_NOT_AVAILABLE` in v1.0.0; the shape
/// is final, so this type ships now and needs no change when they light up.
struct UserPreferences: Codable, Hashable {
    /// Stores the user pinned; influences ranking and the optimizer.
    let preferredStoreIds: [String]
    /// Default radius in integer meters for offer/store queries.
    let searchRadiusMeters: Int
    /// Default range for the price-history view.
    let priceHistoryRange: PriceHistoryRange

    init(preferredStoreIds: [String], searchRadiusMeters: Int, priceHistoryRange: PriceHistoryRange) {
        self.preferredStoreIds = preferredStoreIds
        self.searchRadiusMeters = searchRadiusMeters
        self.priceHistoryRange = priceHistoryRange
    }
}

/// Contract: `Device` — upserted on the natural key (user, platform, pushToken).
struct Device: Codable, Hashable, Identifiable {
    let id: String
    let platform: DevicePlatform
    /// Opaque platform push token (APNs device token / FCM registration token).
    let pushToken: String
    let appVersion: String
    let locale: String
    let createdAt: Date
    let lastSeenAt: Date

    init(
        id: String,
        platform: DevicePlatform,
        pushToken: String,
        appVersion: String,
        locale: String,
        createdAt: Date,
        lastSeenAt: Date
    ) {
        self.id = id
        self.platform = platform
        self.pushToken = pushToken
        self.appVersion = appVersion
        self.locale = locale
        self.createdAt = createdAt
        self.lastSeenAt = lastSeenAt
    }
}

/// Contract: `AuthTokens` — issued by every successful auth operation.
struct AuthTokens: Codable, Hashable {
    /// Short-lived JWT bearer token for the `Authorization` header.
    let accessToken: String
    /// Long-lived opaque token exchanged at `POST /auth/refresh`. Single-use.
    let refreshToken: String
    /// Access-token lifetime in seconds from the moment of issuance.
    let expiresIn: Int

    init(accessToken: String, refreshToken: String, expiresIn: Int) {
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.expiresIn = expiresIn
    }
}

/// Contract: `Capabilities` — backend-declared feature availability (§16–17).
/// Clients gate UI sections on these flags and never hardcode availability.
struct Capabilities: Codable, Hashable {
    let features: Features

    init(features: Features) {
        self.features = features
    }

    /// Contract: the inline `Capabilities.features` object.
    ///
    /// Decoded defensively (`decodeIfPresent ?? false`): the catalog of flags is
    /// allowed to grow additively, and a missing flag must degrade to "feature off"
    /// rather than fail the whole response.
    struct Features: Codable, Hashable {
        let priceHistory: Bool
        let priceAlerts: Bool
        let shoppingOptimizer: Bool
        let receiptScanner: Bool
        let visualProductScan: Bool

        init(
            priceHistory: Bool,
            priceAlerts: Bool,
            shoppingOptimizer: Bool,
            receiptScanner: Bool,
            visualProductScan: Bool
        ) {
            self.priceHistory = priceHistory
            self.priceAlerts = priceAlerts
            self.shoppingOptimizer = shoppingOptimizer
            self.receiptScanner = receiptScanner
            self.visualProductScan = visualProductScan
        }

        enum CodingKeys: String, CodingKey {
            case priceHistory
            case priceAlerts
            case shoppingOptimizer
            case receiptScanner
            case visualProductScan
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            self.priceHistory = try container.decodeIfPresent(Bool.self, forKey: .priceHistory) ?? false
            self.priceAlerts = try container.decodeIfPresent(Bool.self, forKey: .priceAlerts) ?? false
            self.shoppingOptimizer = try container.decodeIfPresent(Bool.self, forKey: .shoppingOptimizer) ?? false
            self.receiptScanner = try container.decodeIfPresent(Bool.self, forKey: .receiptScanner) ?? false
            self.visualProductScan = try container.decodeIfPresent(Bool.self, forKey: .visualProductScan) ?? false
        }
    }

    /// Everything off — the safe assumption before `/capabilities` has answered.
    static let allDisabled = Capabilities(
        features: Features(
            priceHistory: false,
            priceAlerts: false,
            shoppingOptimizer: false,
            receiptScanner: false,
            visualProductScan: false
        )
    )
}

/// Response shape of `GET /health` (inline schema in the contract).
struct HealthStatus: Codable, Hashable {
    let status: String
    let timestamp: Date
    /// Deployed backend version, when available.
    let version: String?

    init(status: String, timestamp: Date, version: String?) {
        self.status = status
        self.timestamp = timestamp
        self.version = version
    }

    var isHealthy: Bool { status == "ok" }
}
