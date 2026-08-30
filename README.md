# PREISORA

**One intelligence platform. Multiple native experiences.**

PREISORA is a price-comparison platform for the German market (first) — scan a product barcode,
see current prices across nearby retailers, track favorites, get price alerts, and optimize a
whole shopping list. It launches as a premium **native iOS app**; a **native Android app** comes
later on the same backend. The founding architecture is fixed in
[`docs/architecture/cross-platform-readiness.md`](docs/architecture/cross-platform-readiness.md)
(the constitution).

## Repository map

| Directory | What it is | Runs where |
|---|---|---|
| [`backend/`](backend/) | NestJS platform-neutral API (`/api/v1`), PostgreSQL/PostGIS + Redis, seeded demo data, unit + e2e tests | any Linux/macOS with Docker + Node 22 |
| [`ios/`](ios/) | Native SwiftUI app skeleton (iOS 17+, zero third-party deps), XcodeGen project | macOS, Xcode 16+ recommended (15.3+ annotated, untested) |
| [`api-contract/`](api-contract/) | **Canonical** OpenAPI 3.1 contract (design-first, ADR-0003), Redocly lint + bundle + typegen | headless |
| [`design-spec/`](design-spec/) | Platform-neutral design tokens (W3C DTCG) + per-platform mapping rules | n/a (spec) |
| [`docs/`](docs/) | Constitution, domain glossary, ADRs, deep-link grammar, analytics taxonomy | n/a (docs) |

`android/` is intentionally absent until Android work begins (constitution §26, §29).

## Quickstart

### Backend (fully headless)

```bash
cd backend
cp .env.example .env
docker compose up -d --wait          # postgis + redis, healthchecked
npm install
npm run db:migrate
npm run seed                          # fictional German demo retailers & products
npm run start:dev                     # API on http://localhost:3000/api/v1
```

Smoke test the scan journey:

```bash
curl -s localhost:3000/api/v1/products/by-gtin/4012345000016 | jq .   # seeded demo milk
curl -s "localhost:3000/api/v1/products/<id>/offers?lat=52.52&lng=13.405&radiusMeters=5000" | jq .
```

Substitute `<id>` with the `id` field returned by the first call.

Tests: `npm test` (unit) · `npm run test:e2e` (contract e2e against real Postgres).

### API contract

```bash
cd api-contract
npm install
npm run lint      # Redocly ruleset + PREISORA custom rules
npm run bundle    # -> dist/openapi.bundled.{yaml,json}
npm run typegen   # -> backend/src/generated/api-types.ts
```

### iOS (on a Mac — Xcode only, no Homebrew or Docker required)

```bash
cd ios
curl -L -o xcodegen.zip https://github.com/yonaskolb/XcodeGen/releases/latest/download/xcodegen.zip
unzip -q xcodegen.zip && ./xcodegen/bin/xcodegen generate
open Preisora.xcodeproj        # ⌘R on an iPhone simulator
```

The app starts in **Demo Mode**, serving responses captured from the real backend below
`APIClient` — so the whole scan → compare → map journey works with no server running.
Enter a demo GTIN such as `4012345000016`. See [`ios/README.md`](ios/README.md) for the
full journey, the live-backend path, and what remains unverified.

## Ground rules (short form)

- The API is versioned and platform-neutral — no Apple concepts in shared models (§2, §3).
- One vocabulary everywhere: see [`docs/domain-glossary.md`](docs/domain-glossary.md) (§5).
- One error contract: `{ code, messageKey, details, retryable }` (§32).
- Business intelligence lives server-side; clients present (§22).
- Market defaults (DE/EUR/de-DE) live only in configuration — never hardcoded in logic (§24).
- Architecture decisions are recorded in [`docs/adr/`](docs/adr/).
