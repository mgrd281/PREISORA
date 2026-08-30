//
//  GTIN.swift
//  Domain — GTIN normalization + checksum.
//
//  THE SERVER REMAINS THE AUTHORITY. This validator exists purely as a UX pre-flight:
//  it lets the scanner reject obvious mis-reads and the manual-entry field show
//  inline feedback without a round trip. A GTIN that passes here is still validated
//  server-side, and a 400 `INVALID_GTIN` from the backend always wins.
//
//  Contract: `^\d{8}$|^\d{12,14}$` — a GTIN is ALWAYS a string; leading zeros are
//  significant and must never be stripped (constitution §20, CONVENTIONS.md).
//

import Foundation

enum GTINValidator {

    /// Lengths the contract accepts: GTIN-8, UPC-A (12), EAN-13, GTIN-14.
    static let acceptedLengths: Set<Int> = [8, 12, 13, 14]

    /// Removes surrounding whitespace and interior separators a human might type
    /// ("4012 3456 7890 1"), keeping every digit — including leading zeros.
    /// Returns `nil` when anything other than digits/separators is present.
    static func normalize(_ raw: String) -> String? {
        var digits = ""
        for character in raw {
            if character.isWhitespace || character == "-" || character == "." {
                continue
            }
            guard character.isASCII, character.isNumber else { return nil }
            digits.append(character)
        }
        return digits.isEmpty ? nil : digits
    }

    /// True when `raw` normalizes to an accepted length AND its check digit matches.
    static func isValid(_ raw: String) -> Bool {
        guard let normalized = normalize(raw) else { return false }
        guard acceptedLengths.contains(normalized.count) else { return false }
        return hasValidChecksum(normalized)
    }

    /// Normalizes and validates in one step; returns the wire-ready GTIN or `nil`.
    static func normalizedIfValid(_ raw: String) -> String? {
        guard let normalized = normalize(raw), acceptedLengths.contains(normalized.count),
              hasValidChecksum(normalized) else {
            return nil
        }
        return normalized
    }

    /// Standard GS1 mod-10 check: weights 3 and 1 alternating from the digit
    /// immediately left of the check digit, check = (10 - sum % 10) % 10.
    /// `digits` must already be normalized (digits only, accepted length).
    static func hasValidChecksum(_ digits: String) -> Bool {
        guard digits.count >= 2 else { return false }
        var values: [Int] = []
        values.reserveCapacity(digits.count)
        for character in digits {
            guard let value = character.wholeNumberValue, value >= 0, value <= 9 else {
                return false
            }
            values.append(value)
        }
        guard let checkDigit = values.last else { return false }
        let payload = values.dropLast()
        var sum = 0
        // Weight 3 for the rightmost payload digit, then alternating.
        for (offset, value) in payload.reversed().enumerated() {
            sum += value * (offset % 2 == 0 ? 3 : 1)
        }
        let expected = (10 - (sum % 10)) % 10
        return expected == checkDigit
    }

    /// Computes the check digit for a payload without one (used by tests/fixtures).
    static func checkDigit(forPayload payload: String) -> Int? {
        var sum = 0
        var values: [Int] = []
        for character in payload {
            guard let value = character.wholeNumberValue, value >= 0, value <= 9 else {
                return nil
            }
            values.append(value)
        }
        guard !values.isEmpty else { return nil }
        for (offset, value) in values.reversed().enumerated() {
            sum += value * (offset % 2 == 0 ? 3 : 1)
        }
        return (10 - (sum % 10)) % 10
    }
}
