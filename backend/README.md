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
npm test          # unit: gtin, price ranking, optimizer, flag scopes, cursors, error filter
npm run test:e2e  # supertest over the whole app graph
```

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
| Provider price ingestion / scraping | — | `offers.source` (`seed \| manual \| provider`) is the seam. |
| Search engine | trigram ILIKE | The contract is engine-agnostic; a real engine is a drop-in. |
| Cohort assignment / percentage rollout | — | `feature_flags.cohort` and `users.cohort` exist; nothing assigns cohorts yet. |
| Multibuy / loyalty promotion math | surfaced, not evaluated | Explicitly what the contract says. |
| Product images | `null` | §34 seam; the nullable field ships, the pipeline does not. |
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
