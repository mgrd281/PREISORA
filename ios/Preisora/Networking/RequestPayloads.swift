//
//  RequestPayloads.swift
//  Networking — mirrors the contract's `*Request` schemas.
//
//  Only the payloads this app actually sends are modelled; the shapes match the
//  contract exactly so activating an endpoint later is additive.
//

import Foundation

/// Contract: `RefreshRequest`.
struct RefreshRequest: Encodable {
    let refreshToken: String
}

/// Contract: `FavoriteCreateRequest`.
struct FavoriteCreateRequest: Encodable {
    let productId: String
}

/// Contract: `AlertCreateRequest`.
/// `radiusMeters` and `isActive` carry server defaults (5000 / true) and are optional.
struct AlertCreateRequest: Encodable {
    let productId: String
    let targetPrice: Money
    let radiusMeters: Int?
    /// The client's generic `Location` model (constitution §8).
    let location: Location
    let isActive: Bool?
}

/// Contract: `DeviceRegisterRequest`. Upserted on (user, platform, pushToken).
struct DeviceRegisterRequest: Encodable {
    let platform: DevicePlatform
    let pushToken: String
    let appVersion: String
    let locale: String
}

/// Contract: `ShoppingListCreateRequest`.
struct ShoppingListCreateRequest: Encodable {
    let name: String
}

/// Contract: `ShoppingListItemCreateRequest`.
struct ShoppingListItemCreateRequest: Encodable {
    let productId: String
    let quantity: Int?
    let note: String?
}

/// Contract: `OptimizeRequest`. `lat`/`lng` are required — omitting them is
/// 400 `LOCATION_REQUIRED` at runtime.
struct OptimizeRequest: Encodable {
    let strategy: OptimizationStrategy?
    let lat: Double
    let lng: Double
    let radiusMeters: Int?
}
