# ADR-0003: The OpenAPI contract is design-first and canonical

**Status:** Accepted · **Date:** 2026-08-30

## Context

The constitution demands a formal contract usable by iOS, Android, web and partners (§3–4) and a
cross-platform definition of done in which Android consumes features without backend redesign
(§40). Two models were considered: code-first (generate the spec from NestJS decorators) and
design-first (hand-written spec, implementations conform).

## Decision

The hand-written, split-file OpenAPI 3.1 spec in `api-contract/` is **the** canon:

- Redocly CLI lints it and bundles it to `api-contract/dist/openapi.bundled.{yaml,json}`.
- `openapi-typescript` generates types into `backend/src/generated/api-types.ts`; the backend's
  DTO-mapping layer types responses against `components['schemas'][…]` so drift surfaces at
  compile time. A served-schema diff (runtime schema vs bundle) is the phase-2 completion of the
  conformance story.
- `swift-openapi-generator` over the same bundle is the documented iOS path (hand-written Codable
  models mirroring the schemas are acceptable in the skeleton phase).
- Operations carry `x-preisora-status: implemented | stubbed | planned`; stubbed operations are
  fully schema-specified and return `501 FEATURE_NOT_AVAILABLE`, so clients build against final
  shapes from day 1 — something code-first cannot express.

## Consequences

- The contract can describe endpoints before any backend code exists (Android/web teams start from
  the bundle alone).
- Double-maintenance risk (spec + DTOs) is real and is mitigated by generated types, e2e contract
  tests, and review discipline; decorators may power a local Swagger UI but are never the source
  of truth.
