//
//  OptimizationResult.swift
//  Domain — mirrors `OptimizationResult.yaml` (including its three inline objects).
//
//  Computed ONLY server-side (constitution §23). The client renders it.
//

import Foundation

/// Contract: `OptimizationResult`.
struct OptimizationResult: Codable, Hashable {
    let strategy: OptimizationStrategy
    /// Sum of all per-store subtotals.
    let totalPrice: Money
    /// Estimated amount saved versus the baseline single-store purchase.
    let estimatedSavings: Money
    /// Coarse confidence heuristic in [0, 1].
    let confidence: Double
    /// The stores to visit, each with its share of the list.
    let stores: [OptimizationStorePlan]
    /// List items no fresh offer in radius could satisfy.
    let unavailableItems: [UnavailableItem]

    init(
        strategy: OptimizationStrategy,
        totalPrice: Money,
        estimatedSavings: Money,
        confidence: Double,
        stores: [OptimizationStorePlan],
        unavailableItems: [UnavailableItem]
    ) {
        self.strategy = strategy
        self.totalPrice = totalPrice
        self.estimatedSavings = estimatedSavings
        self.confidence = confidence
        self.stores = stores
        self.unavailableItems = unavailableItems
    }
}

/// Contract: one entry of the inline `OptimizationResult.stores` array.
struct OptimizationStorePlan: Codable, Hashable, Identifiable {
    /// Store to visit, including `distanceMeters` from the query location.
    let store: Store
    let items: [OptimizationItem]
    /// Total for this store's items (quantity-weighted effective prices).
    let subtotal: Money

    init(store: Store, items: [OptimizationItem], subtotal: Money) {
        self.store = store
        self.items = items
        self.subtotal = subtotal
    }

    var id: String { store.id }
}

/// Contract: one entry of the inline `OptimizationResult.stores[].items` array.
struct OptimizationItem: Codable, Hashable, Identifiable {
    let productId: String
    let quantity: Int
    /// The Offer this item should be bought at.
    let offer: Offer

    init(productId: String, quantity: Int, offer: Offer) {
        self.productId = productId
        self.quantity = quantity
        self.offer = offer
    }

    var id: String { offer.id }
}

/// Contract: one entry of the inline `OptimizationResult.unavailableItems` array.
struct UnavailableItem: Codable, Hashable, Identifiable {
    let productId: String
    /// Machine-readable reason token, e.g. `no_fresh_offer_in_radius`.
    let reason: String

    init(productId: String, reason: String) {
        self.productId = productId
        self.reason = reason
    }

    var id: String { productId }
}
