# PREISORA Domain Glossary

One canonical vocabulary, used identically across **backend, API contract, iOS, future Android,
analytics, and documentation** (constitution §5). If a concept is not in this glossary, propose it
here first — do not invent a synonym in code.

## Core entities

| Term | Definition |
|---|---|
| **Product** | A purchasable item with a permanent canonical identity: internal UUID (`id`), `gtin`, and canonical `slug`. Public identifiers are never platform-local database keys (§20). |
| **GTIN** | Global Trade Item Number (EAN-8 / UPC-A / EAN-13 / GTIN-14). Always a **string** (leading zeros matter), checksum-validated. The barcode scan output. |
| **Offer** | The *current* price of a Product at a Store (or uniformly across a RetailerMarket). Server-computed fields (`isBest`, freshness, effective price after Promotion) are part of the Offer — clients never re-derive them (§22). |
| **PriceObservation** | An append-only historical record of a price seen for a Product at a Store/market at a point in time. Feeds price history aggregation. |
| **Retailer** | A retail brand/chain (e.g. a supermarket brand). May operate in multiple countries. |
| **RetailerMarket** | A Retailer's presence in one country (`retailerId` + `countryCode` + `currencyCode`). Offers and assortments are per-market — never assume identical pricing across countries (§25). |
| **Store** | A physical location of a RetailerMarket: `id`, `lat`, `lng`, `address`, and raw `distanceMeters` when a query location is given. Never a map-provider object (§9). |
| **Location** | Generic geographic model: `lat`, `lng`, `accuracy?`, `postalCode?`, `city?`, `countryCode?` (§8). Platform-neutral — not CLLocation, not a Google LatLng. |
| **Promotion** | A time-bounded price modifier attached to an Offer (percentage, absolute; multibuy/loyalty types stored but not yet evaluated). Eligibility is decided server-side (§22). |
| **Favorite** | A user's bookmark of a Product. Unique per (user, product). |
| **PriceAlert** | A user's standing request to be notified when a Product's best fresh price within a radius drops below a target. Evaluated by ONE backend alert engine (§10). |
| **ShoppingList** | A user-owned list of ShoppingListItems (Product + quantity). |
| **OptimizationResult** | Output of the shopping optimizer (§23): stores (each with `distanceMeters`), items per store, total price, estimated savings, unavailable items, and `confidence`. Strategies: `cheapest_total`, `fewest_stores`, `balanced`. Computed only server-side. |
| **User** | A PREISORA account. `users.id` (UUID) is the **only** primary identity. |
| **UserIdentity** | A linked sign-in method (`anonymous`, `email`, `apple`, `google`) resolving to one User. Apple ID is never the database primary identity (§11). |
| **Device** | A registered client device: `id`, `userId`, `platform` (`ios` \| `android`), `pushToken`, `appVersion`, `locale`, `createdAt`, `lastSeenAt` (§10). |
| **Capability** | A backend-declared feature availability entry (`priceHistory`, `priceAlerts`, `shoppingOptimizer`, `receiptScanner`, `visualProductScan`), resolved per country/platform/appVersion/cohort (§16–17). |
| **Money** | `{ amountMinor: integer, currencyCode: ISO-4217 }`. Never floats on the wire; never an implicit EUR (§24). |

## Anti-patterns (constitution §2 — never do this)

- `AppleProductCard`, `MapKitStore`, `SwiftPriceModel`, `IOSFavorite` — Apple/platform naming in shared models.
- Calling the same object `PriceResult` on iOS, `Deal` on backend, `OfferItem` on Android.
- APNs identifiers or SwiftUI view shapes in API responses.
- Platform-local DB ids as public identifiers.
- `ios_scan_success` / `android_scan_success` analytics events — platform is an event **property** (§18).
- Hardcoded `"DE"` / `"EUR"` / German units inside business logic (§24) — market defaults live only in configuration.

## Error vocabulary (§32)

Single wire contract: `{ code, messageKey, details, retryable }`.

Catalog (mirrored verbatim in `backend/src/common/errors/error-codes.ts`, the OpenAPI `Error` schema,
and iOS `APIErrorCode`): `PRODUCT_NOT_FOUND`, `RESOURCE_NOT_FOUND`, `NO_CURRENT_PRICES`,
`INVALID_GTIN`, `LOCATION_REQUIRED`, `RATE_LIMITED`, `SERVICE_TEMPORARILY_UNAVAILABLE`,
`VALIDATION_FAILED`, `FEATURE_NOT_AVAILABLE`, `UNAUTHORIZED`.

`PRODUCT_NOT_FOUND` is specific to product resolution (by id, GTIN, slug, or a referenced
`productId`); every other missing resource — store, retailer, price alert, shopping list,
list item, device, identity — answers `RESOURCE_NOT_FOUND` with a precise `messageKey`.

Clients localize their own user-facing copy from `messageKey`; the backend never sends UI text (§33).
