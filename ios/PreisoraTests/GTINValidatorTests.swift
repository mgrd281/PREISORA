//
//  GTINValidatorTests.swift
//  PreisoraTests
//
//  The validator is a UX pre-flight, not the authority — but it must never accept a
//  GTIN the server would reject with `INVALID_GTIN`, and never reject a valid one.
//

import Foundation
import XCTest
@testable import Preisora

final class GTINValidatorTests: XCTestCase {

    // MARK: - Valid codes

    func testValidEAN13FromContractExample() {
        // api-contract/examples/product.yaml uses this GTIN.
        XCTAssertTrue(GTINValidator.isValid("4012345678901"))
    }

    func testValidDemoSeedGTINs() {
        for gtin in MockBarcodeScanner.demoGTINs {
            XCTAssertTrue(
                GTINValidator.isValid(gtin),
                "Demo GTIN \(gtin) must have a valid check digit"
            )
        }
    }

    func testValidEAN8() {
        // 2012345 + check digit 1
        XCTAssertEqual(GTINValidator.checkDigit(forPayload: "2012345"), 1)
        XCTAssertTrue(GTINValidator.isValid("20123451"))
        XCTAssertFalse(GTINValidator.isValid("20123456"))
    }

    func testValidUPCA() {
        // 03600029145 + check digit 2 (a classic UPC-A example)
        XCTAssertEqual(GTINValidator.checkDigit(forPayload: "03600029145"), 2)
        XCTAssertTrue(GTINValidator.isValid("036000291452"))
    }

    func testValidGTIN14() {
        // 1401234567890 + check digit 8
        XCTAssertEqual(GTINValidator.checkDigit(forPayload: "1401234567890"), 8)
        XCTAssertTrue(GTINValidator.isValid("14012345678908"))
    }

    func testLeadingZerosAreSignificant() {
        // Stripping the leading zero would turn a valid GTIN-13 into an invalid 12.
        let normalized = GTINValidator.normalize("0012345678905")
        XCTAssertEqual(normalized, "0012345678905")
        XCTAssertEqual(normalized?.count, 13)
        XCTAssertTrue(GTINValidator.isValid("0012345678905"))
    }

    // MARK: - Invalid codes

    func testWrongCheckDigitIsRejected() {
        XCTAssertFalse(GTINValidator.isValid("4012345678902"))
        XCTAssertFalse(GTINValidator.isValid("4012345678900"))
    }

    func testWrongLengthIsRejected() {
        XCTAssertFalse(GTINValidator.isValid("401234567890"))    // 12 digits, bad check
        XCTAssertFalse(GTINValidator.isValid("40123456789012345")) // 17 digits
        XCTAssertFalse(GTINValidator.isValid("1234567"))          // 7 digits
        XCTAssertFalse(GTINValidator.isValid(""))
    }

    func testNonDigitsAreRejected() {
        XCTAssertFalse(GTINValidator.isValid("4012345abc901"))
        XCTAssertNil(GTINValidator.normalize("40123456789O1")) // capital O, not zero
    }

    // MARK: - Normalization

    func testSeparatorsAreStripped() {
        XCTAssertEqual(GTINValidator.normalize(" 4012 3456-7890.1 "), "4012345678901")
        XCTAssertEqual(GTINValidator.normalizedIfValid("4012 3456 7890 1"), "4012345678901")
    }

    func testNormalizedIfValidRejectsBadChecksum() {
        XCTAssertNil(GTINValidator.normalizedIfValid("4012 3456 7890 2"))
    }

    func testCheckDigitMatchesKnownValue() {
        XCTAssertEqual(GTINValidator.checkDigit(forPayload: "401234567890"), 1)
        XCTAssertNil(GTINValidator.checkDigit(forPayload: ""))
        XCTAssertNil(GTINValidator.checkDigit(forPayload: "12a4"))
    }
}
