//
//  Money.swift
//  Domain — mirrors `api-contract/schemas/Money.yaml` field-for-field.
//

import Foundation

/// An exact monetary amount.
///
/// Contract: `{ amountMinor: int64, currencyCode: string(^[A-Z]{3}$) }`.
/// Monetary values are NEVER floats and the currency is never an implicit EUR
/// (constitution §24). All arithmetic/formatting goes through `Decimal`.
struct Money: Codable, Hashable {

    /// Amount in the currency's minor unit (e.g. euro cents). `int64` on the wire.
    let amountMinor: Int

    /// ISO-4217 alphabetic currency code.
    let currencyCode: String

    init(amountMinor: Int, currencyCode: String) {
        self.amountMinor = amountMinor
        self.currencyCode = currencyCode
    }

    // MARK: - Minor-unit arithmetic helpers

    /// Currencies whose minor unit equals the major unit (no decimals).
    private static let zeroDecimalCurrencies: Set<String> = [
        "BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW",
        "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"
    ]

    /// Currencies with three decimal places.
    private static let threeDecimalCurrencies: Set<String> = [
        "BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"
    ]

    /// Number of fraction digits for a currency. Deterministic and locale-independent
    /// on purpose: the exponent is a property of the currency, not of the reader.
    static func fractionDigits(for currencyCode: String) -> Int {
        let code = currencyCode.uppercased()
        if zeroDecimalCurrencies.contains(code) { return 0 }
        if threeDecimalCurrencies.contains(code) { return 3 }
        return 2
    }

    /// The amount as an exact decimal in major units. Never a `Double`.
    var decimalAmount: Decimal {
        let digits = Money.fractionDigits(for: currencyCode)
        if digits == 0 {
            return Decimal(amountMinor)
        }
        let divisor = pow(Decimal(10), digits)
        return Decimal(amountMinor) / divisor
    }

    /// Localized currency string, e.g. `1,19 €` for `de_DE` / EUR.
    /// Falls back to `"<decimal> <code>"` if the formatter refuses the value.
    func formatted(locale: Locale = Locale.current) -> String {
        let digits = Money.fractionDigits(for: currencyCode)
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.locale = locale
        formatter.currencyCode = currencyCode
        formatter.minimumFractionDigits = digits
        formatter.maximumFractionDigits = digits
        let number = NSDecimalNumber(decimal: decimalAmount)
        if let formatted = formatter.string(from: number) {
            return formatted
        }
        return "\(number.stringValue) \(currencyCode)"
    }

    /// Difference `self - other`, or `nil` when the currencies differ
    /// (cross-currency arithmetic is a bug, never a silent conversion).
    func subtracting(_ other: Money) -> Money? {
        guard currencyCode == other.currencyCode else { return nil }
        return Money(amountMinor: amountMinor - other.amountMinor, currencyCode: currencyCode)
    }

    /// Whether this amount is strictly cheaper than `other` (same currency only).
    func isCheaper(than other: Money) -> Bool {
        guard currencyCode == other.currencyCode else { return false }
        return amountMinor < other.amountMinor
    }
}
