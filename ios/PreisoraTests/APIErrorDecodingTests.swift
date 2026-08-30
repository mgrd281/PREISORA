//
//  APIErrorDecodingTests.swift
//  PreisoraTests
//
//  The error contract is the one wire shape every 4xx/5xx uses. Two rules are tested
//  here because breaking either is a runtime crash or a lie in the UI:
//   1. All TEN codes of the closed catalog decode to their typed case.
//   2. An UNKNOWN code degrades to `.unknown(...)` instead of throwing
//      (CONVENTIONS.md: "Clients MUST tolerate unknown `code` values").
//

import Foundation
import XCTest
@testable import Preisora

final class APIErrorDecodingTests: XCTestCase {

    private let decoder = APIClient.makeDecoder()

    private func decodeEnvelope(_ json: String) throws -> APIError {
        let data = Data(json.utf8)
        let envelope = try decoder.decode(APIErrorEnvelope.self, from: data)
        return envelope.asAPIError(httpStatus: 400)
    }

    // MARK: - The closed catalog

    func testAllTenContractCodesDecode() throws {
        let expectations: [(String, APIErrorCode)] = [
            ("PRODUCT_NOT_FOUND", .productNotFound),
            ("RESOURCE_NOT_FOUND", .resourceNotFound),
            ("NO_CURRENT_PRICES", .noCurrentPrices),
            ("INVALID_GTIN", .invalidGTIN),
            ("LOCATION_REQUIRED", .locationRequired),
            ("RATE_LIMITED", .rateLimited),
            ("SERVICE_TEMPORARILY_UNAVAILABLE", .serviceTemporarilyUnavailable),
            ("VALIDATION_FAILED", .validationFailed),
            ("FEATURE_NOT_AVAILABLE", .featureNotAvailable),
            ("UNAUTHORIZED", .unauthorized)
        ]

        XCTAssertEqual(expectations.count, 10, "The catalog is closed at ten codes")

        for (wire, expected) in expectations {
            let json = """
            {"code":"\(wire)","messageKey":"error.sample","details":null,"retryable":false}
            """
            let error = try decodeEnvelope(json)
            XCTAssertEqual(error.code, expected, "\(wire) must decode to \(expected)")
            XCTAssertEqual(error.code.wireValue, wire, "round trip for \(wire)")
        }
    }

    func testEveryCodeHasAFallbackMessageKey() {
        let codes: [APIErrorCode] = [
            .productNotFound, .resourceNotFound, .noCurrentPrices, .invalidGTIN,
            .locationRequired, .rateLimited, .serviceTemporarilyUnavailable,
            .validationFailed, .featureNotAvailable, .unauthorized
        ]
        for code in codes {
            XCTAssertTrue(
                code.fallbackMessageKey.hasPrefix("error."),
                "\(code.wireValue) needs a dot-namespaced key"
            )
        }
    }

    // MARK: - Forward compatibility

    func testUnknownCodeFallsBackGracefully() throws {
        let json = """
        {"code":"TEAPOT_OVERHEATED","messageKey":"error.teapot","details":null,"retryable":true}
        """
        let error = try decodeEnvelope(json)
        XCTAssertEqual(error.code, .unknown("TEAPOT_OVERHEATED"))
        XCTAssertEqual(error.code.wireValue, "TEAPOT_OVERHEATED")
        XCTAssertTrue(error.retryable)
        // The server's own messageKey still wins over the generic fallback.
        XCTAssertEqual(error.localizationKey, "error.teapot")
    }

    func testUnknownCodeWithoutMessageKeyUsesGenericKey() throws {
        let json = """
        {"code":"SOMETHING_NEW","details":null,"retryable":false}
        """
        let error = try decodeEnvelope(json)
        XCTAssertEqual(error.code, .unknown("SOMETHING_NEW"))
        XCTAssertEqual(error.localizationKey, "error.unknown")
    }

    // MARK: - Envelope details

    func testNoCurrentPricesExampleFromTheContract() throws {
        // api-contract/examples/error-no-current-prices.yaml
        let json = """
        {
          "code": "NO_CURRENT_PRICES",
          "messageKey": "error.no_current_prices",
          "details": {
            "productId": "3fa2d1b8-5c44-4a7e-9b0e-6f2a91c47d55",
            "radiusMeters": 5000,
            "freshnessWindowHours": 72
          },
          "retryable": false
        }
        """
        let error = try decodeEnvelope(json)
        XCTAssertEqual(error.code, .noCurrentPrices)
        XCTAssertFalse(error.retryable)
        XCTAssertEqual(error.details?["radiusMeters"], .integer(5000))
        XCTAssertEqual(
            error.details?["productId"],
            .string("3fa2d1b8-5c44-4a7e-9b0e-6f2a91c47d55")
        )
    }

    func testNullDetailsDecodeToNil() throws {
        let json = """
        {"code":"UNAUTHORIZED","messageKey":"error.unauthorized","details":null,"retryable":false}
        """
        let error = try decodeEnvelope(json)
        XCTAssertNil(error.details)
    }

    func testNestedDetailsDoNotThrow() throws {
        let json = """
        {
          "code": "VALIDATION_FAILED",
          "messageKey": "error.validation_failed",
          "details": {"fields": [{"name": "gtin", "issue": "pattern"}], "ok": false},
          "retryable": false
        }
        """
        let error = try decodeEnvelope(json)
        XCTAssertEqual(error.code, .validationFailed)
        XCTAssertEqual(error.details?["ok"], .boolean(false))
    }

    // MARK: - Synthetic errors

    func testTransportFailureIsRetryableServiceUnavailable() {
        let error = APIError.transportFailure(underlying: URLError(.notConnectedToInternet))
        XCTAssertEqual(error.code, .serviceTemporarilyUnavailable)
        XCTAssertTrue(error.retryable)
        XCTAssertNil(error.httpStatus)
        XCTAssertEqual(error.localizationKey, "error.service_temporarily_unavailable")
    }

    func testDecodingFailureIsNotRetryable() {
        let underlying = DecodingError.valueNotFound(
            String.self,
            DecodingError.Context(codingPath: [], debugDescription: "missing")
        )
        let error = APIError.decodingFailure(underlying: underlying, httpStatus: 200)
        XCTAssertFalse(error.retryable)
        XCTAssertEqual(error.httpStatus, 200)
        XCTAssertEqual(error.code, .unknown("CLIENT_DECODING_FAILED"))
    }
}
