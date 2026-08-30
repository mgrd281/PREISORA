//
//  OpenEnums.swift
//  Domain — string enums that tolerate values the contract may add later.
//
//  CONVENTIONS.md, "Evolution policy": *Clients MUST ignore unknown response fields
//  and tolerate unknown enum values in responses.* Every wire enum therefore decodes
//  into a closed set of known cases PLUS an `.unknown(String)` carrier — decoding an
//  unrecognized value must never throw and never crash.
//
//  Each type deliberately spells out `init(from:)`/`encode(to:)` instead of sharing a
//  protocol default, so the Codable conformance is obvious at the point of use.
//

import Foundation

/// Contract: `Offer.freshness` — `fresh | aging | stale`.
enum Freshness: Codable, Hashable {
    case fresh
    case aging
    case stale
    case unknown(String)

    init(wireValue: String) {
        switch wireValue {
        case "fresh": self = .fresh
        case "aging": self = .aging
        case "stale": self = .stale
        default: self = .unknown(wireValue)
        }
    }

    var wireValue: String {
        switch self {
        case .fresh: return "fresh"
        case .aging: return "aging"
        case .stale: return "stale"
        case .unknown(let value): return value
        }
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        self.init(wireValue: try container.decode(String.self))
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(wireValue)
    }
}

/// Contract: `Promotion.type` — `percentage | absolute | multibuy | loyalty`.
enum PromotionType: Codable, Hashable {
    case percentage
    case absolute
    case multibuy
    case loyalty
    case unknown(String)

    init(wireValue: String) {
        switch wireValue {
        case "percentage": self = .percentage
        case "absolute": self = .absolute
        case "multibuy": self = .multibuy
        case "loyalty": self = .loyalty
        default: self = .unknown(wireValue)
        }
    }

    var wireValue: String {
        switch self {
        case .percentage: return "percentage"
        case .absolute: return "absolute"
        case .multibuy: return "multibuy"
        case .loyalty: return "loyalty"
        case .unknown(let value): return value
        }
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        self.init(wireValue: try container.decode(String.self))
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(wireValue)
    }
}

/// Contract: `PriceHistory.range` / `UserPreferences.priceHistoryRange` — `7d | 30d | 90d`.
///
/// This one has no `.unknown` carrier on purpose: it drives a segmented picker, so an
/// unrecognized future range degrades to the default (`30d`) instead of rendering a
/// selectable value the UI cannot request. Decoding still never throws.
enum PriceHistoryRange: Codable, Hashable, CaseIterable {
    case sevenDays
    case thirtyDays
    case ninetyDays

    init(wireValue: String) {
        switch wireValue {
        case "7d": self = .sevenDays
        case "30d": self = .thirtyDays
        case "90d": self = .ninetyDays
        default: self = .thirtyDays
        }
    }

    var wireValue: String {
        switch self {
        case .sevenDays: return "7d"
        case .thirtyDays: return "30d"
        case .ninetyDays: return "90d"
        }
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        self.init(wireValue: try container.decode(String.self))
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(wireValue)
    }
}

/// Contract: `OptimizationResult.strategy` / `OptimizeRequest.strategy`.
/// `balanced` is specified but answers 501 `FEATURE_NOT_AVAILABLE` today.
enum OptimizationStrategy: Codable, Hashable {
    case cheapestTotal
    case fewestStores
    case balanced
    case unknown(String)

    init(wireValue: String) {
        switch wireValue {
        case "cheapest_total": self = .cheapestTotal
        case "fewest_stores": self = .fewestStores
        case "balanced": self = .balanced
        default: self = .unknown(wireValue)
        }
    }

    var wireValue: String {
        switch self {
        case .cheapestTotal: return "cheapest_total"
        case .fewestStores: return "fewest_stores"
        case .balanced: return "balanced"
        case .unknown(let value): return value
        }
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        self.init(wireValue: try container.decode(String.self))
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(wireValue)
    }
}

/// Contract: `Device.platform` / `DeviceRegisterRequest.platform` — `ios | android`.
enum DevicePlatform: Codable, Hashable {
    case ios
    case android
    case unknown(String)

    init(wireValue: String) {
        switch wireValue {
        case "ios": self = .ios
        case "android": self = .android
        default: self = .unknown(wireValue)
        }
    }

    var wireValue: String {
        switch self {
        case .ios: return "ios"
        case .android: return "android"
        case .unknown(let value): return value
        }
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        self.init(wireValue: try container.decode(String.self))
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(wireValue)
    }
}

/// Contract: `UserIdentity.provider` — `anonymous | email | apple | google`.
enum IdentityProvider: Codable, Hashable {
    case anonymous
    case email
    case apple
    case google
    case unknown(String)

    init(wireValue: String) {
        switch wireValue {
        case "anonymous": self = .anonymous
        case "email": self = .email
        case "apple": self = .apple
        case "google": self = .google
        default: self = .unknown(wireValue)
        }
    }

    var wireValue: String {
        switch self {
        case .anonymous: return "anonymous"
        case .email: return "email"
        case .apple: return "apple"
        case .google: return "google"
        case .unknown(let value): return value
        }
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        self.init(wireValue: try container.decode(String.self))
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(wireValue)
    }
}
