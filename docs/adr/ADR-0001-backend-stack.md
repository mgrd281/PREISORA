# ADR-0001: Backend stack — TypeScript + NestJS + PostgreSQL/PostGIS + Redis, Drizzle ORM

**Status:** Accepted · **Date:** 2026-08-30

## Context

The constitution requires one platform-neutral backend serving iOS, future Android, web and admin
tools (§1, §3), with geospatial price queries (§8, §35), Redis-backed performance (§35), and a
formal OpenAPI contract (§4). The language was an open choice.

## Decision

- **TypeScript + NestJS** for the API service: mature module system, first-class validation
  pipeline, huge hiring pool, fast iteration.
- **PostgreSQL 16 + PostGIS** for storage: `geography(Point, 4326)` columns + GIST indexes make
  store/offer radius queries (`ST_DWithin`, `ST_Distance`) native and fast.
- **Redis** for rate limiting (throttler storage), feature-flag caching, and GTIN lookup
  read-through caching — load-bearing from day 1, not decorative.
- **Drizzle ORM + drizzle-kit SQL migrations** instead of TypeORM or Prisma: PostGIS columns and
  GIST indexes are first-class in plain SQL migrations; Prisma requires `Unsupported()` plus raw
  SQL for every geo query; TypeORM migration generation is unreliable with PostGIS. Drizzle keeps
  full TypeScript inference with zero decorator-entity coupling and embeds
  `ST_DWithin`/`ST_Distance` fragments cleanly.

## Consequences

- Drizzle has no official NestJS integration; we provide it via a thin `DatabaseModule` DI
  provider. Contributors expecting `@InjectRepository` face a small learning curve.
- Kotlin Multiplatform evaluation (§27) remains open for *client-side* shared logic later; the
  backend language does not constrain it.
