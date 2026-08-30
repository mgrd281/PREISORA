//
//  APIClient.swift
//  Networking — the single door to the platform-neutral backend.
//
//  Responsibilities:
//   • URLSession async/await transport, one shared JSON decoder/encoder.
//   • Context headers on EVERY request: `Accept-Language`, `X-App-Platform: ios`,
//     `X-App-Version` (they feed capability resolution and analytics context).
//   • Anonymous-first auth (§11): the first user-scoped call bootstraps
//     `POST /auth/anonymous`, tokens go to the Keychain, bearer is attached.
//   • ONE refresh attempt on 401, then a single retry of the original request.
//   • Every failure surfaces as `APIError` — decoded envelope or synthetic.
//
//  It is an `actor` so token state (and the in-flight bootstrap/refresh) is
//  serialized without locks.
//

import Foundation
import os

actor APIClient {

    private let config: AppConfig
    private let urlSession: URLSession
    private let secureStore: any SecureStoring
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder
    private let logger = Logger(subsystem: "de.preisora.app", category: "APIClient")

    /// Keychain item holding the JSON-encoded `AuthTokens`.
    private static let tokenStorageKey = "de.preisora.app.authTokens"

    private var cachedTokens: AuthTokens?
    private var bootstrapTask: Task<AuthTokens, Error>?

    init(config: AppConfig, secureStore: any SecureStoring, urlSession: URLSession = .shared) {
        self.config = config
        self.secureStore = secureStore
        self.urlSession = urlSession
        self.decoder = APIClient.makeDecoder()
        self.encoder = APIClient.makeEncoder()
    }

    // MARK: - Coders

    static func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { nestedDecoder in
            let container = try nestedDecoder.singleValueContainer()
            let raw = try container.decode(String.self)
            if let date = ISO8601Support.fractional.date(from: raw) {
                return date
            }
            if let date = ISO8601Support.plain.date(from: raw) {
                return date
            }
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Expected an RFC 3339 UTC timestamp, got \"\(raw)\""
            )
        }
        return decoder
    }

    static func makeEncoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, nestedEncoder in
            var container = nestedEncoder.singleValueContainer()
            try container.encode(ISO8601Support.plain.string(from: date))
        }
        return encoder
    }

    // MARK: - Catalog (anonymous)

    func health() async throws -> HealthStatus {
        try await send(.health, as: HealthStatus.self)
    }

    func capabilities() async throws -> Capabilities {
        try await send(.capabilities, as: Capabilities.self)
    }

    func product(id: String) async throws -> Product {
        try await send(.productById(productId: id), as: Product.self)
    }

    func product(gtin: String) async throws -> Product {
        try await send(.productByGTIN(gtin: gtin), as: Product.self)
    }

    func product(slug: String) async throws -> Product {
        try await send(.productBySlug(slug: slug), as: Product.self)
    }

    func offers(
        productId: String,
        coordinate: Coordinate,
        radiusMeters: Int
    ) async throws -> Page<Offer> {
        try await send(
            .productOffers(productId: productId, coordinate: coordinate, radiusMeters: radiusMeters),
            as: Page<Offer>.self
        )
    }

    func priceHistory(productId: String, range: PriceHistoryRange) async throws -> PriceHistory {
        try await send(
            .productPriceHistory(productId: productId, range: range),
            as: PriceHistory.self
        )
    }

    func stores(coordinate: Coordinate, radiusMeters: Int) async throws -> Page<Store> {
        try await send(
            .stores(coordinate: coordinate, radiusMeters: radiusMeters),
            as: Page<Store>.self
        )
    }

    func store(id: String) async throws -> Store {
        try await send(.storeById(storeId: id), as: Store.self)
    }

    func retailers() async throws -> Page<RetailerWithMarkets> {
        try await send(.retailers, as: Page<RetailerWithMarkets>.self)
    }

    func retailer(id: String) async throws -> RetailerWithMarkets {
        try await send(.retailerById(retailerId: id), as: RetailerWithMarkets.self)
    }

    func searchProducts(
        query: String,
        cursor: String? = nil,
        limit: Int? = nil
    ) async throws -> Page<Product> {
        try await send(
            .searchProducts(query: query, cursor: cursor, limit: limit),
            as: Page<Product>.self
        )
    }

    // MARK: - User-scoped (bearer)

    func currentUser() async throws -> User {
        try await send(.currentUser, as: User.self)
    }

    func favorites(cursor: String? = nil, limit: Int? = nil) async throws -> Page<Favorite> {
        try await send(.favorites(cursor: cursor, limit: limit), as: Page<Favorite>.self)
    }

    func addFavorite(productId: String) async throws -> Favorite {
        try await send(
            .addFavorite(FavoriteCreateRequest(productId: productId)),
            as: Favorite.self
        )
    }

    func removeFavorite(productId: String) async throws {
        try await sendIgnoringResponseBody(.removeFavorite(productId: productId))
    }

    func alerts() async throws -> Page<PriceAlert> {
        try await send(.alerts, as: Page<PriceAlert>.self)
    }

    func createAlert(_ request: AlertCreateRequest) async throws -> PriceAlert {
        try await send(.createAlert(request), as: PriceAlert.self)
    }

    func deleteAlert(alertId: String) async throws {
        try await sendIgnoringResponseBody(.deleteAlert(alertId: alertId))
    }

    func shoppingLists() async throws -> Page<ShoppingList> {
        try await send(.shoppingLists, as: Page<ShoppingList>.self)
    }

    func createShoppingList(name: String) async throws -> ShoppingList {
        try await send(
            .createShoppingList(ShoppingListCreateRequest(name: name)),
            as: ShoppingList.self
        )
    }

    func shoppingList(id: String) async throws -> ShoppingList {
        try await send(.shoppingList(listId: id), as: ShoppingList.self)
    }

    func optimize(listId: String, request: OptimizeRequest) async throws -> OptimizationResult {
        try await send(
            .optimizeShoppingList(listId: listId, request),
            as: OptimizationResult.self
        )
    }

    func registerDevice(_ request: DeviceRegisterRequest) async throws -> Device {
        try await send(.registerDevice(request), as: Device.self)
    }

    // MARK: - Session

    /// Ensures an anonymous session exists (used at launch so the first favorite tap
    /// is instant). Safe to call repeatedly.
    @discardableResult
    func ensureSession() async throws -> AuthTokens {
        try await currentTokens()
    }

    /// Whether a token pair is already available without a network round trip.
    func hasStoredSession() -> Bool {
        if cachedTokens != nil { return true }
        return loadStoredTokens() != nil
    }

    /// Drops the local session (Keychain included). The next authenticated call
    /// bootstraps a fresh anonymous account.
    func signOut() {
        cachedTokens = nil
        try? secureStore.removeValue(forKey: APIClient.tokenStorageKey)
    }

    // MARK: - Transport

    private func send<T: Decodable>(_ endpoint: APIEndpoint, as type: T.Type) async throws -> T {
        let (data, status) = try await perform(endpoint, allowRefresh: true)
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            logger.error("Decoding \(String(describing: T.self), privacy: .public) failed: \(String(describing: error), privacy: .public)")
            throw APIError.decodingFailure(underlying: error, httpStatus: status)
        }
    }

    private func sendIgnoringResponseBody(_ endpoint: APIEndpoint) async throws {
        _ = try await perform(endpoint, allowRefresh: true)
    }

    private func perform(
        _ endpoint: APIEndpoint,
        allowRefresh: Bool
    ) async throws -> (Data, Int) {
        var request = try makeRequest(for: endpoint)

        if endpoint.requiresAuthentication {
            let tokens = try await currentTokens()
            request.setValue("Bearer \(tokens.accessToken)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await transport(request)

        guard let http = response as? HTTPURLResponse else {
            throw APIError.malformedResponse(httpStatus: nil)
        }

        if http.statusCode == 401, endpoint.requiresAuthentication, allowRefresh {
            // Exactly one refresh attempt, then one retry of the original request.
            logger.info("401 on \(endpoint.path, privacy: .public) — refreshing session once")
            try await refreshSession()
            return try await perform(endpoint, allowRefresh: false)
        }

        guard (200..<300).contains(http.statusCode) else {
            throw makeError(from: data, httpStatus: http.statusCode)
        }

        return (data, http.statusCode)
    }

    private func transport(_ request: URLRequest) async throws -> (Data, URLResponse) {
        do {
            return try await urlSession.data(for: request)
        } catch let error as URLError {
            // Offline / DNS / TLS / timeout → synthetic retryable 503-equivalent.
            logger.error("Transport failure: \(error.code.rawValue, privacy: .public)")
            throw APIError.transportFailure(underlying: error)
        } catch {
            throw APIError.transportFailure(underlying: error)
        }
    }

    private func makeRequest(for endpoint: APIEndpoint) throws -> URLRequest {
        guard let url = endpoint.url(baseURL: config.apiBaseURL) else {
            throw APIError.malformedResponse(httpStatus: nil)
        }
        var request = URLRequest(url: url)
        request.httpMethod = endpoint.method.rawValue
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(config.acceptLanguage, forHTTPHeaderField: "Accept-Language")
        request.setValue("ios", forHTTPHeaderField: "X-App-Platform")
        request.setValue(config.appVersion, forHTTPHeaderField: "X-App-Version")

        do {
            if let body = try endpoint.makeBody(encoder: encoder) {
                request.httpBody = body
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            }
        } catch {
            throw APIError.decodingFailure(underlying: error, httpStatus: nil)
        }
        return request
    }

    private func makeError(from data: Data, httpStatus: Int) -> APIError {
        if let envelope = try? decoder.decode(APIErrorEnvelope.self, from: data) {
            return envelope.asAPIError(httpStatus: httpStatus)
        }
        // An error status without a parsable envelope should not happen (the contract
        // requires one on every 4xx/5xx) — degrade instead of crashing.
        logger.error("Unparsable error body for HTTP \(httpStatus, privacy: .public)")
        return APIError.malformedResponse(httpStatus: httpStatus)
    }

    // MARK: - Tokens

    private func currentTokens() async throws -> AuthTokens {
        if let cachedTokens {
            return cachedTokens
        }
        if let stored = loadStoredTokens() {
            cachedTokens = stored
            return stored
        }
        if let inFlight = bootstrapTask {
            return try await inFlight.value
        }
        let task = Task { () throws -> AuthTokens in
            try await self.requestAnonymousTokens()
        }
        bootstrapTask = task
        defer { bootstrapTask = nil }
        let tokens = try await task.value
        cachedTokens = tokens
        persist(tokens)
        return tokens
    }

    /// `POST /auth/anonymous` — real in phase 1 (orchestrator decision #3); enables
    /// the scan-before-signup funnel.
    private func requestAnonymousTokens() async throws -> AuthTokens {
        let (data, status) = try await perform(.anonymousSession, allowRefresh: false)
        do {
            return try decoder.decode(AuthTokens.self, from: data)
        } catch {
            throw APIError.decodingFailure(underlying: error, httpStatus: status)
        }
    }

    /// One refresh attempt. If the refresh token is gone or rejected, the local
    /// session is dropped and a fresh anonymous one is created — the user keeps
    /// browsing instead of hitting a dead end.
    private func refreshSession() async throws {
        let existing = cachedTokens ?? loadStoredTokens()
        guard let refreshToken = existing?.refreshToken, !refreshToken.isEmpty else {
            cachedTokens = nil
            try? secureStore.removeValue(forKey: APIClient.tokenStorageKey)
            let fresh = try await requestAnonymousTokens()
            cachedTokens = fresh
            persist(fresh)
            return
        }

        do {
            let (data, status) = try await perform(
                .refreshSession(RefreshRequest(refreshToken: refreshToken)),
                allowRefresh: false
            )
            do {
                let tokens = try decoder.decode(AuthTokens.self, from: data)
                cachedTokens = tokens
                persist(tokens)
            } catch {
                throw APIError.decodingFailure(underlying: error, httpStatus: status)
            }
        } catch {
            logger.info("Refresh failed — falling back to a new anonymous session")
            cachedTokens = nil
            try? secureStore.removeValue(forKey: APIClient.tokenStorageKey)
            let fresh = try await requestAnonymousTokens()
            cachedTokens = fresh
            persist(fresh)
        }
    }

    private func loadStoredTokens() -> AuthTokens? {
        guard let raw = try? secureStore.string(forKey: APIClient.tokenStorageKey),
              let data = raw.data(using: .utf8) else {
            return nil
        }
        return try? JSONDecoder().decode(AuthTokens.self, from: data)
    }

    private func persist(_ tokens: AuthTokens) {
        guard let data = try? JSONEncoder().encode(tokens),
              let raw = String(data: data, encoding: .utf8) else {
            return
        }
        do {
            try secureStore.setString(raw, forKey: APIClient.tokenStorageKey)
        } catch {
            logger.error("Could not persist tokens to the Keychain: \(String(describing: error), privacy: .public)")
        }
    }
}

/// RFC 3339 parsing helpers. Two formatters because the backend may or may not emit
/// fractional seconds and `ISO8601DateFormatter` will not accept both at once.
enum ISO8601Support {
    static let plain: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    static let fractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}
