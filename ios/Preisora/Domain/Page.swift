//
//  Page.swift
//  Domain — mirrors `PageInfo.yaml` and the `*Page` envelopes.
//
//  ADR-0002: every list response is `{ data: [...], pageInfo: {...} }`. The contract
//  models one `*Page` schema per resource; they are structurally identical, so the
//  client models them once as a generic envelope.
//

import Foundation

/// Contract: `PageInfo`.
struct PageInfo: Codable, Hashable {
    /// Opaque base64url cursor. Treated as a black box and passed back verbatim —
    /// never constructed or inspected here.
    let nextCursor: String?
    let hasMore: Bool

    init(nextCursor: String?, hasMore: Bool) {
        self.nextCursor = nextCursor
        self.hasMore = hasMore
    }

    /// The envelope radius-bounded geo lists always return in v1.
    static let single = PageInfo(nextCursor: nil, hasMore: false)
}

/// Generic Page envelope: `ProductPage`, `OfferPage`, `StorePage`, `RetailerPage`,
/// `FavoritePage`, `PriceAlertPage`, `ShoppingListPage`, `UserIdentityPage`.
struct Page<T: Decodable>: Decodable {
    let data: [T]
    let pageInfo: PageInfo

    init(data: [T], pageInfo: PageInfo) {
        self.data = data
        self.pageInfo = pageInfo
    }
}

extension Page: Equatable where T: Equatable {}
extension Page: Hashable where T: Hashable {}
