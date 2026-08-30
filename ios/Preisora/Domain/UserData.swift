//
//  UserData.swift
//  Domain — mirrors `Favorite.yaml`, `PriceAlert.yaml`, `ShoppingList.yaml`,
//  `ShoppingListItem.yaml`.
//

import Foundation

/// Contract: `Favorite` — unique per (user, product); the Product is embedded so list
/// screens render without extra lookups.
struct Favorite: Codable, Hashable, Identifiable {
    let id: String
    let productId: String
    let product: Product
    let createdAt: Date

    init(id: String, productId: String, product: Product, createdAt: Date) {
        self.id = id
        self.productId = productId
        self.product = product
        self.createdAt = createdAt
    }
}

/// Contract: `PriceAlert` — evaluated by the ONE backend alert engine (§10),
/// never client-side.
struct PriceAlert: Codable, Hashable, Identifiable {
    let id: String
    let productId: String
    let targetPrice: Money
    /// Evaluation radius in integer meters.
    let radiusMeters: Int
    /// Anchor point the radius is evaluated around.
    let location: GeoPoint
    /// Inactive alerts are kept but not evaluated.
    let isActive: Bool
    let createdAt: Date
    /// `null` if never triggered.
    let lastTriggeredAt: Date?

    init(
        id: String,
        productId: String,
        targetPrice: Money,
        radiusMeters: Int,
        location: GeoPoint,
        isActive: Bool,
        createdAt: Date,
        lastTriggeredAt: Date?
    ) {
        self.id = id
        self.productId = productId
        self.targetPrice = targetPrice
        self.radiusMeters = radiusMeters
        self.location = location
        self.isActive = isActive
        self.createdAt = createdAt
        self.lastTriggeredAt = lastTriggeredAt
    }
}

/// Contract: `ShoppingList`.
struct ShoppingList: Codable, Hashable, Identifiable {
    let id: String
    let name: String
    let items: [ShoppingListItem]
    let createdAt: Date
    let updatedAt: Date

    init(id: String, name: String, items: [ShoppingListItem], createdAt: Date, updatedAt: Date) {
        self.id = id
        self.name = name
        self.items = items
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

/// Contract: `ShoppingListItem`.
struct ShoppingListItem: Codable, Hashable, Identifiable {
    let id: String
    let productId: String
    /// How many units the user intends to buy.
    let quantity: Int
    /// Free-form user note, or `null`.
    let note: String?

    init(id: String, productId: String, quantity: Int, note: String?) {
        self.id = id
        self.productId = productId
        self.quantity = quantity
        self.note = note
    }
}
