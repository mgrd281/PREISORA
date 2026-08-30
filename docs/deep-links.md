# PREISORA Deep Links (canonical URL grammar)

Deep links exist **from day one** (constitution §19) and are platform-neutral: the same URL must
later open the iOS app, the Android app, or a web fallback. Public identifiers are permanent
canonical IDs (§20) — never platform-local database keys.

## Canonical patterns

| Resource | URL | Identifier |
|---|---|---|
| Product | `https://preisora.de/product/{productId}` | Product UUID |
| Product (slug) | `https://preisora.de/p/{slug}` | canonical slug |
| Store | `https://preisora.de/store/{storeId}` | Store UUID |
| Shopping list invitation | `https://preisora.de/list-invite/{token}` | opaque invite token *(reserved)* |
| Price alert | `https://preisora.de/alert/{alertId}` | PriceAlert UUID *(reserved)* |
| Promotion | `https://preisora.de/promotion/{promotionId}` | Promotion UUID *(reserved)* |

Rules:

- Paths are lowercase, singular resource nouns, one identifier segment. Query parameters are
  never required to resolve the target.
- Every pattern maps 1:1 to an API resource (`/api/v1/products/{id}`, `/api/v1/products/by-slug/{slug}`,
  `/api/v1/stores/{id}`, …) so any client resolves a link with one request.
- *(reserved)* patterns are fixed grammar now, activated when the feature ships — clients must
  route unknown-but-well-formed paths to a graceful fallback, never crash.

## Client handling

- **iOS (this repo):** `Route.init?(deepLinkURL:)` in `ios/Preisora/App/Route.swift` parses these
  patterns into the typed navigation `Route` enum; `PreisoraApp` attaches `onOpenURL`.
  Universal-link entitlements + AASA file hosting are **deferred** until the production domain is
  live (they cannot be validated without it) — the parsing layer is in place so enabling them is
  configuration, not code.
- **Android (future):** the same grammar feeds Android App Links intent filters; no separate
  iOS-only link model is ever introduced.
- **Web (future):** preisora.de serves the fallback rendering for every pattern.
