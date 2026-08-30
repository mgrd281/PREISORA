# ADR-0000: Record architecture decisions

**Status:** Accepted · **Date:** 2026-08-30

## Context

PREISORA's constitution (`docs/architecture/cross-platform-readiness.md`) fixes the platform
philosophy but leaves concrete technology choices open. Those choices must be traceable when the
Android phase begins, so future contributors understand *why* the foundation looks the way it does.

## Decision

We record every architecturally significant decision as an ADR in `docs/adr/`, numbered
sequentially, using this format: Context, Decision, Consequences. An ADR is never edited into a
different decision — it is superseded by a new ADR that references it.

## Consequences

Decisions survive team changes; the Android team inherits rationale, not folklore.
