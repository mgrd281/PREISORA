# PREISORA flyer harvester

Turns offer rows read off a retailer's own public page into a
`backend/data/flyer-imports/*.json` file the backend's `npm run import:flyers`
can ingest — cutting the tedious part of the old manual workflow (hand-typing
the JSON envelope, dates, and schema fields for every chain every week) down
to: paste terse rows, run one command.

## Important: this is NOT a scraper, and here's exactly why

An earlier version of this tool tried to be a Playwright-based headless
browser that would fetch and parse each chain's page unattended. **It does
not work in this development sandbox — confirmed empirically, not just
theoretically:**

- A real headless Chromium instance gets `net::ERR_CONNECTION_RESET` on
  **every** HTTPS site tried, including plain Wikipedia — this reproduces
  even with the sandbox's egress proxy explicitly configured on the browser.
  This is a sandbox network/proxy compatibility issue with headless-browser
  TLS traffic, unrelated to any retailer's bot defenses.
- A plain `curl`/`fetch` from this sandbox gets `403 Forbidden` from the
  retailer sites tested (ALDI SÜD, REWE, Kaufland) — their own bot
  protection rejecting a generic scripted client.
- **Only Claude's own `WebFetch` tool succeeds** at reading these pages,
  because it fetches through Anthropic's infrastructure, not this sandbox's
  network. That is not something a standalone script — run by anyone else,
  on any other machine, unattended — can reproduce.

So today, reading these pages requires a Claude session using `WebFetch`.
This tool exists to make everything **after** that fast and structured; it
does not remove the WebFetch step. If a future environment's network can
reach these sites directly (a different sandbox, a real server, a residential
IP), the same `rows/*.json` format still applies — only the retrieval step
would change.

## Known coverage (retested — a retailer's site can change at any time)

| Chain | Status |
|---|---|
| ALDI SÜD, EDEKA, NORMA | Readable via WebFetch — server-rendered pages with real offer data. |
| REWE, Kaufland, Netto | `403 Forbidden` even to WebFetch. |
| PENNY, HIT | Page requires client-side store selection; no offer data ships without it. |
| ALDI Nord | Actively resets the connection. |
| Rossmann | Client-side load failure. |

See `chains.mjs` (`CHAINS`) for the working retailers and `KNOWN_UNREACHABLE`
for the rest, with reasons — check both before spending time re-investigating
a chain that was already tried.

## Weekly workflow

1. For each chain in `chains.mjs`, `WebFetch` its `sourceUrl` asking for a
   structured list of current offers (name, brand, price, old price,
   quantity, validity dates).
2. Write what comes back as a terse JSON array under `rows/<slug>.json` —
   one object per offer, matching `FlyerOfferRow` minus the batch envelope:
   ```json
   [
     { "name": "Leerdammer Original XXL", "brand": "Leerdammer",
       "quantityText": "360 g", "priceMinor": 399, "validFrom": "2026-09-04" }
   ]
   ```
   `priceMinor`/`oldPriceMinor` are integer cents. `kind` defaults to
   `"weekly"` (needs `validFrom`); use `"permanent_reduction"` for
   always-on markdowns (no validity window needed).
3. Assemble and write the import file:
   ```bash
   node build-batch.mjs --week 2026-W37 aldi-sued=rows/aldi-sued.json edeka=rows/edeka.json
   ```
   This fills in `retailerName`/`countryCode`/`currencyCode`/`sourceUrl`
   from `chains.mjs`, stamps `harvestedAt` with today's date, and writes
   `backend/data/flyer-imports/2026-W37.json` — a *superset* of one chain's
   batch data, merged across every `slug=file` pair given.
4. Import it:
   ```bash
   cd ../backend && npm run import:flyers -- data/flyer-imports/2026-W37.json
   ```
   The importer (unchanged, already tested) does the real work: matches each
   row to a GTIN only when brand AND exact pack size verify, upserts
   confident matches into `offers`, and puts everything else into the
   `flyer_offer_drafts` review queue. Full schema validation happens here —
   `build-batch.mjs` does not duplicate it.

Re-running the same file, or a file with overlapping rows, is safe — the
importer's natural-key idempotency means unchanged offers create nothing new
and changed prices update in place (see `../../backend/README.md`).

## Legal posture (unchanged from the manual process)

Same reasoning as documented in `../../backend/README.md`: this reads only a
retailer's own public promotional page — nominative use of a chain's name and
its own advertised prices is standard for price comparison. It never
attempts to bypass a login, a CAPTCHA, or active bot defenses (the
"unreachable" list above is a boundary, not a todo list to defeat). This is
opt-in tooling a project maintainer runs deliberately — it is not part of
`backend/`'s install/build/test, and it does not run unattended.

## Making this actually recurring

Since the retrieval step needs a Claude session, "automated" here means a
**scheduled Claude session**, not a cron job. A weekly Routine can wake this
session (or a fresh one) with a prompt to redo steps 1–4 above and report the
results — ask for it if wanted; it is not set up by default.
