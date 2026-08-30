//
//  PriceHistory.swift
//  Domain — mirrors `PriceHistory.yaml` (and `PriceObservation.yaml`).
//

import Foundation

/// Contract: `PriceHistory` — daily min/avg aggregates computed server-side.
struct PriceHistory: Codable, Hashable {
    let productId: String
    let range: PriceHistoryRange
    /// One entry per calendar day (UTC) that had at least one observation, ascending.
    let points: [PriceHistoryPoint]

    init(productId: String, range: PriceHistoryRange, points: [PriceHistoryPoint]) {
        self.productId = productId
        self.range = range
        self.points = points
    }

    var lowestPoint: PriceHistoryPoint? {
        points.min { $0.minAmountMinor < $1.minAmountMinor }
    }

    var highestPoint: PriceHistoryPoint? {
        points.max { $0.minAmountMinor < $1.minAmountMinor }
    }
}

/// Contract: one entry of the inline `PriceHistory.points` array.
///
/// `date` stays a `String` on purpose: it is a calendar `date` (`2026-08-29`), not an
/// RFC 3339 instant, so it must not go through the client's ISO-8601 date strategy.
struct PriceHistoryPoint: Codable, Hashable, Identifiable {
    let date: String
    let minAmountMinor: Int
    let avgAmountMinor: Int
    let currencyCode: String

    init(date: String, minAmountMinor: Int, avgAmountMinor: Int, currencyCode: String) {
        self.date = date
        self.minAmountMinor = minAmountMinor
        self.avgAmountMinor = avgAmountMinor
        self.currencyCode = currencyCode
    }

    var id: String { date }

    var minPrice: Money {
        Money(amountMinor: minAmountMinor, currencyCode: currencyCode)
    }

    var averagePrice: Money {
        Money(amountMinor: avgAmountMinor, currencyCode: currencyCode)
    }

    /// The calendar day as a `Date` (UTC midnight), or `nil` if the server sent
    /// something unexpected.
    var calendarDate: Date? {
        PriceHistoryPoint.dayFormatter.date(from: date)
    }

    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()
}

/// Contract: `PriceObservation` — canonical vocabulary shipped ahead of any endpoint.
///
/// No v1.0.0 operation returns raw observations (history is served pre-aggregated), so
/// this type is currently unused by `APIClient`. It exists so the observations
/// endpoint, when it ships, is purely additive here too (CONVENTIONS.md).
struct PriceObservation: Codable, Hashable, Identifiable {
    let id: String
    let productId: String
    let retailerMarketId: String
    /// `null` for a market-wide observation.
    let storeId: String?
    let price: Money
    let observedAt: Date

    init(
        id: String,
        productId: String,
        retailerMarketId: String,
        storeId: String?,
        price: Money,
        observedAt: Date
    ) {
        self.id = id
        self.productId = productId
        self.retailerMarketId = retailerMarketId
        self.storeId = storeId
        self.price = price
        self.observedAt = observedAt
    }
}
