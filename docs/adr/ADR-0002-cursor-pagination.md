# ADR-0002: Cursor pagination

**Status:** Accepted · **Date:** 2026-08-30

## Context

Pagination is part of the wire contract (§4) and breaking to change later. Price observations are
inserted continuously; offset pages drift under insertion and degrade at depth. Mobile clients
consume lists as infinite scroll.

## Decision

All paginated collections use one envelope:

```json
{ "data": [ ... ], "pageInfo": { "nextCursor": "…" , "hasMore": false } }
```

- `nextCursor` is an **opaque base64url-encoded composite key** `(sortKey, id)`; clients treat it
  as a black box.
- **Search** (`GET /api/v1/search/products`) implements a real `(name, id)` cursor from day 1.
- **Geo-ordered lists** (stores by radius, offers for a product) are radius-bounded and capped
  (max 50 results), returned in the *same* envelope with `nextCursor: null`, `hasMore: false`.
  Cursoring over `ST_Distance` ordering requires a composite `(distanceMeters, id)` cursor whose
  resume predicate recomputes distance in the `WHERE` clause — designed here, deferred until data
  volume demands it. Because the envelope is already in place, adding it is purely additive.

## Consequences

- No offset/limit parameters anywhere in v1; `COUNT(*)` totals are not exposed (a `totalItems`
  field can be added additively if a UI needs it).
- A naive single-key cursor over geo ordering would skip/repeat rows — implementers must use the
  composite form above when geo cursoring lands.
