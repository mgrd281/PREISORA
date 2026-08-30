//
//  Retailer.swift
//  Domain — mirrors `Retailer.yaml`, `RetailerMarket.yaml`, `RetailerWithMarkets.yaml`.
//

import Foundation

/// Contract: `Retailer` — exactly `{id, name, slug}`.
struct Retailer: Codable, Hashable, Identifiable {
    let id: String
    let name: String
    let slug: String

    init(id: String, name: String, slug: String) {
        self.id = id
        self.name = name
        self.slug = slug
    }
}

/// Contract: `RetailerMarket` — a Retailer's presence in one country (§25).
struct RetailerMarket: Codable, Hashable, Identifiable {
    let id: String
    let retailerId: String
    let countryCode: String
    /// ISO-4217 currency all of this market's offers are priced in.
    let currencyCode: String
    /// Market-localized display name clients render for offers/stores.
    let displayName: String

    init(
        id: String,
        retailerId: String,
        countryCode: String,
        currencyCode: String,
        displayName: String
    ) {
        self.id = id
        self.retailerId = retailerId
        self.countryCode = countryCode
        self.currencyCode = currencyCode
        self.displayName = displayName
    }
}

/// Contract: `RetailerWithMarkets` — `allOf: [Retailer, {markets}]`.
/// The composition is flattened here because the wire payload is a single flat object.
struct RetailerWithMarkets: Codable, Hashable, Identifiable {
    let id: String
    let name: String
    let slug: String
    let markets: [RetailerMarket]

    init(id: String, name: String, slug: String, markets: [RetailerMarket]) {
        self.id = id
        self.name = name
        self.slug = slug
        self.markets = markets
    }

    var retailer: Retailer {
        Retailer(id: id, name: name, slug: slug)
    }

    /// The market a given `retailerMarketId` (carried by every Offer/Store) refers to.
    func market(withId marketId: String) -> RetailerMarket? {
        markets.first { $0.id == marketId }
    }
}
