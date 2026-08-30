//
//  Store.swift
//  Domain — mirrors `Store.yaml` (including its two inline object schemas).
//

import Foundation

/// Contract: `Store`. Platform-neutral — never a map-provider object (§9).
struct Store: Codable, Hashable, Identifiable {
    let id: String
    let retailerMarketId: String
    let name: String
    /// WGS-84 decimal degrees.
    let lat: Double
    /// WGS-84 decimal degrees.
    let lng: Double
    let address: Address
    /// Integer meters from the query location; `null` when the request had none.
    let distanceMeters: Int?
    /// `null` when unknown. A day may appear more than once (split hours).
    let openingHours: [OpeningHoursInterval]?

    init(
        id: String,
        retailerMarketId: String,
        name: String,
        lat: Double,
        lng: Double,
        address: Address,
        distanceMeters: Int?,
        openingHours: [OpeningHoursInterval]?
    ) {
        self.id = id
        self.retailerMarketId = retailerMarketId
        self.name = name
        self.lat = lat
        self.lng = lng
        self.address = address
        self.distanceMeters = distanceMeters
        self.openingHours = openingHours
    }

    var coordinate: Coordinate {
        Coordinate(latitude: lat, longitude: lng)
    }
}

/// Contract: the inline `Store.address` object.
/// (The schema declares it inline; the name is ours, the fields are the contract's.)
struct Address: Codable, Hashable {
    let street: String
    let postalCode: String
    let city: String
    let countryCode: String

    init(street: String, postalCode: String, city: String, countryCode: String) {
        self.street = street
        self.postalCode = postalCode
        self.city = city
        self.countryCode = countryCode
    }

    /// "Alexanderplatz 3, 10178 Berlin"
    var singleLine: String {
        "\(street), \(postalCode) \(city)"
    }
}

/// Contract: one entry of the inline `Store.openingHours` array.
struct OpeningHoursInterval: Codable, Hashable, Identifiable {
    /// ISO-8601 day of week (1 = Monday … 7 = Sunday).
    let dayOfWeek: Int
    /// Local opening time, 24h `HH:MM`.
    let opensAt: String
    /// Local closing time, 24h `HH:MM`.
    let closesAt: String

    init(dayOfWeek: Int, opensAt: String, closesAt: String) {
        self.dayOfWeek = dayOfWeek
        self.opensAt = opensAt
        self.closesAt = closesAt
    }

    /// Stable identity for SwiftUI lists — a day may legitimately repeat, so the
    /// interval itself is part of the id.
    var id: String {
        "\(dayOfWeek)-\(opensAt)-\(closesAt)"
    }
}
