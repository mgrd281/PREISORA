//
//  AnalyticsEvent.swift
//  Services — the typed mirror of docs/analytics-taxonomy.md.
//
//  ONE taxonomy across all platforms (constitution §18):
//   • `snake_case`, `object_action`, past tense for completed facts.
//   • PLATFORM IS NEVER PART OF THE NAME — it is a common property attached by the
//     tracker (`ios_scan_success` is forbidden).
//   • Money as minor units (integer) + `currency_code`. Identifiers are canonical
//     UUIDs / GTIN strings. NO PII in any property.
//
//  Adding an event means adding a row to the taxonomy doc first, then a case here.
//

import Foundation

/// How a barcode entered the funnel.
enum ScanInputMode: String {
    case camera
    case manual
}

/// Which canonical deep-link pattern opened the app.
enum DeepLinkType: String {
    case product
    case productSlug = "product_slug"
    case store
    case listInvite = "list_invite"
    case alert
    case promotion
}

/// A single analytics property value. Keeps integers integral on the way to a real
/// sink (the console sink stringifies at the very end, not before).
enum AnalyticsPropertyValue: Hashable {
    case string(String)
    case integer(Int)
    case boolean(Bool)

    var loggableDescription: String {
        switch self {
        case .string(let value): return value
        case .integer(let value): return String(value)
        case .boolean(let value): return value ? "true" : "false"
        }
    }
}

/// The phase-1 core events. Names and property keys are copied verbatim from
/// docs/analytics-taxonomy.md.
enum AnalyticsEvent {
    /// Scanner UI opened.
    case scanStarted(inputMode: ScanInputMode)
    /// GTIN recognized/entered and checksum-valid.
    case barcodeDetected(gtin: String)
    /// Product lookup succeeded.
    case productResolved(productId: String, gtin: String)
    /// Offers response rendered.
    case pricesLoaded(productId: String, offerCount: Int, radiusMeters: Int)
    /// Best offer visible to the user.
    case bestOfferViewed(productId: String, storeId: String?, amountMinor: Int, currencyCode: String)
    /// Favorite created.
    case favoriteAdded(productId: String)
    /// Price alert created. (Modelled now; the Alerts screen is a typed empty state.)
    case alertCreated(productId: String, targetAmountMinor: Int, currencyCode: String)
    /// Optimization result rendered. (Modelled now; the optimizer UI is deferred.)
    case shoppingListOptimized(
        listId: String,
        strategy: String,
        storeCount: Int,
        totalAmountMinor: Int,
        currencyCode: String
    )
    /// Search query submitted.
    case searchPerformed(queryLength: Int, resultCount: Int)
    /// App opened via a canonical URL.
    case deepLinkOpened(linkType: DeepLinkType)
    /// Error state rendered.
    case errorShown(errorCode: String, retryable: Bool)

    var name: String {
        switch self {
        case .scanStarted: return "scan_started"
        case .barcodeDetected: return "barcode_detected"
        case .productResolved: return "product_resolved"
        case .pricesLoaded: return "prices_loaded"
        case .bestOfferViewed: return "best_offer_viewed"
        case .favoriteAdded: return "favorite_added"
        case .alertCreated: return "alert_created"
        case .shoppingListOptimized: return "shopping_list_optimized"
        case .searchPerformed: return "search_performed"
        case .deepLinkOpened: return "deep_link_opened"
        case .errorShown: return "error_shown"
        }
    }

    /// Event-specific properties ONLY. The common properties (`platform`,
    /// `app_version`, `locale`, `country_code`) are added by the tracker.
    var properties: [String: AnalyticsPropertyValue] {
        switch self {
        case .scanStarted(let inputMode):
            return ["input_mode": .string(inputMode.rawValue)]

        case .barcodeDetected(let gtin):
            return ["gtin": .string(gtin)]

        case .productResolved(let productId, let gtin):
            return ["product_id": .string(productId), "gtin": .string(gtin)]

        case .pricesLoaded(let productId, let offerCount, let radiusMeters):
            return [
                "product_id": .string(productId),
                "offer_count": .integer(offerCount),
                "radius_meters": .integer(radiusMeters)
            ]

        case .bestOfferViewed(let productId, let storeId, let amountMinor, let currencyCode):
            var result: [String: AnalyticsPropertyValue] = [
                "product_id": .string(productId),
                "amount_minor": .integer(amountMinor),
                "currency_code": .string(currencyCode)
            ]
            // Market-wide offers have no store; the property is omitted rather than
            // sent as a fake value.
            if let storeId {
                result["store_id"] = .string(storeId)
            }
            return result

        case .favoriteAdded(let productId):
            return ["product_id": .string(productId)]

        case .alertCreated(let productId, let targetAmountMinor, let currencyCode):
            return [
                "product_id": .string(productId),
                "target_amount_minor": .integer(targetAmountMinor),
                "currency_code": .string(currencyCode)
            ]

        case .shoppingListOptimized(
            let listId,
            let strategy,
            let storeCount,
            let totalAmountMinor,
            let currencyCode
        ):
            return [
                "list_id": .string(listId),
                "strategy": .string(strategy),
                "store_count": .integer(storeCount),
                "total_amount_minor": .integer(totalAmountMinor),
                "currency_code": .string(currencyCode)
            ]

        case .searchPerformed(let queryLength, let resultCount):
            // Deliberately the LENGTH, never the query text (no PII).
            return [
                "query_length": .integer(queryLength),
                "result_count": .integer(resultCount)
            ]

        case .deepLinkOpened(let linkType):
            return ["link_type": .string(linkType.rawValue)]

        case .errorShown(let errorCode, let retryable):
            return ["error_code": .string(errorCode), "retryable": .boolean(retryable)]
        }
    }
}
