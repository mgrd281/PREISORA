//
//  Route.swift
//  App — typed navigation + the canonical deep-link grammar (docs/deep-links.md).
//
//  Canonical patterns (platform-neutral; the same URLs will feed Android App Links):
//
//      https://preisora.de/product/{productId}
//      https://preisora.de/p/{slug}
//      https://preisora.de/store/{storeId}
//      https://preisora.de/list-invite/{token}     (reserved)
//      https://preisora.de/alert/{alertId}         (reserved)
//      https://preisora.de/promotion/{promotionId} (reserved)
//
//  Universal links (entitlement + AASA hosting) are DEFERRED until the production
//  domain is live. Until then the same grammar is reachable through the custom scheme
//  registered in project.yml — `preisora://product/{productId}` — so the parsing layer
//  is testable today and enabling universal links stays configuration, not code:
//
//      xcrun simctl openurl booted "preisora://product/<uuid>"
//
//  Reserved patterns are well-formed but not yet implemented: they route to a
//  graceful "coming soon" destination and MUST NOT crash (docs/deep-links.md).
//

import Foundation

/// The three ways a product can be addressed, mirroring the three lookup operations.
enum ProductReference: Hashable {
    /// `GET /products/{productId}`
    case id(String)
    /// `GET /products/by-gtin/{gtin}` — the scan funnel.
    case gtin(String)
    /// `GET /products/by-slug/{slug}`
    case slug(String)

    var debugIdentifier: String {
        switch self {
        case .id(let value): return value
        case .gtin(let value): return value
        case .slug(let value): return value
        }
    }
}

/// Deep-link grammar that is fixed but not yet implemented.
enum ReservedDeepLink: Hashable {
    case listInvite(token: String)
    case alert(id: String)
    case promotion(id: String)

    var linkType: DeepLinkType {
        switch self {
        case .listInvite: return .listInvite
        case .alert: return .alert
        case .promotion: return .promotion
        }
    }
}

/// Every push destination in the app.
enum Route: Hashable {
    case product(ProductReference)
    case store(id: String)
    /// Map of stores; scoped to one product's offers when `productId` is set.
    case storesMap(productId: String?)
    case reservedDeepLink(ReservedDeepLink)

    /// Canonical public host (docs/deep-links.md). Not the API host.
    static let canonicalHost = "preisora.de"
    /// Registered in project.yml so links are testable before universal links exist.
    static let customScheme = "preisora"

    // MARK: - Deep-link parsing

    /// Parses a canonical PREISORA URL. Returns `nil` for anything that is not one of
    /// the documented patterns — callers ignore those instead of failing.
    init?(deepLinkURL url: URL) {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return nil
        }
        let scheme = (components.scheme ?? "").lowercased()
        var segments: [String] = []

        if scheme == "https" || scheme == "http" {
            let host = (components.host ?? "").lowercased()
            guard host == Route.canonicalHost || host == "www.\(Route.canonicalHost)" else {
                return nil
            }
            segments = components.path.split(separator: "/").map(String.init)
        } else if scheme == Route.customScheme {
            // preisora://product/{id} — URLComponents puts "product" in `host`.
            if let host = components.host, !host.isEmpty {
                segments.append(host)
            }
            segments.append(contentsOf: components.path.split(separator: "/").map(String.init))
        } else {
            return nil
        }

        guard segments.count == 2 else { return nil }
        let resource = segments[0].lowercased()
        let rawIdentifier = segments[1]
        guard !rawIdentifier.isEmpty else { return nil }
        let identifier = rawIdentifier.removingPercentEncoding ?? rawIdentifier

        switch resource {
        case "product":
            self = .product(.id(identifier))
        case "p":
            self = .product(.slug(identifier))
        case "store":
            self = .store(id: identifier)
        case "list-invite":
            self = .reservedDeepLink(.listInvite(token: identifier))
        case "alert":
            self = .reservedDeepLink(.alert(id: identifier))
        case "promotion":
            self = .reservedDeepLink(.promotion(id: identifier))
        default:
            return nil
        }
    }

    /// The `link_type` property of the `deep_link_opened` event, or `nil` for routes
    /// that were not reached through a link.
    var deepLinkType: DeepLinkType? {
        switch self {
        case .product(let reference):
            switch reference {
            case .id: return .product
            case .slug: return .productSlug
            case .gtin: return nil
            }
        case .store:
            return .store
        case .storesMap:
            return nil
        case .reservedDeepLink(let reserved):
            return reserved.linkType
        }
    }
}
