//
//  DemoURLProtocol.swift
//  Networking/Demo — DEMO MODE: the whole app, with NO backend running.
//
//  WHY THIS SITS *BELOW* `APIClient`
//  --------------------------------
//  `APIClient` performs exactly ONE transport call (`urlSession.data(for:)`), so the
//  cheapest honest way to run without `backend/` is to swap the bytes on the wire,
//  not the client. A `URLProtocol` registered on an ephemeral `URLSession` answers
//  every request from the JSON captured in `Resources/DemoData/` — which means the
//  REAL code path still runs end to end: context headers, the anonymous-auth
//  bootstrap, `JSONDecoder` with the contract's date strategy, and `APIError`
//  envelope decoding, including the 4xx/5xx branch. (The 401 → refresh → retry
//  branch stays reachable but idle: the demo never answers 401.) Nothing in
//  `APIClient`, `APIEndpoint` or `APIError` knows demo mode exists.
//
//  HONESTY RULES THIS FILE FOLLOWS
//   • Fixtures are served verbatim — they were captured from the real backend.
//   • Everything that is *not* captured is either synthesized in the contract's own
//     shape (`/health`, `/users/me`, empty `/alerts` and `/shopping-lists` pages,
//     the session-lifetime favorites list) or answered with the contract's 501
//     `FEATURE_NOT_AVAILABLE` envelope — the same answer the real backend gives for
//     a stubbed operation. No endpoint gets a body this project has not specified.
//   • Only ONE product exists in the fixture set (Vollmilch 3,5%). All five seeded
//     demo GTINs resolve to that one product; every other GTIN gets the captured
//     404 `PRODUCT_NOT_FOUND` envelope.
//
//  Foundation only — no SwiftUI, no UIKit, no third-party code.
//

import Foundation

// MARK: - The persisted flag

/// Whether the app talks to fixtures instead of a backend.
///
/// Defaults to **on** when the key is absent, so a freshly built app is usable on
/// first launch without Docker, an `.env`, or any configuration at all.
enum DemoMode {

    /// `UserDefaults` key. Namespaced like every other key the app owns.
    static let defaultsKey = "de.preisora.app.demoMode"

    static func isEnabled(defaults: UserDefaults = .standard) -> Bool {
        guard let stored = defaults.object(forKey: defaultsKey) else { return true }
        if let flag = stored as? Bool { return flag }
        if let number = stored as? NSNumber { return number.boolValue }
        return true
    }

    static func setEnabled(_ enabled: Bool, defaults: UserDefaults = .standard) {
        defaults.set(enabled, forKey: defaultsKey)
    }
}

// MARK: - Session factory

/// Builds the `URLSession` that `AppServices` hands to `APIClient` in demo mode.
enum DemoBackend {

    /// Ephemeral: no disk cache, no cookie storage, nothing survives the process —
    /// demo state must never masquerade as real state.
    static func makeSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DemoURLProtocol.self]
        configuration.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        configuration.urlCache = nil
        return URLSession(configuration: configuration)
    }

    /// Every fixture the router can reach for, by base name.
    static let fixtureNames: [String] = [
        "auth-anonymous",
        "capabilities",
        "error-product-not-found",
        "offers",
        "price-history",
        "product-by-gtin-4012345000016",
        "retailers",
        "search",
        "stores"
    ]

    /// Fixtures that are NOT in the app bundle. Empty is the healthy answer; a
    /// non-empty result means `Resources/DemoData/*.json` did not get copied into the
    /// build, which Settings surfaces instead of letting the app fail mysteriously.
    static func missingFixtures() -> [String] {
        fixtureNames.filter { DemoFixtureLoader.shared.data(forFixture: $0) == nil }
    }
}

// MARK: - Fixture loading

/// Reads `Resources/DemoData/<name>.json` out of the app bundle, once per name.
///
/// `@unchecked Sendable`: every field is guarded by `lock`.
final class DemoFixtureLoader: @unchecked Sendable {

    static let shared = DemoFixtureLoader()

    private let lock = NSLock()
    private var cache: [String: Data] = [:]
    private var overrideLoader: (@Sendable (String) -> Data?)?

    /// Test seam: makes the router testable off-device, where there is no app bundle.
    func setOverride(_ loader: (@Sendable (String) -> Data?)?) {
        lock.lock()
        defer { lock.unlock() }
        overrideLoader = loader
        cache.removeAll()
    }

    func data(forFixture name: String) -> Data? {
        lock.lock()
        let cached = cache[name]
        let loader = overrideLoader
        lock.unlock()

        if let cached { return cached }

        let loaded = loader?(name) ?? DemoFixtureLoader.loadFromBundle(name)
        guard let loaded else { return nil }

        lock.lock()
        cache[name] = loaded
        lock.unlock()
        return loaded
    }

    /// XcodeGen copies the JSON files in as flat bundle resources, so the root of the
    /// bundle is the expected home; the `DemoData` subdirectory and the framework
    /// bundle are checked too, because neither costs anything and both are plausible.
    private static func loadFromBundle(_ name: String) -> Data? {
        let bundles = [Bundle.main, Bundle(for: DemoURLProtocol.self)]
        for bundle in bundles {
            if let url = bundle.url(forResource: name, withExtension: "json"),
               let data = try? Data(contentsOf: url) {
                return data
            }
            if let url = bundle.url(forResource: name, withExtension: "json", subdirectory: "DemoData"),
               let data = try? Data(contentsOf: url) {
                return data
            }
        }
        return nil
    }
}

// MARK: - Session-lifetime favorites

/// Favoriting has to *stick* for the demo to feel real, and the backend that would
/// normally remember it is not running. This is the one piece of demo state: a set of
/// product ids, in memory, for the lifetime of the process.
///
/// `@unchecked Sendable`: `productIds` is only ever touched under `lock`.
final class DemoFavoritesStore: @unchecked Sendable {

    static let shared = DemoFavoritesStore()

    private let lock = NSLock()
    /// Newest first — the order `GET /favorites` returns them in.
    private var productIds: [String] = []

    func all() -> [String] {
        lock.lock()
        defer { lock.unlock() }
        return productIds
    }

    func contains(_ productId: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return productIds.contains(productId)
    }

    func add(_ productId: String) {
        lock.lock()
        defer { lock.unlock() }
        guard !productIds.contains(productId) else { return }
        productIds.insert(productId, at: 0)
    }

    func remove(_ productId: String) {
        lock.lock()
        defer { lock.unlock() }
        productIds.removeAll { $0 == productId }
    }

    func removeAll() {
        lock.lock()
        defer { lock.unlock() }
        productIds.removeAll()
    }
}

// MARK: - The protocol

/// Answers every request from bundled fixtures. Installed only on the demo session,
/// never on `URLSession.shared`, so it can never intercept live traffic.
final class DemoURLProtocol: URLProtocol {

    /// One captured response: an HTTP status and a JSON body.
    struct Reply: Equatable {
        let status: Int
        let body: Data

        var jsonObject: [String: Any]? {
            try? JSONSerialization.jsonObject(with: body) as? [String: Any]
        }
    }

    // MARK: URLProtocol

    override class func canInit(with request: URLRequest) -> Bool { true }

    override class func canInit(with task: URLSessionTask) -> Bool { true }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let reply = DemoURLProtocol.reply(for: request)

        guard let url = request.url,
              let response = HTTPURLResponse(
                url: url,
                statusCode: reply.status,
                httpVersion: "HTTP/1.1",
                headerFields: [
                    "Content-Type": "application/json; charset=utf-8",
                    "X-Preisora-Demo": "1"
                ]
              ) else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
            return
        }

        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        if !reply.body.isEmpty {
            client?.urlProtocol(self, didLoad: reply.body)
        }
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {
        // Nothing is in flight — every reply is produced synchronously.
    }

    // MARK: - Routing

    static func reply(for request: URLRequest) -> Reply {
        let method = (request.httpMethod ?? "GET").uppercased()
        guard let url = request.url else {
            return notFoundEnvelope(code: "RESOURCE_NOT_FOUND", messageKey: "error.route_not_found", details: [:])
        }
        return reply(method: method, url: url, body: bodyData(of: request))
    }

    /// The whole routing table. Pure: same inputs, same bytes — which is what the
    /// tests exercise.
    ///
    /// Swift has no array-literal *pattern*, so the path is matched as a fixed-arity
    /// tuple: (method, segment count, first three segments). Anything deeper than
    /// three segments falls through to the 501 default, and the contract has no such
    /// path in v1.
    static func reply(method: String, url: URL, body: Data?) -> Reply {
        let segments = pathSegments(of: url)
        let query = queryItems(of: url)

        let first = segments.count > 0 ? segments[0] : ""
        let second = segments.count > 1 ? segments[1] : ""
        let third = segments.count > 2 ? segments[2] : ""

        switch (method, segments.count, first, second, third) {

        // ---- Anonymous catalog -------------------------------------------------

        case ("GET", 1, "health", _, _):
            return health()

        case ("GET", 1, "capabilities", _, _):
            return fixture("capabilities", status: 200)

        case ("GET", 3, "products", "by-gtin", let gtin):
            return isDemoGTIN(gtin)
                ? fixture(productFixtureName, status: 200)
                : fixture("error-product-not-found", status: 404)

        case ("GET", 3, "products", "by-slug", let slug):
            return slug == demoProductSlug
                ? fixture(productFixtureName, status: 200)
                : notFoundEnvelope(
                    code: "PRODUCT_NOT_FOUND",
                    messageKey: "error.product_not_found",
                    details: ["slug": slug]
                  )

        case ("GET", 3, "products", let productId, "offers") where productId == demoProductId:
            return fixture("offers", status: 200)

        case ("GET", 3, "products", let productId, "price-history") where productId == demoProductId:
            return fixture("price-history", status: 200)

        case ("GET", 2, "products", let productId, _) where productId == demoProductId:
            return fixture(productFixtureName, status: 200)

        case ("GET", 2, "products", let productId, _),
             ("GET", 3, "products", let productId, _):
            return notFoundEnvelope(
                code: "PRODUCT_NOT_FOUND",
                messageKey: "error.product_not_found",
                details: ["productId": productId]
            )

        case ("GET", 1, "stores", _, _):
            return fixture("stores", status: 200)

        case ("GET", 2, "stores", let storeId, _):
            return element(withId: storeId, inFixture: "stores")
                ?? notFoundEnvelope(
                    code: "RESOURCE_NOT_FOUND",
                    messageKey: "error.store_not_found",
                    details: ["storeId": storeId]
                  )

        case ("GET", 1, "retailers", _, _):
            return fixture("retailers", status: 200)

        case ("GET", 2, "retailers", let retailerId, _):
            return element(withId: retailerId, inFixture: "retailers")
                ?? notFoundEnvelope(
                    code: "RESOURCE_NOT_FOUND",
                    messageKey: "error.retailer_not_found",
                    details: ["retailerId": retailerId]
                  )

        case ("GET", 2, "search", "products", _):
            return search(query: query["q"] ?? "")

        // ---- Auth --------------------------------------------------------------

        // 201 per the contract (`POST /auth/anonymous` → 201 Created).
        case ("POST", 2, "auth", "anonymous", _):
            return fixture("auth-anonymous", status: 201)

        // The same token pair, 200 — so the 401 → refresh → retry branch of
        // `APIClient` runs for real if anything ever provokes it.
        case ("POST", 2, "auth", "refresh", _):
            return fixture("auth-anonymous", status: 200)

        // ---- User-scoped -------------------------------------------------------

        case ("GET", 2, "users", "me", _):
            return currentUser()

        case ("GET", 1, "favorites", _, _):
            return favoritesPage()

        case ("POST", 1, "favorites", _, _):
            guard let productId = string(forKey: "productId", inJSON: body) else {
                return envelope(
                    status: 400,
                    code: "VALIDATION_FAILED",
                    messageKey: "error.validation_failed",
                    details: ["field": "productId"],
                    retryable: false
                )
            }
            guard productId == demoProductId, let favorite = favorite(forProductId: productId) else {
                return notFoundEnvelope(
                    code: "PRODUCT_NOT_FOUND",
                    messageKey: "error.product_not_found",
                    details: ["productId": productId]
                )
            }
            DemoFavoritesStore.shared.add(productId)
            return json(favorite, status: 201)

        case ("DELETE", 2, "favorites", let productId, _):
            // DELETE is idempotent server-side; removing an absent favorite is a 204 too.
            DemoFavoritesStore.shared.remove(productId)
            return Reply(status: 204, body: Data())

        // Implemented backend-side, but nothing was captured and the phase-1 screens
        // are typed empty states — an empty page is the truthful answer here.
        case ("GET", 1, "alerts", _, _):
            return emptyPage()

        case ("GET", 1, "shopping-lists", _, _):
            return emptyPage()

        // ---- Everything else ---------------------------------------------------

        default:
            return featureNotAvailable(method: method, segments: segments)
        }
    }

    // MARK: - Demo catalog facts (read from the fixtures, never hardcoded twice)

    static let productFixtureName = "product-by-gtin-4012345000016"

    /// The five seeded demo GTINs the demo scanner offers. Only the first one has a
    /// captured product, so all five resolve to it — see the file header.
    static let demoGTINs: Set<String> = [
        "4012345000016",
        "4012345000023",
        "4012345000030",
        "4012345000047",
        "4012345000054"
    ]

    static func isDemoGTIN(_ gtin: String) -> Bool { demoGTINs.contains(gtin) }

    /// `id` of the one product in the fixture set.
    static var demoProductId: String {
        productObject()?["id"] as? String ?? ""
    }

    static var demoProductSlug: String {
        productObject()?["slug"] as? String ?? ""
    }

    private static func productObject() -> [String: Any]? {
        guard let data = DemoFixtureLoader.shared.data(forFixture: productFixtureName) else { return nil }
        return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }

    // MARK: - Synthesized responses

    /// `GET /health`. Nothing was captured for it, so it is synthesized in the
    /// contract's inline shape. `version` deliberately reads `demo-fixtures`: Home
    /// renders it as "Backend erreichbar (Version %@)", and that line must not be
    /// able to pass for a live backend.
    private static func health() -> Reply {
        json(
            [
                "status": "ok",
                "timestamp": ISO8601Support.plain.string(from: Date()),
                "version": "demo-fixtures"
            ],
            status: 200
        )
    }

    /// The anonymous user behind the bundled token pair. `id` is the `sub` claim of
    /// the fixture's own access token, so the demo stays internally consistent.
    private static func currentUser() -> Reply {
        json(
            [
                "id": demoUserId,
                "email": NSNull(),
                "displayName": NSNull(),
                "countryCode": "DE",
                "locale": "de-DE",
                "createdAt": ISO8601Support.plain.string(from: demoAccountCreatedAt)
            ],
            status: 200
        )
    }

    /// Fallback id used when the token cannot be parsed. Shaped like a UUID because
    /// the contract says `format: uuid`.
    static let fallbackUserId = "00000000-0000-4000-8000-000000000000"

    static var demoUserId: String {
        guard let data = DemoFixtureLoader.shared.data(forFixture: "auth-anonymous"),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let token = object["accessToken"] as? String,
              let subject = jwtSubject(of: token) else {
            return fallbackUserId
        }
        return subject
    }

    private static let demoAccountCreatedAt = Date(timeIntervalSince1970: 1_788_100_671)

    /// Decodes the `sub` claim out of a JWT payload. No signature check — this is a
    /// fixture, not a credential.
    static func jwtSubject(of token: String) -> String? {
        let parts = token.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count >= 2 else { return nil }
        var base64 = String(parts[1])
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let remainder = base64.count % 4
        if remainder > 0 {
            base64.append(String(repeating: "=", count: 4 - remainder))
        }
        guard let data = Data(base64Encoded: base64),
              let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        return payload["sub"] as? String
    }

    private static func favoritesPage() -> Reply {
        let entries = DemoFavoritesStore.shared.all().compactMap { favorite(forProductId: $0) }
        return page(entries)
    }

    /// A `Favorite` around the demo product. The embedded product is the captured
    /// payload; only its `id` is aligned with the requested product id.
    private static func favorite(forProductId productId: String) -> [String: Any]? {
        guard var product = productObject() else { return nil }
        product["id"] = productId
        return [
            "id": "demo-favorite-\(productId)",
            "productId": productId,
            "product": product,
            "createdAt": ISO8601Support.plain.string(from: demoAccountCreatedAt)
        ]
    }

    /// `GET /search/products` filtered by `q`, so both the results state and the
    /// empty state are reachable in the demo.
    private static func search(query: String) -> Reply {
        guard let data = DemoFixtureLoader.shared.data(forFixture: "search"),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let items = object["data"] as? [[String: Any]] else {
            return fixtureMissing("search")
        }
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !needle.isEmpty else { return page(items) }

        let matches = items.filter { item in
            ["name", "brand", "gtin", "slug", "quantityText"].contains { key in
                guard let value = item[key] as? String else { return false }
                return value.lowercased().contains(needle)
            }
        }
        return page(matches)
    }

    /// Pulls one element out of a captured `{ data: [...] }` page by `id`.
    private static func element(withId id: String, inFixture name: String) -> Reply? {
        guard let data = DemoFixtureLoader.shared.data(forFixture: name),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let items = object["data"] as? [[String: Any]],
              let match = items.first(where: { ($0["id"] as? String) == id }) else {
            return nil
        }
        return json(match, status: 200)
    }

    // MARK: - Envelopes

    private static func emptyPage() -> Reply { page([]) }

    private static func page(_ items: [[String: Any]]) -> Reply {
        json(
            [
                "data": items,
                "pageInfo": ["nextCursor": NSNull(), "hasMore": false]
            ],
            status: 200
        )
    }

    /// The contract's 501 for anything this demo does not serve — the same answer the
    /// real backend gives for a stubbed operation, so the UI's error path is real.
    private static func featureNotAvailable(method: String, segments: [String]) -> Reply {
        envelope(
            status: 501,
            code: "FEATURE_NOT_AVAILABLE",
            messageKey: "error.feature_not_available",
            details: ["operation": "\(method) /\(segments.joined(separator: "/"))"],
            retryable: false
        )
    }

    private static func notFoundEnvelope(
        code: String,
        messageKey: String,
        details: [String: String]
    ) -> Reply {
        envelope(status: 404, code: code, messageKey: messageKey, details: details, retryable: false)
    }

    private static func envelope(
        status: Int,
        code: String,
        messageKey: String,
        details: [String: String],
        retryable: Bool
    ) -> Reply {
        json(
            [
                "code": code,
                "messageKey": messageKey,
                "details": details,
                "retryable": retryable
            ],
            status: status
        )
    }

    /// A fixture that should be in the bundle and is not. Deliberately an UNKNOWN
    /// error code: the UI renders its generic, non-retryable failure state, and the
    /// details name the missing file instead of pretending the backend misbehaved.
    private static func fixtureMissing(_ name: String) -> Reply {
        envelope(
            status: 500,
            code: "DEMO_FIXTURE_MISSING",
            messageKey: "error.unknown",
            details: ["fixture": "\(name).json"],
            retryable: false
        )
    }

    private static func fixture(_ name: String, status: Int) -> Reply {
        guard let data = DemoFixtureLoader.shared.data(forFixture: name) else {
            return fixtureMissing(name)
        }
        return Reply(status: status, body: data)
    }

    private static func json(_ object: [String: Any], status: Int) -> Reply {
        guard let data = try? JSONSerialization.data(withJSONObject: object) else {
            return Reply(status: 500, body: Data())
        }
        return Reply(status: status, body: data)
    }

    // MARK: - Request parsing

    /// Path components with the API prefix (`/api/v1`) removed, so routing is written
    /// against contract paths regardless of what `AppConfig.baseURL` points at.
    static func pathSegments(of url: URL) -> [String] {
        var segments = url.path.split(separator: "/").map(String.init)
        if segments.count >= 2, segments[0] == "api", segments[1].hasPrefix("v") {
            segments.removeFirst(2)
        }
        return segments.map { $0.removingPercentEncoding ?? $0 }
    }

    static func queryItems(of url: URL) -> [String: String] {
        guard let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems else {
            return [:]
        }
        var result: [String: String] = [:]
        for item in items where item.value != nil {
            result[item.name] = item.value
        }
        return result
    }

    private static func string(forKey key: String, inJSON data: Data?) -> String? {
        guard let data,
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        return object[key] as? String
    }

    /// `URLProtocol` sees a request body as a stream, not as `httpBody` — reading only
    /// `httpBody` would silently lose every POST payload.
    static func bodyData(of request: URLRequest) -> Data? {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return nil }

        stream.open()
        defer { stream.close() }

        let bufferSize = 4096
        let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: bufferSize)
        defer { buffer.deallocate() }

        var data = Data()
        while stream.hasBytesAvailable {
            let read = stream.read(buffer, maxLength: bufferSize)
            if read <= 0 { break }
            data.append(buffer, count: read)
        }
        return data.isEmpty ? nil : data
    }
}
