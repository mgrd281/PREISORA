//
//  Offer.swift
//  Domain — mirrors `Offer.yaml` and `Promotion.yaml`.
//
//  All intelligence fields (`isBest`, `freshness`, `effectivePrice`) are computed
//  SERVER-SIDE. The client renders them and never re-derives them (constitution §22).
//

import Foundation

/// Contract: `Offer` — the CURRENT price of a Product at a Store, or market-wide
/// when `storeId` is `null`.
struct Offer: Codable, Hashable, Identifiable {
    let id: String
    let productId: String
    /// Pricing is always per-market (§25).
    let retailerMarketId: String
    /// `null` for a market-wide uniform price.
    let storeId: String?
    /// Listed shelf price before promotion adjustment.
    let price: Money
    /// Normalized price per base quantity; `null` when the pack size is unknown.
    let unitPrice: Money?
    /// Base quantity `unitPrice` refers to ("1 l", "1 kg"); `null` when unknown.
    let unitPriceQuantityText: String?
    /// Server-computed best-offer marker. At most one `true` per response.
    let isBest: Bool
    /// Server-computed observation freshness class.
    let freshness: Freshness
    let observedAt: Date
    let validFrom: Date?
    let validUntil: Date?
    let promotion: Promotion?
    /// Server-computed promotion-adjusted price actually paid.
    let effectivePrice: Money
    /// Embedded store for store-specific offers with a query location; `null` for
    /// market-wide offers.
    let store: Store?
    /// Integer meters to the offer's store; `null` for market-wide offers.
    let distanceMeters: Int?

    init(
        id: String,
        productId: String,
        retailerMarketId: String,
        storeId: String?,
        price: Money,
        unitPrice: Money?,
        unitPriceQuantityText: String?,
        isBest: Bool,
        freshness: Freshness,
        observedAt: Date,
        validFrom: Date?,
        validUntil: Date?,
        promotion: Promotion?,
        effectivePrice: Money,
        store: Store?,
        distanceMeters: Int?
    ) {
        self.id = id
        self.productId = productId
        self.retailerMarketId = retailerMarketId
        self.storeId = storeId
        self.price = price
        self.unitPrice = unitPrice
        self.unitPriceQuantityText = unitPriceQuantityText
        self.isBest = isBest
        self.freshness = freshness
        self.observedAt = observedAt
        self.validFrom = validFrom
        self.validUntil = validUntil
        self.promotion = promotion
        self.effectivePrice = effectivePrice
        self.store = store
        self.distanceMeters = distanceMeters
    }

    /// True when the promotion actually moved the price. Presentation-only: the
    /// discount itself was decided server-side.
    var hasPriceReduction: Bool {
        effectivePrice.currencyCode == price.currencyCode
            && effectivePrice.amountMinor < price.amountMinor
    }
}

/// Contract: `Promotion` — a time-bounded price modifier attached to an Offer.
struct Promotion: Codable, Hashable, Identifiable {
    let id: String
    let type: PromotionType
    /// Percent discount (set when `type == .percentage`, otherwise `null`).
    let percentOff: Int?
    /// Absolute discount (set when `type == .absolute`, otherwise `null`).
    let amountOff: Money?
    let requiresLoyaltyCard: Bool
    let startsAt: Date?
    let endsAt: Date?

    init(
        id: String,
        type: PromotionType,
        percentOff: Int?,
        amountOff: Money?,
        requiresLoyaltyCard: Bool,
        startsAt: Date?,
        endsAt: Date?
    ) {
        self.id = id
        self.type = type
        self.percentOff = percentOff
        self.amountOff = amountOff
        self.requiresLoyaltyCard = requiresLoyaltyCard
        self.startsAt = startsAt
        self.endsAt = endsAt
    }
}
