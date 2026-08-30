# PREISORA API Conventions

Cross-cutting rules of the contract in this directory. The split-file OpenAPI 3.1 spec
(`openapi.yaml` + `paths/` + `schemas/` + `parameters/` + `responses/` + `examples/`)
is the **design-first canon** (ADR-0003): implementations conform to it, never the
other way around. `npm run lint` must be green (zero errors, zero warnings) before any
contract change merges; `npm run bundle` emits `dist/openapi.bundled.{yaml,json}`;
`npm run typegen` regenerates `backend/src/generated/api-types.ts` from the JSON
bundle.

## Casing

- **JSON properties**: `camelCase`, everywhere, both directions (lint-enforced).
- **Paths**: `kebab-case` segments (`/products/by-gtin/{gtin}`, `/shopping-lists`,
  `/price-history`) with `camelCase` template parameters (`{productId}`) —
  lint-enforced.
- **Wire enums**: `lower_snake_case` (`cheapest_total`, `fewest_stores`) or single
  lowercase words (`fresh`, `ios`, `apple`) — **except** error codes, which are
  `UPPER_SNAKE_CASE` per the §32 catalog.
- **Headers**: standard HTTP casing (`Idempotency-Key`, `RateLimit-Limit`,
  `X-App-Platform`).

## Money and units

- Monetary amounts are **always** `Money { amountMinor: int64, currencyCode }` or
  explicit `...AmountMinor` integers (price-history points). **Never a float price
  anywhere on the wire; never an implicit EUR** (constitution §24).
- **Geo distances and radii are integer meters.** `radiusMeters` defaults to `5000`,
  maximum `50000`. `distanceMeters` is an integer. Coordinates are WGS-84 decimal
  degrees (`lat`/`lng` — the one place decimals are correct).
- GTIN is a **string** matching `^\d{8}$|^\d{12,14}$` — leading zeros are
  significant. Checksums are validated server-side; failures are 400 `INVALID_GTIN`
  before any lookup.

## Time

- All timestamps are RFC 3339 **UTC** `date-time` strings (`2026-08-29T16:20:00Z`).
- Aggregation buckets (price-history `points[].date`) are calendar `date` strings
  bucketed in UTC.

## Pagination (ADR-0002)

- Every list response is the Page envelope
  `{ data: [...], pageInfo: { nextCursor: string|null, hasMore: boolean } }`,
  modeled as per-resource `*Page` schemas.
- `nextCursor` is an opaque base64url composite key — clients pass it back verbatim
  and never construct or inspect it. A malformed/expired cursor is
  400 `VALIDATION_FAILED`.
- **Search** implements a real `(name, id)` cursor from day 1.
- **Geo-ordered lists** (`/stores`, `/products/{id}/offers`) are radius-bounded and
  capped at **50**; they always return `nextCursor: null`, `hasMore: false` today.
  The `(distanceMeters, id)` composite cursor is designed in ADR-0002 and lands
  additively.
- Small user-scoped lists (alerts, shopping lists, identities) are returned whole in
  the same envelope; adding `cursor`/`limit` parameters to them later is additive.
- No offset/limit pagination, no `COUNT(*)` totals anywhere in v1.

## Localization and country resolution

- Locale precedence: **`?locale` query > user profile > `Accept-Language` > `de-DE`**.
  The server echoes the applied locale in the **`Content-Language`** response header.
- `countryCode` resolution mirrors the same precedence (explicit parameter > user
  profile > request context > `DE` default) — defaults live only in backend
  configuration, never hardcoded in business logic (§24).
- Request context headers `X-App-Platform` and `X-App-Version` may be sent on any
  request; they feed capability resolution and analytics context (documented on
  `GET /capabilities`).
- The backend never sends user-facing copy: clients localize from `messageKey` (§33).

## Errors

- **One envelope**: `{ code, messageKey, details, retryable }` (`schemas/Error.yaml`).
  Every 4xx/5xx body `$ref`s it — lint-enforced.
- The `code` catalog is **closed** and mirrored verbatim in
  `docs/domain-glossary.md`, `backend/src/common/errors/error-codes.ts`, and iOS
  `APIErrorCode`: `PRODUCT_NOT_FOUND`, `RESOURCE_NOT_FOUND`, `NO_CURRENT_PRICES`,
  `INVALID_GTIN`, `LOCATION_REQUIRED`, `RATE_LIMITED`,
  `SERVICE_TEMPORARILY_UNAVAILABLE`, `VALIDATION_FAILED`, `FEATURE_NOT_AVAILABLE`,
  `UNAUTHORIZED`. Growing it is an additive change that must update all four places
  in one PR.
- Clients MUST tolerate unknown `code` values (map to a generic failure) — the
  catalog may grow within v1.
- `retryable: true` (`RATE_LIMITED`, `SERVICE_TEMPORARILY_UNAVAILABLE`) is the only
  signal for offering a retry affordance.
- **`NO_CURRENT_PRICES` is HTTP 404** on the offers endpoint when the product exists
  but zero offers within the radius pass the freshness window. Deliberate and
  isolated here so it can be revisited (a 200-with-empty-list alternative would be a
  breaking change to the error contract, not to the success shape).
- **Resource 404s**: two not-found codes, split by what is missing.
  **`PRODUCT_NOT_FOUND`** is the product funnel only — a Product that cannot be
  resolved by id, GTIN or slug, or a `productId` referenced in a request body
  (favorite, alert, shopping-list item). **`RESOURCE_NOT_FOUND`** covers every other
  missing resource (store, retailer, alert, shopping list, list item, device,
  identity). Either way the `messageKey` names the specific resource
  (`error.store_not_found`, `error.alert_not_found`, `error.product_not_found`, ...)
  with `details: {"resource": ...}`; clients branch on `code` and never on
  `messageKey`. Both codes are part of the closed catalog and are mirrored verbatim
  in `docs/domain-glossary.md`, `backend/src/common/errors/error-codes.ts` and iOS
  `APIErrorCode`.
- Ownership is never leaked: "exists but owned by someone else" is indistinguishable
  from 404.
- Duplicate email on register is 400 `VALIDATION_FAILED` with
  `messageKey: error.email_already_registered` — this platform avoids 409s in favor
  of natural-key idempotency semantics (see below).
- **429 `RATE_LIMITED`** is documented on **every** operation (throttling is global,
  Redis-backed and real) with `RateLimit-Limit` / `RateLimit-Remaining` /
  `RateLimit-Reset` headers.
- Any operation may additionally return 500/503 with the standard envelope
  (`SERVICE_TEMPORARILY_UNAVAILABLE`, `retryable: true`); the contract spells 503
  out only on `/health` to avoid noise.

## Idempotency

- **Natural-key idempotency now**:
  - Favorites are unique per (user, product): re-adding returns **200 with the
    existing row** (201 on first create).
  - Devices upsert on (user, platform, pushToken): re-registering returns **200 with
    the refreshed row** (201 on first create).
  - Shopping-list items are unique per (list, product): re-adding returns **200 with
    the existing item**.
  - **DELETE is always idempotent**: deleting an absent resource answers 204 (the
    parent still 404s if it does not exist, e.g. unknown list on item delete).
- The **`Idempotency-Key` header** (`parameters/IdempotencyKey.yaml`) is defined on
  the creating POST operations but carries `x-preisora-status: planned` — the server
  accepts and ignores it today; the name and shape are fixed so activating it is
  additive.

## Security model

- `bearerAuth` (JWT) protects everything user-scoped: users, devices, favorites,
  alerts, shopping lists, `auth/identities`, `users/me/preferences`.
- Anonymous (no auth): health, products, offers, price-history, stores, retailers,
  search, capabilities, and the auth token exchanges
  (`anonymous`/`register`/`login`/`refresh`/`oauth`).
- Anonymous-first funnel (§11): `POST /auth/anonymous` issues real tokens; email /
  Apple / Google become *linked identities* on the same `users.id` later.

## Naming decisions

- The price-comparison endpoint is **`GET /products/{productId}/offers`** — the
  canonical noun is **Offer** (glossary). The constitution's `/prices` sample is
  illustrative, not normative; this deviation is deliberate and recorded here.
- Explicit lookup prefixes instead of overloaded parameters:
  `/products/{productId}` (UUID), `/products/by-gtin/{gtin}`,
  `/products/by-slug/{slug}` (orchestrator decision #4). The literal segments can
  never collide with UUID/GTIN values, so the theoretical path ambiguity is
  accepted (`no-ambiguous-paths` is off, justified in `redocly.yaml`).
- Retailer responses embed `markets` (`RetailerWithMarkets`) so clients can resolve
  the `retailerMarketId` on every Offer/Store without extra round trips; the bare
  `Retailer` schema stays exactly `{id, name, slug}`.
- `POST /alerts` accepts the client's generic `Location` model (constitution §8);
  the stored alert exposes the anchoring `GeoPoint`.

## Evolution policy

- **Additive-only within v1**: new endpoints, new optional parameters, new response
  fields, new enum values (see error-code note above). No renames, no removals, no
  type changes, no semantics changes to existing fields.
- Clients MUST ignore unknown response fields and tolerate unknown enum values in
  responses.
- Schemas therefore never set `additionalProperties: false`.
- `x-preisora-status` lifecycle: `planned` -> `stubbed` (fully specified, answers
  501 `FEATURE_NOT_AVAILABLE`) -> `implemented`. Stubbed shapes are final — clients
  build against them from day 1 (ADR-0003).
- `PriceObservation.yaml` is canonical vocabulary shipped ahead of any endpoint: it
  is deliberately unreferenced (history is served pre-aggregated), so it does not
  enter the bundle yet; the raw-observations endpoint, when it ships, is additive.

## Review checklist (not lint-enforceable — check by hand)

The Redocly rules in `redocly.yaml` enforce: operationId on every operation,
`x-preisora-status` on every operation, every 4xx/5xx body `$ref`ing the Error
envelope, kebab-case paths, camelCase properties, valid examples. The following
could not be expressed as assertions and are reviewer duties:

1. Every 4xx/5xx response **has** an `application/json` body (the envelope rule only
   inspects responses that declare content; an empty-bodied error response would
   slip through).
2. The status-code filter in `rule/error-responses-use-error-envelope` enumerates
   codes; if you introduce an exotic status (e.g. 418), add it to the list.
3. Every list response uses a `*Page` schema wrapping `PageInfo` — never a bare
   array.
4. No `type: number` for anything monetary; new money fields go through `Money` or
   `...AmountMinor` integers.
5. New schema files: one schema per file, `PascalCase.yaml`, `title` matching the
   filename; request bodies end in `Request`, page envelopes in `Page`.
6. Resource-404 responses follow the "Resource 404s" convention above:
   `PRODUCT_NOT_FOUND` only when a Product cannot be resolved, `RESOURCE_NOT_FOUND`
   for every other missing resource, each with a precise `messageKey`.
7. Date-time example values are quoted strings in YAML (unquoted timestamps can be
   parsed as native dates by YAML tooling).
8. Deep-link patterns (`docs/deep-links.md`) keep mapping 1:1 to lookup operations.
