//
//  APIEndpoint.swift
//  Networking — every operation this client speaks, plus the ones it models.
//
//  Endpoint naming follows orchestrator decision #4: explicit lookup prefixes
//  (`/products/by-gtin/{gtin}`) instead of overloaded parameters. Paths are
//  kebab-case with camelCase template parameters (CONVENTIONS.md).
//
//  Identifiers substituted into paths are UUIDs, digit-only GTINs or
//  `^[a-z0-9]+(-[a-z0-9]+)*$` slugs — all path-safe by construction, which is why
//  no extra percent-encoding happens here.
//

import Foundation

enum HTTPMethod: String {
    case get = "GET"
    case post = "POST"
    case patch = "PATCH"
    case delete = "DELETE"
}

enum APIEndpoint {

    // MARK: Anonymous (catalog + price intelligence)

    case health
    case capabilities
    case productById(productId: String)
    case productByGTIN(gtin: String)
    case productBySlug(slug: String)
    case productOffers(productId: String, coordinate: Coordinate, radiusMeters: Int)
    case productPriceHistory(productId: String, range: PriceHistoryRange)
    case stores(coordinate: Coordinate, radiusMeters: Int)
    case storeById(storeId: String)
    case retailers
    case retailerById(retailerId: String)
    case searchProducts(query: String, cursor: String?, limit: Int?)

    // MARK: Auth (anonymous)

    case anonymousSession
    case refreshSession(RefreshRequest)

    // MARK: User-scoped (bearer)

    case currentUser
    case favorites(cursor: String?, limit: Int?)
    case addFavorite(FavoriteCreateRequest)
    case removeFavorite(productId: String)
    case alerts
    case createAlert(AlertCreateRequest)
    case deleteAlert(alertId: String)
    case shoppingLists
    case createShoppingList(ShoppingListCreateRequest)
    case shoppingList(listId: String)
    case addShoppingListItem(listId: String, ShoppingListItemCreateRequest)
    case optimizeShoppingList(listId: String, OptimizeRequest)
    case registerDevice(DeviceRegisterRequest)

    // MARK: - Request shape

    var method: HTTPMethod {
        switch self {
        case .health, .capabilities, .productById, .productByGTIN, .productBySlug,
             .productOffers, .productPriceHistory, .stores, .storeById, .retailers,
             .retailerById, .searchProducts, .currentUser, .favorites, .alerts,
             .shoppingLists, .shoppingList:
            return .get
        case .anonymousSession, .refreshSession, .addFavorite, .createAlert,
             .createShoppingList, .addShoppingListItem, .optimizeShoppingList,
             .registerDevice:
            return .post
        case .removeFavorite, .deleteAlert:
            return .delete
        }
    }

    /// Path relative to the configured base URL (which already ends in `/api/v1`).
    /// No leading slash — it is appended as a path component.
    var path: String {
        switch self {
        case .health:
            return "health"
        case .capabilities:
            return "capabilities"
        case .productById(let productId):
            return "products/\(productId)"
        case .productByGTIN(let gtin):
            return "products/by-gtin/\(gtin)"
        case .productBySlug(let slug):
            return "products/by-slug/\(slug)"
        case .productOffers(let productId, _, _):
            return "products/\(productId)/offers"
        case .productPriceHistory(let productId, _):
            return "products/\(productId)/price-history"
        case .stores:
            return "stores"
        case .storeById(let storeId):
            return "stores/\(storeId)"
        case .retailers:
            return "retailers"
        case .retailerById(let retailerId):
            return "retailers/\(retailerId)"
        case .searchProducts:
            return "search/products"
        case .anonymousSession:
            return "auth/anonymous"
        case .refreshSession:
            return "auth/refresh"
        case .currentUser:
            return "users/me"
        case .favorites:
            return "favorites"
        case .addFavorite:
            return "favorites"
        case .removeFavorite(let productId):
            return "favorites/\(productId)"
        case .alerts:
            return "alerts"
        case .createAlert:
            return "alerts"
        case .deleteAlert(let alertId):
            return "alerts/\(alertId)"
        case .shoppingLists:
            return "shopping-lists"
        case .createShoppingList:
            return "shopping-lists"
        case .shoppingList(let listId):
            return "shopping-lists/\(listId)"
        case .addShoppingListItem(let listId, _):
            return "shopping-lists/\(listId)/items"
        case .optimizeShoppingList(let listId, _):
            return "shopping-lists/\(listId)/optimize"
        case .registerDevice:
            return "devices"
        }
    }

    var queryItems: [URLQueryItem] {
        switch self {
        case .productOffers(_, let coordinate, let radiusMeters):
            return APIEndpoint.geoQueryItems(coordinate: coordinate, radiusMeters: radiusMeters)
        case .stores(let coordinate, let radiusMeters):
            return APIEndpoint.geoQueryItems(coordinate: coordinate, radiusMeters: radiusMeters)
        case .productPriceHistory(_, let range):
            return [URLQueryItem(name: "range", value: range.wireValue)]
        case .searchProducts(let query, let cursor, let limit):
            var items = [URLQueryItem(name: "q", value: query)]
            if let cursor, !cursor.isEmpty {
                items.append(URLQueryItem(name: "cursor", value: cursor))
            }
            if let limit {
                items.append(URLQueryItem(name: "limit", value: String(limit)))
            }
            return items
        case .favorites(let cursor, let limit):
            var items: [URLQueryItem] = []
            if let cursor, !cursor.isEmpty {
                items.append(URLQueryItem(name: "cursor", value: cursor))
            }
            if let limit {
                items.append(URLQueryItem(name: "limit", value: String(limit)))
            }
            return items
        default:
            return []
        }
    }

    /// Bearer JWT is required for everything user-scoped; catalog reads and the token
    /// exchanges are anonymous (CONVENTIONS.md, "Security model").
    var requiresAuthentication: Bool {
        switch self {
        case .health, .capabilities, .productById, .productByGTIN, .productBySlug,
             .productOffers, .productPriceHistory, .stores, .storeById, .retailers,
             .retailerById, .searchProducts, .anonymousSession, .refreshSession:
            return false
        case .currentUser, .favorites, .addFavorite, .removeFavorite, .alerts,
             .createAlert, .deleteAlert, .shoppingLists, .createShoppingList,
             .shoppingList, .addShoppingListItem, .optimizeShoppingList, .registerDevice:
            return true
        }
    }

    /// JSON body, encoded with the shared encoder. `nil` for bodyless requests
    /// (`POST /auth/anonymous` deliberately has no body).
    func makeBody(encoder: JSONEncoder) throws -> Data? {
        switch self {
        case .refreshSession(let payload):
            return try encoder.encode(payload)
        case .addFavorite(let payload):
            return try encoder.encode(payload)
        case .createAlert(let payload):
            return try encoder.encode(payload)
        case .createShoppingList(let payload):
            return try encoder.encode(payload)
        case .addShoppingListItem(_, let payload):
            return try encoder.encode(payload)
        case .optimizeShoppingList(_, let payload):
            return try encoder.encode(payload)
        case .registerDevice(let payload):
            return try encoder.encode(payload)
        default:
            return nil
        }
    }

    /// Builds the absolute URL against the configured base.
    func url(baseURL: URL) -> URL? {
        let full = baseURL.appendingPathComponent(path)
        guard var components = URLComponents(url: full, resolvingAgainstBaseURL: false) else {
            return nil
        }
        let items = queryItems
        if !items.isEmpty {
            components.queryItems = items
        }
        return components.url
    }

    // MARK: - Helpers

    /// Geo units are ALWAYS integer meters (CONVENTIONS.md); coordinates are the one
    /// place decimals are correct.
    private static func geoQueryItems(coordinate: Coordinate, radiusMeters: Int) -> [URLQueryItem] {
        [
            URLQueryItem(name: "lat", value: String(format: "%.6f", coordinate.latitude)),
            URLQueryItem(name: "lng", value: String(format: "%.6f", coordinate.longitude)),
            URLQueryItem(name: "radiusMeters", value: String(radiusMeters))
        ]
    }
}
