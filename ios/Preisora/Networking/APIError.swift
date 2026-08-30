//
//  APIError.swift
//  Networking — mirrors the ONE wire error envelope, `schemas/Error.yaml`.
//
//  `{ code, messageKey, details, retryable }` — every 4xx/5xx body in the API uses it.
//  The `code` catalog is closed and mirrored verbatim in
//  `backend/src/common/errors/error-codes.ts`, the OpenAPI `Error` schema and
//  `docs/domain-glossary.md`. Growing it must update all four in one change.
//
//  Two client rules from CONVENTIONS.md are load-bearing here:
//   1. An unrecognized `code` maps to a generic failure — never a crash (`.unknown`).
//   2. `retryable: true` is the ONLY signal for offering a retry affordance.
//

import Foundation

/// The closed error-code catalog (constitution §32) plus a forward-compatible carrier.
enum APIErrorCode: Hashable {
    /// A Product could not be resolved (by id, GTIN, slug, or as a request-body reference).
    case productNotFound
    /// Every other missing resource: store, retailer, alert, list, item, device, identity.
    case resourceNotFound
    /// Product exists, but zero offers in radius pass the freshness window (HTTP 404).
    case noCurrentPrices
    /// GTIN failed format/checksum validation server-side (HTTP 400).
    case invalidGTIN
    /// A geo operation was called without a usable coordinate pair (HTTP 400).
    case locationRequired
    /// Throttled (HTTP 429). Retryable.
    case rateLimited
    /// Transient backend failure (HTTP 500/503). Retryable.
    case serviceTemporarilyUnavailable
    /// Request validation failed (HTTP 400).
    case validationFailed
    /// Operation is specified but stubbed (HTTP 501).
    case featureNotAvailable
    /// Missing/invalid credentials (HTTP 401).
    case unauthorized
    /// A code this client build does not know yet — render the generic failure state.
    case unknown(String)

    init(wireValue: String) {
        switch wireValue {
        case "PRODUCT_NOT_FOUND": self = .productNotFound
        case "RESOURCE_NOT_FOUND": self = .resourceNotFound
        case "NO_CURRENT_PRICES": self = .noCurrentPrices
        case "INVALID_GTIN": self = .invalidGTIN
        case "LOCATION_REQUIRED": self = .locationRequired
        case "RATE_LIMITED": self = .rateLimited
        case "SERVICE_TEMPORARILY_UNAVAILABLE": self = .serviceTemporarilyUnavailable
        case "VALIDATION_FAILED": self = .validationFailed
        case "FEATURE_NOT_AVAILABLE": self = .featureNotAvailable
        case "UNAUTHORIZED": self = .unauthorized
        default: self = .unknown(wireValue)
        }
    }

    var wireValue: String {
        switch self {
        case .productNotFound: return "PRODUCT_NOT_FOUND"
        case .resourceNotFound: return "RESOURCE_NOT_FOUND"
        case .noCurrentPrices: return "NO_CURRENT_PRICES"
        case .invalidGTIN: return "INVALID_GTIN"
        case .locationRequired: return "LOCATION_REQUIRED"
        case .rateLimited: return "RATE_LIMITED"
        case .serviceTemporarilyUnavailable: return "SERVICE_TEMPORARILY_UNAVAILABLE"
        case .validationFailed: return "VALIDATION_FAILED"
        case .featureNotAvailable: return "FEATURE_NOT_AVAILABLE"
        case .unauthorized: return "UNAUTHORIZED"
        case .unknown(let value): return value
        }
    }

    /// The localization key this client falls back to when the server's `messageKey`
    /// is missing or unknown. Matches the server's own `messageKey` convention so the
    /// two are interchangeable (`error.product_not_found`, …).
    var fallbackMessageKey: String {
        switch self {
        case .productNotFound: return "error.product_not_found"
        case .resourceNotFound: return "error.resource_not_found"
        case .noCurrentPrices: return "error.no_current_prices"
        case .invalidGTIN: return "error.invalid_gtin"
        case .locationRequired: return "error.location_required"
        case .rateLimited: return "error.rate_limited"
        case .serviceTemporarilyUnavailable: return "error.service_temporarily_unavailable"
        case .validationFailed: return "error.validation_failed"
        case .featureNotAvailable: return "error.feature_not_available"
        case .unauthorized: return "error.unauthorized"
        case .unknown: return "error.unknown"
        }
    }
}

/// A decoded error envelope, or a synthetic one for transport/decoding failures.
struct APIError: Error, Hashable {
    let code: APIErrorCode
    /// Dot-namespaced localization key resolved by the client (§33). Doubles as the
    /// key in `Localizable.xcstrings`.
    let messageKey: String
    /// Free-form machine-readable context, or `nil`.
    let details: [String: JSONValue]?
    /// The ONLY signal for offering a retry affordance.
    let retryable: Bool
    /// HTTP status, when the failure came from a response. `nil` for synthetic errors.
    let httpStatus: Int?

    init(
        code: APIErrorCode,
        messageKey: String,
        details: [String: JSONValue]?,
        retryable: Bool,
        httpStatus: Int?
    ) {
        self.code = code
        self.messageKey = messageKey
        self.details = details
        self.retryable = retryable
        self.httpStatus = httpStatus
    }

    /// The localization key to render: the server's when we have one, else the
    /// per-code fallback.
    var localizationKey: String {
        messageKey.isEmpty ? code.fallbackMessageKey : messageKey
    }

    /// Normalizes any thrown error into the one type the UI renders. Everything the
    /// client throws is already an `APIError`; anything else is a transport problem.
    static func from(_ error: Error) -> APIError {
        if let apiError = error as? APIError {
            return apiError
        }
        return APIError.transportFailure(underlying: error)
    }

    // MARK: - Synthetic errors (no envelope on the wire)

    /// URLSession transport failure (offline, DNS, TLS, timeout) → a synthetic,
    /// RETRYABLE `SERVICE_TEMPORARILY_UNAVAILABLE`, so the UI offers "Retry" exactly
    /// like it does for a real 503.
    static func transportFailure(underlying: Error) -> APIError {
        APIError(
            code: .serviceTemporarilyUnavailable,
            messageKey: APIErrorCode.serviceTemporarilyUnavailable.fallbackMessageKey,
            details: ["transport": .string(String(describing: underlying))],
            retryable: true,
            httpStatus: nil
        )
    }

    /// The response arrived but could not be understood (bad JSON, contract drift).
    /// NOT retryable — retrying identical bytes cannot help.
    static func decodingFailure(underlying: Error, httpStatus: Int?) -> APIError {
        APIError(
            code: .unknown("CLIENT_DECODING_FAILED"),
            messageKey: "error.client_decoding_failed",
            details: ["reason": .string(String(describing: underlying))],
            retryable: false,
            httpStatus: httpStatus
        )
    }

    /// A non-HTTP response, or an error status with an unparsable body.
    static func malformedResponse(httpStatus: Int?) -> APIError {
        APIError(
            code: .serviceTemporarilyUnavailable,
            messageKey: APIErrorCode.serviceTemporarilyUnavailable.fallbackMessageKey,
            details: nil,
            retryable: true,
            httpStatus: httpStatus
        )
    }
}

// MARK: - Wire decoding

/// The literal envelope as it appears on the wire.
struct APIErrorEnvelope: Decodable {
    let code: String
    let messageKey: String
    let details: [String: JSONValue]?
    let retryable: Bool

    enum CodingKeys: String, CodingKey {
        case code
        case messageKey
        case details
        case retryable
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.code = try container.decode(String.self, forKey: .code)
        // Defensive: a body missing `messageKey`/`retryable` must still yield a usable
        // error rather than throwing inside the error path itself.
        self.messageKey = try container.decodeIfPresent(String.self, forKey: .messageKey) ?? ""
        self.details = try container.decodeIfPresent([String: JSONValue].self, forKey: .details)
        self.retryable = try container.decodeIfPresent(Bool.self, forKey: .retryable) ?? false
    }

    func asAPIError(httpStatus: Int?) -> APIError {
        let parsedCode = APIErrorCode(wireValue: code)
        return APIError(
            code: parsedCode,
            messageKey: messageKey.isEmpty ? parsedCode.fallbackMessageKey : messageKey,
            details: details,
            retryable: retryable,
            httpStatus: httpStatus
        )
    }
}

/// Minimal JSON value used for the free-form `details` object.
/// Kept deliberately small: `details` is machine-readable context, not a payload.
enum JSONValue: Decodable, Hashable {
    case string(String)
    case integer(Int)
    case number(Double)
    case boolean(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
            return
        }
        if let value = try? container.decode(Bool.self) {
            self = .boolean(value)
            return
        }
        if let value = try? container.decode(Int.self) {
            self = .integer(value)
            return
        }
        if let value = try? container.decode(Double.self) {
            self = .number(value)
            return
        }
        if let value = try? container.decode(String.self) {
            self = .string(value)
            return
        }
        if let value = try? container.decode([String: JSONValue].self) {
            self = .object(value)
            return
        }
        if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
            return
        }
        throw DecodingError.dataCorruptedError(
            in: container,
            debugDescription: "Unsupported JSON value in error details"
        )
    }

    /// Display/debug rendering — never parsed for behaviour.
    var stringValue: String {
        switch self {
        case .string(let value): return value
        case .integer(let value): return String(value)
        case .number(let value): return String(value)
        case .boolean(let value): return value ? "true" : "false"
        case .object: return "{…}"
        case .array: return "[…]"
        case .null: return "null"
        }
    }
}
