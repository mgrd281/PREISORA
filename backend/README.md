# PREISORA Backend

The platform-neutral price-intelligence API (constitution §1: *one intelligence
platform, multiple native experiences*). iOS consumes it today, Android consumes the
same contract later — nothing in here knows which client is calling except through
the request context.

**NestJS + TypeScript + Drizzle ORM + PostgreSQL 16/PostGIS + Redis** (ADR-0001).

The OpenAPI contract in `../api-contract/` is canonical (ADR-0003). This service
conforms to it; it never redefines it. Response mappers are typed against
`src/generated/api-types.ts`, which is generated from the bundled contract — a wire
shape that drifts from the contract becomes a **compile error**, not a production
surprise.

---

## Quickstart

```bash
cp .env.example .env              # defaults match docker-compose.yml
npm install
docker compose up -d --wait       # postgis:16-3.4 + redis:7, both healthchecked
npm run db:migrate                # applies src/database/migrations/*.sql
npm run seed                      # idempotent fictional demo data
npm run start:dev                 # http://localhost:3000/api/v1
```

Smoke the core funnel (scan → product → offers → history):

```bash
BASE=http://localhost:3000/api/v1
curl -s $BASE/health
PID=$(curl -s $BASE/products/by-gtin/4012345000016 | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
curl -s "$BASE/products/$PID/offers?lat=52.52&lng=13.405&radiusMeters=5000"
curl -s "$BASE/products/$PID/price-history?range=30d"
curl -s $BASE/capabilities
curl -s $BASE/products/by-gtin/4012345000017        # 400 INVALID_GTIN

# Any REAL barcode resolves through the product data provider (§22) and is persisted:
curl -s $BASE/products/by-gtin/4008400402222        # Nutella 500 g, with images
```

`docker compose up -d --wait` matters: the `postgis` image restarts its server once
during first boot, and an immediately-following `db:migrate` would race it. The
healthchecks (`pg_isready`, `redis-cli ping`) are what make `--wait` meaningful.

## npm scripts

| Script | What it does |
|---|---|
| `npm run build` | `nest build` → `dist/` (migration SQL is copied along) |
| `npm start` | runs the compiled `dist/main.js` |
| `npm run start:dev` | watch-mode dev server |
| `npm run db:migrate` | applies the SQL migrations (drizzle-kit format + journal) |
| `npm run db:generate` | authors a NEW migration from the Drizzle schema |
| `npm run seed` | idempotent demo data (safe to re-run) |
| `npm run import:flyers -- <file>` | flyer-offer import pipeline (see "Flyer-offer import") |
| `npm test` | unit suite — pure logic, no database, no Docker |
| `npm run test:e2e` | supertest against a real, freshly created `preisora_test` DB |

## Architecture

```
src/
  main.ts                    global prefix /api/v1, ValidationPipe, exception filter
  config/                    THE ONLY place market defaults live (§24)
  common/
    errors/                  error-codes.ts (the 10-code catalog), AppException,
                             GlobalExceptionFilter — the only thing that writes a 4xx/5xx body
    pagination/              opaque base64url (sortKey, id) cursors + Page envelope (ADR-0002)
    context/                 RequestContext middleware + @ReqContext() decorator
    geo/                     lat/lng/radiusMeters parsing; missing pair -> LOCATION_REQUIRED
    gtin/                    GTIN-8/12/13/14 checksum + normalization
    redis/                   client, JSON read-through cache
    throttler/               Redis storage + guard that emits RateLimit-* and RATE_LIMITED
    validation/              UUID / slug path pipes that throw the platform envelope
  database/
    schema/*.schema.ts       Drizzle tables; geography(Point,4326) via customType
    migrations/              hand-authored SQL + meta/_journal.json
  modules/
    health products offers retailers search auth users devices
    favorites alerts notifications optimizer shopping-lists capabilities
  seed/                      seed-data.ts (the fiction) + seed.ts (the idempotent writer)
  generated/api-types.ts     from the contract — never hand-edited
```

### Server-side intelligence (clients never re-derive it — §22)

**`PriceRankingService`** + the pure `offers/price-ranking.ts` module. For one product
and one query location it:

1. drops offers outside their advertised `validFrom`/`validUntil` window;
2. classifies freshness against `MAX_PRICE_AGE_HOURS` (default 72h) — `fresh` inside
   the window, `aging` up to twice it, `stale` beyond. **`stale` offers are dropped
   from the response; only `fresh` offers can be `isBest` or prevent
   `NO_CURRENT_PRICES`**;
3. resolves the market-wide vs store-specific override (see below);
4. applies the promotion to produce `effectivePrice` (`percentage` and `absolute`
   only — `multibuy`/`loyalty` are surfaced but not evaluated, exactly as the contract
   states);
5. sorts by effective price, then distance (market-wide offers have none, so they sort
   last), then id for stability; marks exactly one `isBest`.

`unitPrice` normalizes the **listed shelf price** (not the promoted one) by the
product's pack size, so it always reads as `price / pack size`.

**`PriceHistoryService`** aggregates daily min/avg from the append-only
`price_observations` table, bucketed in UTC, in integer minor units.

**`OptimizerService`** + the pure `optimizer/optimize.ts`:

- `cheapest_total` — exhaustive search over every combination of **at most 3** stores
  drawn from the **15 nearest** candidate stores (≤ 575 plans), assigning each item to
  the cheapest store in the combination. Ranked by coverage, then total, then store
  count, then walking distance.
- `fewest_stores` — the same search bounded to one store.
- `balanced` — part of the canonical wire enum, **501 `FEATURE_NOT_AVAILABLE`**.
- `estimatedSavings` = (cheapest single store that covers exactly the items the plan
  covers) − plan total, floored at 0. If no single store covers them all there is
  nothing honest to compare against and savings are reported as 0.
- `confidence` is a coarse, documented heuristic:

  ```
  confidence = 0.55 * coverage + 0.30 * recency + 0.15 * dispersion   (clamped, 2dp)

  coverage    quantity-weighted share of the list an offer was found for
  recency     mean of (1 - offerAgeHours / MAX_PRICE_AGE_HOURS) over the chosen offers
  dispersion  1 - 0.1 * (storesToVisit - 1), floored at 0.7
  ```

  A plan that buys nothing scores exactly 0.

**`AlertEngineService`** — one cron (`0 */15 * * * *`), joining active alerts against
the best fresh price inside each alert's own radius, with a 24 h re-trigger cooldown.
**Disabled entirely under `NODE_ENV=test`**; `runOnce()` is public so tests and
operators can drive a deterministic pass.

**`NotificationDispatchService`** routes by `device.platform` to
`ApnsProviderStub` / `FcmProviderStub` behind the `NotificationDeliveryProvider`
interface. Payloads carry localization **keys**, never copy (§33).

**`FeatureFlagsService`** resolves `(country, platform, minAppVersion, cohort)`
most-specific-wins against the request context, behind a 60 s Redis cache. No matching
row means OFF — features are opt-in.

### Market-wide vs store-specific offers (the sharp edge)

`offers.store_id` is **nullable**. `NULL` means a market-wide uniform price that
applies to every store of that `retailer_market`; a non-null row is a store-specific
price. Two *partial* unique indexes enforce one current price of each kind (a plain
composite unique index would not constrain the NULL rows).

The contract's rule is per-store: *a store-specific offer overrides a market-wide one
for that store*. Market-wide offers are rendered as one row (`storeId: null`) rather
than expanded per store, so the equivalent test is **coverage**: a market-wide offer
survives only while at least one of its market's in-radius stores has no
store-specific offer of its own. A market with no store inside the radius is
unreachable, so its market-wide price is dropped too.

This is the likeliest correctness bug in the codebase, so the pure ranking module has
dedicated unit tests for: only-market, only-store, both-with-an-uncovered-store,
both-with-full-coverage, unreachable market, stale exclusion, validity exclusion, and
promotion application.

### Errors

`src/common/errors/error-codes.ts` is the single catalog and mirrors
`api-contract/schemas/Error.yaml` verbatim: `PRODUCT_NOT_FOUND`, `RESOURCE_NOT_FOUND`,
`NO_CURRENT_PRICES`, `INVALID_GTIN`, `LOCATION_REQUIRED`, `RATE_LIMITED`,
`SERVICE_TEMPORARILY_UNAVAILABLE`, `VALIDATION_FAILED`, `FEATURE_NOT_AVAILABLE`,
`UNAUTHORIZED`. Services throw `AppException(code, details?, messageKeyOverride?)`;
`GlobalExceptionFilter` serializes **everything** — validation failures, the throttler,
Nest's own 401/404, and any unhandled error (→ `SERVICE_TEMPORARILY_UNAVAILABLE`,
`retryable: true`) — as `{code, messageKey, details, retryable}`. Stack traces are
logged, never serialized.

`NO_CURRENT_PRICES` is a deliberate **404** on the offers endpoint (CONVENTIONS.md).
`PRODUCT_NOT_FOUND` is the product funnel only; every other missing resource is
`RESOURCE_NOT_FOUND` with a precise `messageKey` (`error.store_not_found`, …).

### Redis is load-bearing

1. `@nestjs/throttler` storage (`RedisThrottlerStorage`, one atomic Lua script per
   hit) — this is what makes `RATE_LIMITED` a real, shared-state answer rather than a
   per-process approximation. There is an e2e test that actually trips it.
2. The 60 s feature-flag cache.
3. A short-TTL read-through cache on `GET /products/by-gtin/{gtin}` (§35) — the scan
   funnel hits the same few GTINs repeatedly.
4. A short-TTL **negative** cache for product-provider misses, so a repeatedly-scanned
   unknown barcode does not hammer the upstream catalogue.

Cache reads and writes degrade to a miss on failure; a Redis hiccup must never turn
the scan funnel into a 5xx.

### Auth

`users.id` (UUID) is the **only** primary identity (§11). Sign-in methods are
`user_identities` rows (`anonymous | email | apple | google`) resolving to it.

- `POST /auth/anonymous` is **real** — it creates an account plus an `anonymous`
  identity and issues the same `AuthTokens` as email login. This is the
  scan-before-signup funnel.
- `POST /auth/register` called **with** an anonymous bearer token *upgrades that
  account in place*, so scans and favorites survive; without one it creates a fresh
  account. Passwords are argon2id hashes (`@node-rs/argon2` — prebuilt binaries, no
  node-gyp build step in the container).
- Access tokens are 15 min JWTs; refresh tokens are opaque, single-use, stored as
  SHA-256 hashes and **rotated** on every refresh.
- Apple/Google sit behind the `IdentityProviderVerifier` interface as stubs, and the
  operations that would use them are contract-`stubbed`, so no unverified provider
  token can ever mint a session.

### Market defaults (§24)

`DEFAULT_COUNTRY_CODE`, `DEFAULT_CURRENCY_CODE`, `DEFAULT_LOCALE`,
`DEFAULT_TIMEZONE`, `MAX_PRICE_AGE_HOURS` and the radius bounds live in
`.env` / `src/config/configuration.ts` only. **No `'DE'` or `'EUR'` literal appears in
business logic** — offers carry their own market's currency, and the request context
resolves country/locale per request (`?locale` > user profile > `Accept-Language` >
config default, echoed back in `Content-Language`).

## Product data provider (§22)

Scanning a barcode is only useful if any real barcode resolves. `GET
/products/by-gtin/{gtin}` therefore runs a chain, not a table lookup:

```
validate GTIN -> Redis -> local catalogue -> provider -> persist -> return
```

Checksum validation stays first, so `INVALID_GTIN` is never a database or network
round trip. When the local catalogue does not know the GTIN, a **product data
provider** is asked; a hit is normalized, persisted as an ordinary `products` row and
returned like any other product, so every subsequent scan of that barcode is a local
read.

The provider is a **seam, not a call site**. `ProductProvider` (`lookupByGtin(gtin,
ctx)`) is bound to the `PRODUCT_PROVIDER` DI token in `products.module.ts`; a second
catalog provider — or a paid price provider later — is added by extending that
factory, and no caller changes. `OpenFoodFactsProvider` and `NullProductProvider` are
the two implementations today.

### Normalization is the adapter's whole job

Open Food Facts vocabulary exists in exactly one folder
(`src/modules/products/providers/openfoodfacts/`); everything downstream sees the
platform-neutral `ProviderProduct`.

| Field | Rule |
|---|---|
| `name` | `product_name_{request language}` -> `product_name` -> `product_name_{product's own lang}`. Blank strings count as absent. **No usable name = NOT FOUND** — a nameless product is never persisted. The request language comes from `RequestContext`, so `?locale=en-GB` genuinely returns the English name (§24). |
| `brand` | First entry of the comma-separated `brands` string, trimmed; `null` when absent. |
| `quantityText` | OFF `quantity`, verbatim (`"500g"`). |
| `images` | The front image of the chosen language, else another language's front image. Each rendition pairs a ready-made `selected_images.front.{thumb,small,display}` URL with its **exact** `w`/`h` from `images.front_{lang}.sizes` (`100`/`200`/`400` — verified empirically; the boxes are not square, Nutella's 400 rendition is 269x400). The original is derived from the display URL's size token and included only when `sizes.full` gives its exact dimensions. A rendition whose URL **or** dimensions cannot be determined is dropped — the contract requires all three `ImageAsset` fields. Nothing determinable -> `null`, never `[]`. |
| `slug` | `slugify(brand + name + quantity)`, with deterministic fallbacks `-{last 6 of GTIN}` then `-{full GTIN}` then `product-{GTIN}`. The insert walks the candidates on a `products_slug_key` violation, so a collision costs one round trip and **never a 500**. |
| `countryCode` | From the request context, never a literal (§24). |

Prices, offers, retailers and stores are **never** invented. A discovered product
legitimately has no offers, so `GET /products/{id}/offers` answers 404
`NO_CURRENT_PRICES` for it — that is the honest answer, not a gap.

### Failure behaviour: a provider problem is never a 5xx

A network error, a timeout (`OPENFOODFACTS_TIMEOUT_MS`, default 2500 ms), a non-200,
an unparseable body and `status: 0` are all the same thing: **a lookup miss**. The
request answers 404 `PRODUCT_NOT_FOUND`, the failure is logged at `warn`, and no
upstream status body ever reaches a client or a log line. The seeded catalogue and
every already-discovered product keep working while the provider is down.

### Caching

Both halves of the Redis layer matter on the scan funnel (§35):

- **positive**: the existing read-through cache on the resolved `Product`
  (`GTIN_CACHE_TTL_SECONDS`);
- **negative**: a provider MISS is remembered for
  `PRODUCT_PROVIDER_NEGATIVE_CACHE_TTL_SECONDS` (default 300), so a repeatedly-scanned
  unknown barcode does not hammer the upstream. It is checked *after* the catalogue
  read, so a barcode that has since been seeded is never hidden by it.

### Provenance (server-side only)

Migration `0001_product_provenance` adds `products.source`
(`seed | openfoodfacts | manual`, default `seed`, CHECK-constrained), `source_ref` (the
OFF code) and `source_synced_at`. **None of it is on the wire**: the OpenAPI contract
is frozen and `Product` has no `source` field. Exposing it additively is a documented
follow-up, not part of this change.

### Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PRODUCT_PROVIDER` | `openfoodfacts` | `openfoodfacts` or `none`. Anything else disables discovery rather than failing the boot. |
| `PRODUCT_PROVIDER_NEGATIVE_CACHE_TTL_SECONDS` | `300` | How long a provider miss is remembered. |
| `OPENFOODFACTS_BASE_URL` | `https://world.openfoodfacts.org` | |
| `OPENFOODFACTS_TIMEOUT_MS` | `2500` | A lookup sits on the scan funnel, so it fails fast. |
| `OPENFOODFACTS_USER_AGENT` | `PREISORA/1.0 (https://preisora.de)` | OFF's usage terms ask every client to identify itself descriptively. Put a real contact URL here before deploying. |

Under `NODE_ENV=test` the provider is **forced** to `none` regardless of the
environment, so no test run can depend on — or reach — a third-party service. The
provider e2e injects a stub that replays recorded payloads
(`test/fixtures/openfoodfacts/`) through the real normalizer instead.

### Licence obligation — Open Food Facts data is ODbL

Product names, brands, quantities and images returned by `OpenFoodFactsProvider` come
from the [Open Food Facts](https://world.openfoodfacts.org) database, which is licensed
under the **Open Database License (ODbL) v1.0**; the individual product images are
licensed **CC BY-SA**. This is not optional housekeeping:

- **Attribution is required wherever the data is displayed.** Any client showing a
  product whose row has `source = 'openfoodfacts'` must credit Open Food Facts and
  link to the ODbL — e.g. "Product data from Open Food Facts, ODbL".
- **Share-alike applies to derived databases.** Publishing a modified version of the
  database carries the same licence forward.
- Do not hammer the API, and keep the descriptive `User-Agent` — both are part of OFF's
  usage terms.

The backend records provenance so this is answerable per row; the app-side attribution
surface is the client's responsibility.

## Flyer-offer import (§22)

Weekly flyer prices are ingested by a standalone pipeline — no Nest container, **no
HTTP surface** (the OpenAPI contract is frozen; drafts and imports are invisible on
the wire):

```bash
npm run import:flyers -- data/flyer-imports/2026-W36.json
```

### Import file format (`data/flyer-imports/*.json`)

Provider-neutral (§24): the file carries facts transcribed from a retailer's **own
public offer page**, and nothing in the pipeline assumes a country, currency or
chain. Shape (validated by `src/import/flyer-import-file.ts`, the authoritative
contract):

```jsonc
{
  "schemaVersion": 1,
  "batches": [{
    "retailerName": "ALDI SÜD",         // nominative use: factual price data
    "retailerSlug": "aldi-sued",
    "countryCode": "DE", "currencyCode": "EUR",
    "locale": "de-DE",                   // optional; defaults to the configured locale
    "sourceUrl": "https://…/angebote",  // where the batch was harvested
    "harvestedAt": "2026-08-30",
    "pricingScope": "market",           // one price for the whole chain → offers.store_id NULL
    "offers": [{
      "name": "Farmer Macadamia gesalzen",
      "brand": "Farmer",                 // optional; without it a row can never auto-match
      "quantityText": "125 g",
      "priceMinor": 299,
      "oldPriceMinor": 349,              // optional crossed-out price
      "validFrom": "2026-09-04",        // required for kind "weekly"
      "validUntil": "2026-09-09",       // optional
      "kind": "weekly",                  // or "permanent_reduction" (no validity window)
      "gtin": "4061458056557"            // optional pre-resolved GTIN (checksum-verified)
    }]
  }]
}
```

### Matching rules — and THE safety rule

Product matching is server intelligence (§22) and lives in `src/import/matcher.ts` +
`src/import/quantity.ts` (pure, unit-tested against recorded payloads). The rules are
**constants in the matcher, not configuration** — env sprawl would only invite
loosening them:

1. A row with a `gtin` is checksum-verified and linked directly.
2. Otherwise Open Food Facts is searched (`cgi/search.pl`, ~10 req/min — the client
   spaces requests 7 s apart and retries 429/5xx with backoff). A match is accepted
   ONLY when **both** gates pass:
   - **brand**: case-/whitespace-/diacritic-insensitive containment against the
     candidate's brand list;
   - **quantity**: exact equality after unit normalization (`130 g == 130g`,
     `1,5 l == 1500 ml`); an unparseable pack size is never a wildcard.
3. More than one distinct GTIN passing both gates → **refused** (`ambiguous_gtins`;
   the batch country in `countries_tags` is a bonus tiebreaker, never a gate). Size
   variants with none matching (B-ready 22 g/44 g/220 g/330 g vs a flyer's 132 g) →
   refused (`quantity_mismatch`).

**The safety rule: a price is never attached to a product without a confident
match.** A missing offer is a gap; a wrong price on a scan kills the product's
credibility. Expect a minority of flyer rows to match — that is the honest outcome.

### The review queue (`flyer_offer_drafts`)

EVERY harvested row lands in `flyer_offer_drafts` (migration 0002) with the flyer's
verbatim facts, `match_status` (`pending | matched | rejected`) and a
machine-readable `match_reason`. Confident matches are ALSO upserted into `offers`
(`source = 'provider'`, `store_id NULL` + `retailer_market_id` — the market-wide
price shape) plus a `price_observations` row when the price actually changed.
Drafts are review-queue data for a future curation surface, with stable verdicts: a
reviewer's `rejected` survives re-imports, a `matched` draft is never downgraded by
a later unmatched decision (its offer still stands), and a transient
`search_failed` never overwrites an existing verdict. Nothing of this is on the
wire.

Idempotency: offers upsert on the market-wide natural key (product, market), drafts
on (market, name, quantity); re-running the same file converges — same row counts,
no duplicate observations.

### Retailer / market / store provisioning

Unknown retailers are created as `Retailer` → `RetailerMarket` (country/currency
from the batch, §25). Store locations are attempted with **one Overpass API call per
chain** (mirrors tried with a short timeout). When Overpass is unreachable — as it
is through some egress proxies — the pipeline falls back to **three clearly-labeled
representative locations per chain**: named "… (Beispiel-Standort n)", street
literally `Beispielstandort`, `external_ref` prefixed `demo-location`. No real
street address is ever fabricated. Real chain names on factual price data are
nominative use — standard for price comparison.

**Attribution:** store data fetched via Overpass is © OpenStreetMap contributors,
licensed ODbL 1.0 (openstreetmap.org/copyright) — any surface displaying those
stores must say so. Matching uses Open Food Facts search data (ODbL, see above);
recorded test payloads under `test/fixtures/openfoodfacts-search/` carry the same
licence.

## Seed data

`npm run seed` is idempotent (catalog rows upsert on natural keys; price rows tagged
`source = 'seed'` are replaced wholesale, leaving any provider-ingested data alone).

**Everything is fictional.** Three invented retailers — **Kaufrausch** (full-range,
index 1.00), **Marktfrisch** (regional, 1.08), **PreisPilot** (discounter, 0.85) — with
one DE market each and 11 Berlin stores around 52.52/13.405 (three deliberately
*outside* a 5 km radius, so the radius filter is visibly doing something). Ten generic
German grocery products with EAN-13s in the `4012345xxxxxx` demo range whose check
digits are **computed at seed time**, never typed. Market-wide offers for every
(product, market) plus store-specific **loss leaders** at four stores — deliberately
deep enough that a full-range store undercuts the discounter on a few products, so
`cheapest_total` genuinely routes a basket across two or three stores instead of
collapsing to "always the discounter". One 20 % promotion, and 30 days of price
observations per (product, market) for the history endpoint. Feature
flags enable `priceHistory`/`priceAlerts`/`shoppingOptimizer` and disable
`receiptScanner`/`visualProductScan`, plus one scoped row (`DE` + `ios` + `>= 2.0.0`)
that demonstrates most-specific-wins resolution.

No real trademarks, no scraped prices.

## Tests

```bash
npm test          # unit: gtin, price ranking, optimizer, flag scopes, cursors, error filter,
                  #       OFF normalization (recorded fixtures) and the by-gtin lookup chain
npm run test:e2e  # supertest over the whole app graph
```

Neither suite performs a third-party network call: the provider is forced off under
`NODE_ENV=test`, the normalizer is tested against recorded payloads in
`test/fixtures/openfoodfacts/`, and the provider e2e injects a stub over the
`PRODUCT_PROVIDER` token.

The e2e suite **drops and recreates** `preisora_test`, migrates and seeds it, and
flushes a **separate Redis logical database** (`redis://localhost:6379/1`) before
running. Both halves are required: recreating Postgres alone would leave the GTIN
cache handing the suite product ids from the dropped database. The e2e app is booted
with the same global prefix, pipe and filter `main.ts` installs — a test harness that
diverged from production wiring would prove nothing.

## What is stubbed, and why

| Surface | Status | Why |
|---|---|---|
| `POST /auth/oauth`, `GET/POST/DELETE /auth/identities` | 501 `FEATURE_NOT_AVAILABLE` | Apple/Google JWKS verification is not built. The shapes are final so clients integrate today (ADR-0003). |
| `GET/PATCH /users/me/preferences` | 501 | §12 cross-device sync seam; `UserPreferences` is final, the storage is not built. |
| Optimizer strategy `balanced` | 501 | Part of the canonical enum; `cheapest_total` and `fewest_stores` are real. |
| APNs / FCM delivery | structured log | `NotificationDeliveryProvider` is the seam; real delivery needs credentials the project does not have yet. |
| Provider price ingestion / scraping | — | `offers.source` (`seed \| manual \| provider`) is the seam. The **product data** provider is real; no provider supplies *prices*. |
| Search engine | trigram ILIKE | The contract is engine-agnostic; a real engine is a drop-in. |
| Cohort assignment / percentage rollout | — | `feature_flags.cohort` and `users.cohort` exist; nothing assigns cohorts yet. |
| Multibuy / loyalty promotion math | surfaced, not evaluated | Explicitly what the contract says. |
| Product images | populated for provider-discovered products, `null` for seed rows | §34: `ImageAsset[]` with exact pixel dimensions now ships for anything the product data provider resolved. The fictional seed catalogue has no imagery, and there is no own-CDN/resize pipeline — provider URLs are passed through. |
| `Idempotency-Key` header | accepted, ignored | `x-preisora-status: planned`. v1 relies on natural-key idempotency. |
| BullMQ job queue, observation-table partitioning | — | Not needed at this data volume. |

## Known limitations

- **Single-instance cron.** `AlertEngineService` assumes one API instance. Running two
  would evaluate every alert twice — a Redis lock is the prerequisite for horizontal
  scaling. The in-process `running` flag only guards overlapping ticks *within* an
  instance.
- **Contract drift is caught at compile time, not at runtime.** Mappers are typed
  against the generated types and the e2e suite asserts wire shapes, but there is no
  automated served-schema diff against the bundle yet (phase-2 follow-up, ADR-0003).
  Re-run `npm run typegen` in `api-contract/` after any contract change.
- **Market-wide vs store-specific offers are genuinely subtle.** The coverage rule
  above is a deliberate simplification of "override per store" for a model that
  returns one row per market-wide price. If offers are ever expanded per store on the
  wire, this rule has to be revisited — the unit tests encode the current semantics.
- **Geo lists are capped at 50 and non-cursored** (`nextCursor: null`, `hasMore: false`)
  — ADR-0002. The `(distanceMeters, id)` composite cursor is designed and lands
  additively.
- **Price history mixes no currencies**: if a product ever carries observations in more
  than one currency, only the dominant one is returned.
- **The optimizer's exhaustive search is bounded** (15 candidate stores, ≤ 3 per plan).
  Beyond that it would need a real heuristic.
- **`npm audit` reports 4 moderate advisories**, all from `esbuild` inside
  `drizzle-kit` — a dev-only, transitive dependency of the migration authoring tool.
  The only "fix" npm offers is downgrading drizzle-kit to 0.18, which is worse. No
  runtime dependency is affected.
