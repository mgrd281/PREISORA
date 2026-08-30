//
//  MoneyFormattingTests.swift
//  PreisoraTests
//
//  Money is integer minor units + a currency code. The two things that must never
//  regress: no Double ever touches the amount, and the currency is never assumed.
//
//  Assertions match on SUBSTRINGS, not on full formatter output: currency formatting
//  differs between OS versions (non-breaking vs. narrow no-break space), and a test
//  that pins the whole string is a false alarm waiting to happen.
//

import Foundation
import XCTest
@testable import Preisora

final class MoneyFormattingTests: XCTestCase {

    private let german = Locale(identifier: "de_DE")
    private let american = Locale(identifier: "en_US")

    func testDecimalAmountUsesExactDecimalArithmetic() {
        XCTAssertEqual(Money(amountMinor: 119, currencyCode: "EUR").decimalAmount, Decimal(string: "1.19"))
        XCTAssertEqual(Money(amountMinor: 1, currencyCode: "EUR").decimalAmount, Decimal(string: "0.01"))
        XCTAssertEqual(Money(amountMinor: 0, currencyCode: "EUR").decimalAmount, Decimal(0))
        XCTAssertEqual(Money(amountMinor: -250, currencyCode: "EUR").decimalAmount, Decimal(string: "-2.50"))
        XCTAssertEqual(
            Money(amountMinor: 123_456_789, currencyCode: "EUR").decimalAmount,
            Decimal(string: "1234567.89")
        )
    }

    func testGermanEuroFormatting() {
        let formatted = Money(amountMinor: 179, currencyCode: "EUR").formatted(locale: german)
        XCTAssertTrue(formatted.contains("1,79"), "expected German decimal comma in \(formatted)")
        XCTAssertTrue(formatted.contains("€"), "expected the euro sign in \(formatted)")
    }

    func testEnglishFormattingOfTheSameAmount() {
        let formatted = Money(amountMinor: 179, currencyCode: "EUR").formatted(locale: american)
        XCTAssertTrue(formatted.contains("1.79"), "expected a decimal point in \(formatted)")
    }

    func testCurrencyIsNeverAssumedToBeEuro() {
        let dollars = Money(amountMinor: 199, currencyCode: "USD").formatted(locale: american)
        XCTAssertTrue(dollars.contains("1.99"))
        XCTAssertFalse(dollars.contains("€"))

        let pounds = Money(amountMinor: 250, currencyCode: "GBP").formatted(locale: Locale(identifier: "en_GB"))
        XCTAssertTrue(pounds.contains("2.50"))
    }

    func testZeroDecimalCurrencyHasNoFractionDigits() {
        XCTAssertEqual(Money.fractionDigits(for: "JPY"), 0)
        let yen = Money(amountMinor: 1200, currencyCode: "JPY")
        XCTAssertEqual(yen.decimalAmount, Decimal(1200))
        let formatted = yen.formatted(locale: Locale(identifier: "ja_JP"))
        XCTAssertTrue(formatted.contains("1,200"), "expected grouped whole yen in \(formatted)")
        XCTAssertFalse(formatted.contains("."), "yen must not show fraction digits: \(formatted)")
    }

    func testThreeDecimalCurrency() {
        XCTAssertEqual(Money.fractionDigits(for: "KWD"), 3)
        XCTAssertEqual(
            Money(amountMinor: 1234, currencyCode: "KWD").decimalAmount,
            Decimal(string: "1.234")
        )
    }

    func testDefaultFractionDigitsAreTwo() {
        XCTAssertEqual(Money.fractionDigits(for: "EUR"), 2)
        XCTAssertEqual(Money.fractionDigits(for: "eur"), 2, "code comparison is case-insensitive")
        XCTAssertEqual(Money.fractionDigits(for: "XYZ"), 2)
    }

    // MARK: - Arithmetic guards

    func testSubtractionRequiresTheSameCurrency() {
        let euro = Money(amountMinor: 500, currencyCode: "EUR")
        let dollar = Money(amountMinor: 300, currencyCode: "USD")
        XCTAssertNil(euro.subtracting(dollar))
        XCTAssertEqual(
            euro.subtracting(Money(amountMinor: 300, currencyCode: "EUR")),
            Money(amountMinor: 200, currencyCode: "EUR")
        )
    }

    func testComparisonAcrossCurrenciesIsNeverTrue() {
        let euro = Money(amountMinor: 100, currencyCode: "EUR")
        let dollar = Money(amountMinor: 900, currencyCode: "USD")
        XCTAssertFalse(euro.isCheaper(than: dollar))
        XCTAssertTrue(euro.isCheaper(than: Money(amountMinor: 200, currencyCode: "EUR")))
    }

    // MARK: - Codable round trip

    func testMoneyRoundTripsThroughJSON() throws {
        let json = Data(#"{"amountMinor":179,"currencyCode":"EUR"}"#.utf8)
        let money = try JSONDecoder().decode(Money.self, from: json)
        XCTAssertEqual(money.amountMinor, 179)
        XCTAssertEqual(money.currencyCode, "EUR")

        let encoded = try JSONEncoder().encode(money)
        let decoded = try JSONDecoder().decode(Money.self, from: encoded)
        XCTAssertEqual(decoded, money)
    }

    // MARK: - Design-token drift guard

    func testTokensVersionMatchesTheDesignSpec() {
        // design-spec/tokens.json `version`. Bump both together (see Tokens.swift).
        XCTAssertEqual(Tokens.version, "1.0.0")
    }
}
