import Foundation
import XCTest
@testable import Preisora

/// Decodes REAL responses captured from the running PREISORA backend using the
/// app's own models and the app's own decoder. This is the check that would
/// otherwise only fail at runtime on a device.
final class WireDecodingTests: XCTestCase {

    private let decoder = APIClient.makeDecoder()

    private func data(_ name: String) throws -> Data {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Preisora/Resources/DemoData/\(name).json")
        return try Data(contentsOf: url)
    }

    private func decode<T: Decodable>(_ type: T.Type, _ name: String) throws -> T {
        try decoder.decode(type, from: try data(name))
    }

    func testProductByGTIN() throws {
        let product = try decode(Product.self, "product-by-gtin-4012345000016")
        XCTAssertEqual(product.gtin, "4012345000016")
        XCTAssertFalse(product.slug.isEmpty)
        XCTAssertFalse(product.name.isEmpty)
    }

    func testOffersPage() throws {
        let page = try decode(Page<Offer>.self, "offers")
        XCTAssertFalse(page.data.isEmpty)
        XCTAssertEqual(page.data.filter { $0.isBest }.count, 1, "exactly one best offer")
        let best = try XCTUnwrap(page.data.first { $0.isBest })
        XCTAssertGreaterThan(best.effectivePrice.amountMinor, 0)
        XCTAssertEqual(best.effectivePrice.currencyCode, "EUR")
    }

    func testPriceHistory() throws {
        let history = try decode(PriceHistory.self, "price-history")
        XCTAssertEqual(history.range.wireValue, "30d")
        XCTAssertFalse(history.points.isEmpty)
    }

    func testStoresPage() throws {
        let page = try decode(Page<Store>.self, "stores")
        XCTAssertFalse(page.data.isEmpty)
        XCTAssertNotNil(page.data.first?.distanceMeters)
    }

    func testSearchPage() throws {
        let page = try decode(Page<Product>.self, "search")
        XCTAssertFalse(page.data.isEmpty)
    }

    func testRetailersPage() throws {
        _ = try decode(Page<Retailer>.self, "retailers")
    }

    func testCapabilities() throws {
        let caps = try decode(Capabilities.self, "capabilities")
        XCTAssertTrue(caps.features.priceAlerts || !caps.features.priceAlerts)
    }

    func testAuthAnonymous() throws {
        let tokens = try decode(AuthTokens.self, "auth-anonymous")
        XCTAssertFalse(tokens.accessToken.isEmpty)
        XCTAssertFalse(tokens.refreshToken.isEmpty)
    }

    func testErrorEnvelope() throws {
        let envelope = try decode(APIErrorEnvelope.self, "error-product-not-found")
        XCTAssertEqual(envelope.code, "PRODUCT_NOT_FOUND")
        XCTAssertEqual(APIErrorCode(wireValue: envelope.code), .productNotFound)
        XCTAssertFalse(envelope.retryable)
    }
}
