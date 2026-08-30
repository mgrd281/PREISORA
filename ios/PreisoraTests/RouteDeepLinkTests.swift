//
//  RouteDeepLinkTests.swift
//  PreisoraTests
//
//  docs/deep-links.md is the canonical grammar. These tests pin it in both
//  directions: what `Route.init?(deepLinkURL:)` accepts, and what `ShareLinkService`
//  produces — a shared link must always parse back to the route it came from.
//

import Foundation
import XCTest
@testable import Preisora

final class RouteDeepLinkTests: XCTestCase {

    private let productId = "3fa2d1b8-5c44-4a7e-9b0e-6f2a91c47d55"
    private let storeId = "b58f3a24-6d17-4e0b-a92c-1f0e8d7c6b5a"

    private func route(_ string: String) -> Route? {
        guard let url = URL(string: string) else {
            XCTFail("Not a URL: \(string)")
            return nil
        }
        return Route(deepLinkURL: url)
    }

    // MARK: - Canonical https patterns

    func testProductByIdPattern() {
        XCTAssertEqual(
            route("https://preisora.de/product/\(productId)"),
            .product(.id(productId))
        )
    }

    func testProductBySlugPattern() {
        XCTAssertEqual(
            route("https://preisora.de/p/vollmilch-3-5-1l"),
            .product(.slug("vollmilch-3-5-1l"))
        )
    }

    func testStorePattern() {
        XCTAssertEqual(route("https://preisora.de/store/\(storeId)"), .store(id: storeId))
    }

    func testReservedPatternsParseButAreNotImplemented() {
        XCTAssertEqual(
            route("https://preisora.de/list-invite/abc123"),
            .reservedDeepLink(.listInvite(token: "abc123"))
        )
        XCTAssertEqual(
            route("https://preisora.de/alert/\(productId)"),
            .reservedDeepLink(.alert(id: productId))
        )
        XCTAssertEqual(
            route("https://preisora.de/promotion/\(productId)"),
            .reservedDeepLink(.promotion(id: productId))
        )
    }

    func testWwwHostIsAccepted() {
        XCTAssertEqual(
            route("https://www.preisora.de/product/\(productId)"),
            .product(.id(productId))
        )
    }

    func testTrailingSlashIsTolerated() {
        XCTAssertEqual(
            route("https://preisora.de/product/\(productId)/"),
            .product(.id(productId))
        )
    }

    func testQueryParametersAreIgnored() {
        // "Query parameters are never required to resolve the target."
        XCTAssertEqual(
            route("https://preisora.de/product/\(productId)?utm_source=share"),
            .product(.id(productId))
        )
    }

    // MARK: - Custom scheme (universal links are deferred)

    func testCustomSchemePatterns() {
        XCTAssertEqual(
            route("preisora://product/\(productId)"),
            .product(.id(productId))
        )
        XCTAssertEqual(route("preisora://store/\(storeId)"), .store(id: storeId))
        XCTAssertEqual(
            route("preisora://p/vollmilch-3-5-1l"),
            .product(.slug("vollmilch-3-5-1l"))
        )
    }

    // MARK: - Rejections (never a crash)

    func testForeignHostIsRejected() {
        XCTAssertNil(route("https://example.com/product/\(productId)"))
        XCTAssertNil(route("https://preisora.de.evil.com/product/\(productId)"))
    }

    func testUnknownResourceIsRejected() {
        XCTAssertNil(route("https://preisora.de/basket/\(productId)"))
    }

    func testWrongSegmentCountIsRejected() {
        XCTAssertNil(route("https://preisora.de/product"))
        XCTAssertNil(route("https://preisora.de/product/\(productId)/offers"))
        XCTAssertNil(route("https://preisora.de/"))
    }

    func testForeignSchemeIsRejected() {
        XCTAssertNil(route("preisora-app://product/\(productId)"))
        XCTAssertNil(route("mailto:hallo@preisora.de"))
    }

    // MARK: - Analytics mapping

    func testDeepLinkTypeMapping() {
        XCTAssertEqual(Route.product(.id(productId)).deepLinkType, .product)
        XCTAssertEqual(Route.product(.slug("x")).deepLinkType, .productSlug)
        XCTAssertEqual(Route.store(id: storeId).deepLinkType, .store)
        XCTAssertEqual(
            Route.reservedDeepLink(.listInvite(token: "t")).deepLinkType,
            .listInvite
        )
        // A GTIN reference is internal navigation, not a link pattern.
        XCTAssertNil(Route.product(.gtin("4012345678901")).deepLinkType)
        XCTAssertNil(Route.storesMap(productId: nil).deepLinkType)
    }

    // MARK: - Round trip with the share service

    func testSharedLinksParseBackToTheirRoute() {
        let sharing = ShareLinkService()

        XCTAssertEqual(
            Route(deepLinkURL: sharing.productURL(id: productId)),
            .product(.id(productId))
        )
        XCTAssertEqual(
            Route(deepLinkURL: sharing.productURL(slug: "vollmilch-3-5-1l")),
            .product(.slug("vollmilch-3-5-1l"))
        )
        XCTAssertEqual(
            Route(deepLinkURL: sharing.storeURL(id: storeId)),
            .store(id: storeId)
        )
    }

    func testShareURLsUseTheCanonicalHost() {
        let sharing = ShareLinkService()
        XCTAssertEqual(
            sharing.productURL(id: productId).absoluteString,
            "https://preisora.de/product/\(productId)"
        )
        XCTAssertEqual(
            sharing.storeURL(id: storeId).absoluteString,
            "https://preisora.de/store/\(storeId)"
        )
    }
}
