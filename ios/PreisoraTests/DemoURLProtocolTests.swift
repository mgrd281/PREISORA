import Foundation
import XCTest
@testable import Preisora

/// Exercises the demo routing table with the REAL fixtures and the REAL decoder:
/// every reply the demo backend can produce must decode into the same domain types
/// the live backend's bytes decode into.
final class DemoURLProtocolTests: XCTestCase {

    private let decoder = APIClient.makeDecoder()

    override func setUp() {
        super.setUp()
        let directory = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Preisora/Resources/DemoData")
        DemoFixtureLoader.shared.setOverride { name in
            try? Data(contentsOf: directory.appendingPathComponent("\(name).json"))
        }
        DemoFavoritesStore.shared.removeAll()
    }

    override func tearDown() {
        DemoFixtureLoader.shared.setOverride(nil)
        DemoFavoritesStore.shared.removeAll()
        super.tearDown()
    }

    // MARK: - Helpers

    private func get(_ path: String) -> DemoURLProtocol.Reply {
        reply("GET", path, body: nil)
    }

    private func reply(_ method: String, _ path: String, body: Data?) -> DemoURLProtocol.Reply {
        let url = URL(string: "http://localhost:3000/api/v1\(path)")!
        return DemoURLProtocol.reply(method: method, url: url, body: body)
    }

    private func decode<T: Decodable>(_ type: T.Type, _ reply: DemoURLProtocol.Reply) throws -> T {
        try decoder.decode(type, from: reply.body)
    }

    private func envelope(_ reply: DemoURLProtocol.Reply) throws -> APIErrorEnvelope {
        try JSONDecoder().decode(APIErrorEnvelope.self, from: reply.body)
    }

    // MARK: - Catalog

    func testHealth() throws {
        let reply = get("/health")
        XCTAssertEqual(reply.status, 200)
        let health = try decode(HealthStatus.self, reply)
        XCTAssertTrue(health.isHealthy)
    }

    func testCapabilities() throws {
        let reply = get("/capabilities")
        XCTAssertEqual(reply.status, 200)
        let capabilities = try decode(Capabilities.self, reply)
        XCTAssertTrue(capabilities.features.priceHistory)
    }

    func testEveryDemoGTINResolvesToTheDemoProduct() throws {
        for gtin in DemoURLProtocol.demoGTINs {
            let reply = get("/products/by-gtin/\(gtin)")
            XCTAssertEqual(reply.status, 200, "GTIN \(gtin)")
            let product = try decode(Product.self, reply)
            XCTAssertEqual(product.id, DemoURLProtocol.demoProductId)
        }
    }

    func testUnknownGTINReturnsTheCapturedNotFoundEnvelope() throws {
        let reply = get("/products/by-gtin/4099999000005")
        XCTAssertEqual(reply.status, 404)
        let envelope = try envelope(reply)
        XCTAssertEqual(APIErrorCode(wireValue: envelope.code), .productNotFound)
        XCTAssertFalse(envelope.retryable)
    }

    func testProductByIdAndItsSubresources() throws {
        let id = DemoURLProtocol.demoProductId
        XCTAssertFalse(id.isEmpty)

        let product = try decode(Product.self, get("/products/\(id)"))
        XCTAssertEqual(product.gtin, "4012345000016")

        let offers = get("/products/\(id)/offers?lat=52.520000&lng=13.405000&radiusMeters=5000")
        XCTAssertEqual(offers.status, 200)
        let offerPage = try decode(Page<Offer>.self, offers)
        XCTAssertEqual(offerPage.data.filter { $0.isBest }.count, 1)

        let history = get("/products/\(id)/price-history?range=30d")
        XCTAssertEqual(history.status, 200)
        let priceHistory = try decode(PriceHistory.self, history)
        XCTAssertFalse(priceHistory.points.isEmpty)
    }

    func testUnknownProductIdIs404() throws {
        let reply = get("/products/11111111-2222-3333-4444-555555555555")
        XCTAssertEqual(reply.status, 404)
        XCTAssertEqual(APIErrorCode(wireValue: try envelope(reply).code), .productNotFound)
    }

    func testProductBySlug() throws {
        let ok = get("/products/by-slug/\(DemoURLProtocol.demoProductSlug)")
        XCTAssertEqual(ok.status, 200)
        let miss = get("/products/by-slug/nicht-vorhanden")
        XCTAssertEqual(miss.status, 404)
    }

    func testStoresAndOneStore() throws {
        let page = get("/stores?lat=52.520000&lng=13.405000&radiusMeters=5000")
        XCTAssertEqual(page.status, 200)
        let stores = try decode(Page<Store>.self, page)
        XCTAssertFalse(stores.data.isEmpty)

        let one = get("/stores/\(stores.data[0].id)")
        XCTAssertEqual(one.status, 200)
        XCTAssertEqual(try decode(Store.self, one).id, stores.data[0].id)

        XCTAssertEqual(get("/stores/does-not-exist").status, 404)
    }

    func testRetailersAndOneRetailer() throws {
        let page = get("/retailers")
        XCTAssertEqual(page.status, 200)
        let retailers = try decode(Page<RetailerWithMarkets>.self, page)
        XCTAssertFalse(retailers.data.isEmpty)

        let one = get("/retailers/\(retailers.data[0].id)")
        XCTAssertEqual(one.status, 200)
        XCTAssertEqual(get("/retailers/does-not-exist").status, 404)
    }

    func testSearchFiltersOnTheQuery() throws {
        let hit = get("/search/products?q=milch")
        XCTAssertEqual(hit.status, 200)
        XCTAssertFalse(try decode(Page<Product>.self, hit).data.isEmpty)

        let miss = get("/search/products?q=zzz-nichts")
        XCTAssertEqual(miss.status, 200)
        XCTAssertTrue(try decode(Page<Product>.self, miss).data.isEmpty)
    }

    // MARK: - Auth and user

    func testAnonymousSessionAndRefresh() throws {
        let anonymous = reply("POST", "/auth/anonymous", body: nil)
        XCTAssertEqual(anonymous.status, 201)
        let tokens = try decode(AuthTokens.self, anonymous)
        XCTAssertFalse(tokens.accessToken.isEmpty)
        XCTAssertFalse(tokens.refreshToken.isEmpty)

        let refreshed = reply(
            "POST",
            "/auth/refresh",
            body: try JSONSerialization.data(withJSONObject: ["refreshToken": tokens.refreshToken])
        )
        XCTAssertEqual(refreshed.status, 200)
        XCTAssertEqual(try decode(AuthTokens.self, refreshed), tokens)
    }

    func testCurrentUserMatchesTheTokenSubject() throws {
        let reply = get("/users/me")
        XCTAssertEqual(reply.status, 200)
        let user = try decode(User.self, reply)
        XCTAssertTrue(user.isAnonymous)
        XCTAssertEqual(user.countryCode, "DE")
        XCTAssertNotEqual(user.id, DemoURLProtocol.fallbackUserId, "the JWT sub should parse")
        XCTAssertEqual(user.id, DemoURLProtocol.demoUserId)
    }

    // MARK: - Favorites

    func testFavoritesSurviveForTheSession() throws {
        XCTAssertTrue(try decode(Page<Favorite>.self, get("/favorites")).data.isEmpty)

        let productId = DemoURLProtocol.demoProductId
        let created = reply(
            "POST",
            "/favorites",
            body: try JSONSerialization.data(withJSONObject: ["productId": productId])
        )
        XCTAssertEqual(created.status, 201)
        XCTAssertEqual(try decode(Favorite.self, created).productId, productId)

        let listed = try decode(Page<Favorite>.self, get("/favorites"))
        XCTAssertEqual(listed.data.map(\.productId), [productId])
        XCTAssertEqual(listed.data.first?.product.gtin, "4012345000016")

        let deleted = reply("DELETE", "/favorites/\(productId)", body: nil)
        XCTAssertEqual(deleted.status, 204)
        XCTAssertTrue(deleted.body.isEmpty)
        XCTAssertTrue(try decode(Page<Favorite>.self, get("/favorites")).data.isEmpty)

        // Idempotent: deleting twice is still a 204.
        XCTAssertEqual(reply("DELETE", "/favorites/\(productId)", body: nil).status, 204)
    }

    func testFavoritingAnUnknownProductIs404() throws {
        let created = reply(
            "POST",
            "/favorites",
            body: try JSONSerialization.data(withJSONObject: ["productId": "nope"])
        )
        XCTAssertEqual(created.status, 404)
        XCTAssertTrue(DemoFavoritesStore.shared.all().isEmpty)
    }

    func testFavoritePostWithoutBodyIsAValidationError() throws {
        let created = reply("POST", "/favorites", body: nil)
        XCTAssertEqual(created.status, 400)
        XCTAssertEqual(APIErrorCode(wireValue: try envelope(created).code), .validationFailed)
    }

    // MARK: - Empty pages and the 501 default

    func testAlertsAndShoppingListsAreEmptyPages() throws {
        XCTAssertTrue(try decode(Page<PriceAlert>.self, get("/alerts")).data.isEmpty)
        XCTAssertTrue(try decode(Page<ShoppingList>.self, get("/shopping-lists")).data.isEmpty)
    }

    func testUnmappedRoutesAnswer501FeatureNotAvailable() throws {
        for (method, path) in [("POST", "/devices"), ("GET", "/users/me/preferences"), ("POST", "/alerts")] {
            let reply = reply(method, path, body: nil)
            XCTAssertEqual(reply.status, 501, "\(method) \(path)")
            let envelope = try envelope(reply)
            XCTAssertEqual(APIErrorCode(wireValue: envelope.code), .featureNotAvailable)
            XCTAssertFalse(envelope.retryable)
        }
    }

    // MARK: - Request parsing

    func testPathPrefixStripping() {
        XCTAssertEqual(
            DemoURLProtocol.pathSegments(of: URL(string: "http://localhost:3000/api/v1/products/by-gtin/4012345000016")!),
            ["products", "by-gtin", "4012345000016"]
        )
        XCTAssertEqual(
            DemoURLProtocol.pathSegments(of: URL(string: "https://api.preisora.de/health")!),
            ["health"]
        )
    }

    func testBodyIsReadFromAStreamAsWellAsFromHTTPBody() throws {
        let payload = try JSONSerialization.data(withJSONObject: ["productId": "abc"])

        var withBody = URLRequest(url: URL(string: "http://x/api/v1/favorites")!)
        withBody.httpBody = payload
        XCTAssertEqual(DemoURLProtocol.bodyData(of: withBody), payload)

        var withStream = URLRequest(url: URL(string: "http://x/api/v1/favorites")!)
        withStream.httpBodyStream = InputStream(data: payload)
        XCTAssertEqual(DemoURLProtocol.bodyData(of: withStream), payload)

        let empty = URLRequest(url: URL(string: "http://x/api/v1/favorites")!)
        XCTAssertNil(DemoURLProtocol.bodyData(of: empty))
    }

    // MARK: - The flag

    func testDemoModeDefaultsToOnWhenTheKeyIsAbsent() throws {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "de.preisora.app.demoModeTests"))
        defaults.removeObject(forKey: DemoMode.defaultsKey)
        XCTAssertTrue(DemoMode.isEnabled(defaults: defaults))

        DemoMode.setEnabled(false, defaults: defaults)
        XCTAssertFalse(DemoMode.isEnabled(defaults: defaults))

        DemoMode.setEnabled(true, defaults: defaults)
        XCTAssertTrue(DemoMode.isEnabled(defaults: defaults))

        defaults.removeObject(forKey: DemoMode.defaultsKey)
    }
}

/// Mirrors the exact expression `AppServices.live` uses, so the injection point is
/// type-checked here even though `AppServices` itself needs SwiftUI.
final class DemoWiringTests: XCTestCase {

    private struct Store: SecureStoring {
        func string(forKey key: String) throws -> String? { nil }
        func setString(_ value: String, forKey key: String) throws {}
        func removeValue(forKey key: String) throws {}
    }

    func testDemoSessionIsAcceptedByAPIClient() {
        let config = AppConfig(
            apiBaseURL: URL(string: AppConfig.defaultBaseURLString)!,
            appVersion: "1.0.0",
            buildNumber: "1",
            acceptLanguage: "de-DE",
            deviceLocaleIdentifier: "de-DE",
            countryCode: "DE"
        )
        let secureStore: any SecureStoring = Store()
        let isDemoMode = true
        let session = DemoBackend.makeSession()
        XCTAssertTrue(session.configuration.protocolClasses?.contains { $0 == DemoURLProtocol.self } ?? false)

        let api = isDemoMode
            ? APIClient(config: config, secureStore: secureStore, urlSession: session)
            : APIClient(config: config, secureStore: secureStore)
        XCTAssertNotNil(api)
    }
}

/// A real round trip through `URLSession` + the registered `URLProtocol`.
/// (Linux Foundation, not iOS — but it proves the protocol registration itself.)
final class DemoSessionRoundTripTests: XCTestCase {

    func testHealthOverTheDemoSession() async throws {
        let directory = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Preisora/Resources/DemoData")
        DemoFixtureLoader.shared.setOverride { name in
            try? Data(contentsOf: directory.appendingPathComponent("\(name).json"))
        }
        defer { DemoFixtureLoader.shared.setOverride(nil) }

        let session = DemoBackend.makeSession()
        var request = URLRequest(url: URL(string: "http://localhost:3000/api/v1/products/by-gtin/4012345000016")!)
        request.httpMethod = "GET"
        let (data, response) = try await session.data(for: request)
        let http = try XCTUnwrap(response as? HTTPURLResponse)
        XCTAssertEqual(http.statusCode, 200)
        XCTAssertEqual(http.value(forHTTPHeaderField: "Content-Type"), "application/json; charset=utf-8")
        let product = try APIClient.makeDecoder().decode(Product.self, from: data)
        XCTAssertEqual(product.gtin, "4012345000016")
    }
}
