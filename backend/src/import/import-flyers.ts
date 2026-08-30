/**
 * `npm run import:flyers -- data/flyer-imports/<file>.json`
 *
 * The flyer-offer import pipeline (constitution §22 — product matching is server
 * intelligence). Standalone like `npm run seed`: no Nest container, no HTTP
 * surface — the OpenAPI contract is frozen and this adds NOTHING to the wire.
 *
 * Per batch:
 *   1. provision Retailer → RetailerMarket (country/currency from the FILE, §24/§25)
 *      and stores (real OSM data via Overpass when reachable, labeled demo
 *      locations otherwise — see store-provisioning.ts);
 *   2. match every flyer offer against the product catalog (matcher.ts — brand AND
 *      quantity must verify; ambiguity refuses);
 *   3. confidently matched → upsert a market-wide `offers` row (store_id NULL,
 *      source 'provider') + a `price_observations` row on change;
 *   4. EVERY row, matched or not, → `flyer_offer_drafts` (the review queue).
 *
 * Idempotent: offers upsert on the market-wide partial unique key, drafts on their
 * natural key, and an unchanged price produces no new observation — re-running the
 * same file converges instead of duplicating.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as path from 'node:path';
import { Pool } from 'pg';
import { isValidGtinChecksum, normalizeGtin } from '../common/gtin/gtin';
import { buildConfig } from '../config/configuration';
import * as schema from '../database/schema';
import {
  flyerOfferDrafts,
  offers,
  priceObservations,
  products,
  retailerMarkets,
  retailers,
  stores,
} from '../database/schema';
import { buildSlugCandidates } from '../modules/products/product-slug';
import type { ProviderProduct } from '../modules/products/providers/product-provider.interface';
import { FlyerBatch, FlyerImportFile, FlyerOfferRow, readFlyerImportFile } from './flyer-import-file';
import { decideMatch, MatchDecision, SearchCandidate } from './matcher';
import { OffSearchClient } from './off-search-client';
import {
  demoStores,
  fetchStoresFromOverpass,
  MUNICH_DEMO_POINTS,
  MUNICH_DEMO_POINTS_ALT,
  StoreProvisioningPlan,
} from './store-provisioning';

type Db = NodePgDatabase<typeof schema>;

/**
 * Import-time constants. The OFF search API allows ~10 req/min, so requests are
 * spaced 7 s apart and 429/5xx answers are retried with a growing backoff.
 */
const OFF_MIN_INTERVAL_MS = 7_000;
const OFF_TIMEOUT_MS = 20_000;
const OFF_MAX_ATTEMPTS = 4;
const OFF_RETRY_DELAY_MS = 15_000;
/** OFF asks every client to identify itself; this is the import pipeline's identity. */
const IMPORT_USER_AGENT = 'PREISORA-dev/0.1';

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
];
const OVERPASS_TIMEOUT_MS = 12_000;

/**
 * DEMO-ONLY geography (data, not business logic — the same register as
 * seed-data.ts). The Munich bbox the Overpass query searches, and the city label
 * the labeled fallback stores carry.
 */
const DEMO_BBOX: [number, number, number, number] = [48.1, 11.5, 48.16, 11.62];
const DEMO_CITY = 'München';

export interface FlyerImportDeps {
  db: Db;
  /** `null` = search unavailable after retries (≠ an empty result). */
  search(terms: string): Promise<SearchCandidate[] | null>;
  lookupProduct(gtin: string, locale: string): Promise<ProviderProduct | null>;
  planStores(batch: FlyerBatch, batchIndex: number): Promise<StoreProvisioningPlan>;
  now(): Date;
  log(line: string): void;
}

export interface OfferOutcome {
  retailerSlug: string;
  name: string;
  quantityText: string | null;
  outcome: 'offer' | 'draft';
  matchedGtin: string | null;
  reason: string;
  detail: string;
}

export interface ImportSummary {
  offersProcessed: number;
  matched: number;
  draftsPending: number;
  offersCreated: number;
  offersUpdated: number;
  observationsAppended: number;
  productsCreated: number;
  retailersCreated: number;
  marketsCreated: number;
  storesCreated: number;
  storeOriginBySlug: Record<string, 'osm' | 'demo' | 'existing'>;
  outcomes: OfferOutcome[];
}

/** `"2026-09-04"` → UTC midnight. Precise-enough for day-granular flyer validity. */
function dateOrNull(value: string | undefined): Date | null {
  return value ? new Date(`${value}T00:00:00Z`) : null;
}

/** Search terms: brand + name, without printing the brand twice. */
export function buildSearchTerms(offer: FlyerOfferRow): string {
  const brand = offer.brand?.trim() ?? '';
  if (brand === '' || offer.name.toLowerCase().includes(brand.toLowerCase())) return offer.name;
  return `${brand} ${offer.name}`;
}

async function provisionRetailerMarket(
  db: Db,
  batch: FlyerBatch,
  summary: ImportSummary,
): Promise<string> {
  const [existingRetailer] = await db
    .select({ id: retailers.id })
    .from(retailers)
    .where(eq(retailers.slug, batch.retailerSlug))
    .limit(1);
  const [retailerRow] = await db
    .insert(retailers)
    .values({ name: batch.retailerName, slug: batch.retailerSlug })
    .onConflictDoUpdate({ target: retailers.slug, set: { name: batch.retailerName } })
    .returning({ id: retailers.id });
  if (!existingRetailer) summary.retailersCreated += 1;

  const [existingMarket] = await db
    .select({ id: retailerMarkets.id })
    .from(retailerMarkets)
    .where(
      and(
        eq(retailerMarkets.retailerId, retailerRow.id),
        eq(retailerMarkets.countryCode, batch.countryCode),
      ),
    )
    .limit(1);
  const [marketRow] = await db
    .insert(retailerMarkets)
    .values({
      retailerId: retailerRow.id,
      countryCode: batch.countryCode,
      currencyCode: batch.currencyCode,
      displayName: `${batch.retailerName} ${batch.countryCode}`,
    })
    .onConflictDoUpdate({
      target: [retailerMarkets.retailerId, retailerMarkets.countryCode],
      set: { currencyCode: batch.currencyCode },
    })
    .returning({ id: retailerMarkets.id });
  if (!existingMarket) summary.marketsCreated += 1;
  return marketRow.id;
}

async function provisionStores(
  db: Db,
  batch: FlyerBatch,
  batchIndex: number,
  marketId: string,
  deps: FlyerImportDeps,
  summary: ImportSummary,
): Promise<void> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(stores)
    .where(eq(stores.retailerMarketId, marketId));

  const plan = await deps.planStores(batch, batchIndex);
  if (plan.stores.length === 0) {
    summary.storeOriginBySlug[batch.retailerSlug] = count > 0 ? 'existing' : 'demo';
    return;
  }
  // A market that already has stores keeps them; demo fallbacks are only planted
  // into an EMPTY market so a later successful Overpass run is never diluted.
  if (plan.origin === 'demo' && count > 0) {
    summary.storeOriginBySlug[batch.retailerSlug] = 'existing';
    return;
  }

  summary.storeOriginBySlug[batch.retailerSlug] = plan.origin;
  for (const store of plan.stores) {
    const [existing] = await db
      .select({ id: stores.id })
      .from(stores)
      .where(and(eq(stores.retailerMarketId, marketId), eq(stores.externalRef, store.externalRef)))
      .limit(1);
    await db
      .insert(stores)
      .values({
        retailerMarketId: marketId,
        name: store.name,
        location: sql`ST_SetSRID(ST_MakePoint(${store.lng}, ${store.lat}), 4326)::geography` as never,
        street: store.street,
        postalCode: store.postalCode,
        city: store.city,
        countryCode: batch.countryCode,
        openingHours: null,
        externalRef: store.externalRef,
      })
      .onConflictDoUpdate({
        target: [stores.retailerMarketId, stores.externalRef],
        set: {
          name: store.name,
          location: sql`ST_SetSRID(ST_MakePoint(${store.lng}, ${store.lat}), 4326)::geography` as never,
          street: store.street,
          postalCode: store.postalCode,
          city: store.city,
        },
      });
    if (!existing) summary.storesCreated += 1;
  }
}

/** Match stage: a pre-resolved GTIN (checksum-verified) wins; otherwise search. */
async function matchOffer(
  batch: FlyerBatch,
  offer: FlyerOfferRow,
  deps: FlyerImportDeps,
): Promise<MatchDecision> {
  if (offer.gtin !== undefined) {
    const gtin = normalizeGtin(offer.gtin);
    if (!isValidGtinChecksum(gtin)) {
      return {
        status: 'unmatched',
        reason: 'invalid_gtin',
        detail: `import row carries gtin "${offer.gtin}" with a bad checksum`,
      };
    }
    return {
      status: 'matched',
      gtin,
      candidate: { code: gtin },
      reason: 'gtin supplied by the import row (checksum verified)',
    };
  }
  if (!offer.brand || offer.brand.trim() === '') {
    // The brand gate can never pass — skip the search round trip entirely.
    return decideMatch(
      { name: offer.name, brand: null, quantityText: offer.quantityText ?? null, countryCode: batch.countryCode },
      [],
    );
  }
  const candidates = await deps.search(buildSearchTerms(offer));
  if (candidates === null) {
    // NOT the same as "no hits": the draft must say the truth so a later re-import
    // (which is idempotent) can pick the row up again.
    return {
      status: 'unmatched',
      reason: 'search_failed',
      detail: 'catalog search unavailable after retries; re-run the import later',
    };
  }
  return decideMatch(
    {
      name: offer.name,
      brand: offer.brand,
      quantityText: offer.quantityText ?? null,
      countryCode: batch.countryCode,
    },
    candidates,
  );
}

/** Finds-or-creates the matched product, preferring the full provider record. */
async function ensureProduct(
  db: Db,
  batch: FlyerBatch,
  offer: FlyerOfferRow,
  gtin: string,
  candidate: SearchCandidate,
  deps: FlyerImportDeps,
  summary: ImportSummary,
  locale: string,
): Promise<string> {
  const [existing] = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.gtin, gtin))
    .limit(1);
  if (existing) return existing.id;

  const full = await deps.lookupProduct(gtin, locale);
  // The search hit itself is enough for an honest (image-less) product row when the
  // full record cannot be fetched; nothing is invented either way.
  const discovered: ProviderProduct = full ?? {
    gtin,
    name: candidate.product_name?.trim() || offer.name,
    brand: offer.brand ?? null,
    quantityText: candidate.quantity ?? offer.quantityText ?? null,
    images: null,
    source: 'openfoodfacts',
    sourceRef: gtin,
  };

  const candidates = buildSlugCandidates({
    brand: discovered.brand,
    name: discovered.name,
    quantityText: discovered.quantityText,
    gtin,
  });
  for (const slug of candidates) {
    const [row] = await db
      .insert(products)
      .values({
        gtin,
        slug,
        name: discovered.name,
        brand: discovered.brand,
        quantityText: discovered.quantityText,
        images: discovered.images,
        countryCode: batch.countryCode,
        source: discovered.source,
        sourceRef: discovered.sourceRef,
        sourceSyncedAt: deps.now(),
      })
      .onConflictDoNothing()
      .returning({ id: products.id });
    if (row) {
      summary.productsCreated += 1;
      return row.id;
    }
    // Either the gtin or the slug already exists; if the gtin does, use that row.
    const [raced] = await db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.gtin, gtin))
      .limit(1);
    if (raced) return raced.id;
    // Otherwise the slug collided with a different product — try the next candidate.
  }
  throw new Error(`could not allocate a slug for gtin ${gtin}`);
}

/**
 * Market-wide offer upsert (`offers_product_market_wide_key`), appending a
 * `price_observations` row only when something actually changed — this is what
 * makes a re-run of the same file byte-for-byte idempotent.
 */
async function upsertOffer(
  db: Db,
  marketId: string,
  productId: string,
  batch: FlyerBatch,
  offer: FlyerOfferRow,
  deps: FlyerImportDeps,
  summary: ImportSummary,
): Promise<void> {
  const validFrom = dateOrNull(offer.validFrom);
  const validUntil = offer.kind === 'permanent_reduction' ? null : dateOrNull(offer.validUntil);
  const now = deps.now();

  const [existing] = await db
    .select({
      id: offers.id,
      priceAmountMinor: offers.priceAmountMinor,
      validFrom: offers.validFrom,
      validUntil: offers.validUntil,
    })
    .from(offers)
    .where(
      and(eq(offers.productId, productId), eq(offers.retailerMarketId, marketId), isNull(offers.storeId)),
    )
    .limit(1);

  const unchanged =
    existing !== undefined &&
    Number(existing.priceAmountMinor) === offer.priceMinor &&
    (existing.validFrom?.getTime() ?? null) === (validFrom?.getTime() ?? null) &&
    (existing.validUntil?.getTime() ?? null) === (validUntil?.getTime() ?? null);

  if (existing) {
    await db
      .update(offers)
      .set({
        priceAmountMinor: offer.priceMinor,
        currencyCode: batch.currencyCode,
        observedAt: now,
        validFrom,
        validUntil,
        source: 'provider',
        updatedAt: now,
      })
      .where(eq(offers.id, existing.id));
    if (!unchanged) summary.offersUpdated += 1;
  } else {
    await db.insert(offers).values({
      productId,
      retailerMarketId: marketId,
      storeId: null,
      priceAmountMinor: offer.priceMinor,
      currencyCode: batch.currencyCode,
      promotionId: null,
      observedAt: now,
      validFrom,
      validUntil,
      source: 'provider',
    });
    summary.offersCreated += 1;
  }

  if (!unchanged) {
    await db.insert(priceObservations).values({
      productId,
      retailerMarketId: marketId,
      storeId: null,
      priceAmountMinor: offer.priceMinor,
      currencyCode: batch.currencyCode,
      observedAt: now,
      source: 'provider',
    });
    summary.observationsAppended += 1;
  }
}

/** Draft upsert on the natural key. A reviewer's `rejected` verdict is never undone. */
async function upsertDraft(
  db: Db,
  marketId: string,
  batch: FlyerBatch,
  offer: FlyerOfferRow,
  decision: MatchDecision,
  matchedProductId: string | null,
  deps: FlyerImportDeps,
): Promise<void> {
  const quantityText = offer.quantityText ?? null;
  const [existing] = await db
    .select({ id: flyerOfferDrafts.id, matchStatus: flyerOfferDrafts.matchStatus })
    .from(flyerOfferDrafts)
    .where(
      and(
        eq(flyerOfferDrafts.retailerMarketId, marketId),
        eq(flyerOfferDrafts.name, offer.name),
        quantityText === null
          ? isNull(flyerOfferDrafts.quantityText)
          : eq(flyerOfferDrafts.quantityText, quantityText),
      ),
    )
    .limit(1);

  const values = {
    retailerMarketId: marketId,
    name: offer.name,
    brand: offer.brand ?? null,
    quantityText,
    priceMinor: offer.priceMinor,
    oldPriceMinor: offer.oldPriceMinor ?? null,
    currencyCode: batch.currencyCode,
    validFrom: dateOrNull(offer.validFrom),
    validUntil: dateOrNull(offer.validUntil),
    sourceUrl: batch.sourceUrl,
    harvestedAt: dateOrNull(batch.harvestedAt) ?? deps.now(),
    matchStatus: (decision.status === 'matched' ? 'matched' : 'pending') as schema.FlyerMatchStatus,
    matchReason: decision.status === 'matched' ? decision.reason : `${decision.reason}: ${decision.detail}`,
    matchedProductId,
  };

  if (existing) {
    const keepRejected = existing.matchStatus === 'rejected';
    await db
      .update(flyerOfferDrafts)
      .set({
        ...values,
        matchStatus: keepRejected ? 'rejected' : values.matchStatus,
        updatedAt: deps.now(),
      })
      .where(eq(flyerOfferDrafts.id, existing.id));
  } else {
    await db.insert(flyerOfferDrafts).values(values);
  }
}

export async function runFlyerImport(file: FlyerImportFile, deps: FlyerImportDeps): Promise<ImportSummary> {
  const summary: ImportSummary = {
    offersProcessed: 0,
    matched: 0,
    draftsPending: 0,
    offersCreated: 0,
    offersUpdated: 0,
    observationsAppended: 0,
    productsCreated: 0,
    retailersCreated: 0,
    marketsCreated: 0,
    storesCreated: 0,
    storeOriginBySlug: {},
    outcomes: [],
  };
  const defaultLocale = buildConfig().defaults.locale;

  for (const [batchIndex, batch] of file.batches.entries()) {
    const locale = batch.locale ?? defaultLocale;
    const marketId = await provisionRetailerMarket(deps.db, batch, summary);
    await provisionStores(deps.db, batch, batchIndex, marketId, deps, summary);
    deps.log(
      `[import] ${batch.retailerName} (${batch.retailerSlug}/${batch.countryCode}): market ready, stores=${summary.storeOriginBySlug[batch.retailerSlug]}`,
    );

    for (const offer of batch.offers) {
      summary.offersProcessed += 1;
      const decision = await matchOffer(batch, offer, deps);

      let productId: string | null = null;
      if (decision.status === 'matched') {
        productId = await ensureProduct(
          deps.db, batch, offer, decision.gtin, decision.candidate, deps, summary, locale,
        );
        await upsertOffer(deps.db, marketId, productId, batch, offer, deps, summary);
        summary.matched += 1;
        deps.log(`[import]   MATCH  ${offer.name} (${offer.quantityText ?? '-'}) -> ${decision.gtin}`);
      } else {
        summary.draftsPending += 1;
        deps.log(
          `[import]   DRAFT  ${offer.name} (${offer.quantityText ?? '-'}) — ${decision.reason}: ${decision.detail}`,
        );
      }
      await upsertDraft(deps.db, marketId, batch, offer, decision, productId, deps);

      summary.outcomes.push({
        retailerSlug: batch.retailerSlug,
        name: offer.name,
        quantityText: offer.quantityText ?? null,
        outcome: decision.status === 'matched' ? 'offer' : 'draft',
        matchedGtin: decision.status === 'matched' ? decision.gtin : null,
        reason: decision.status === 'matched' ? 'matched' : decision.reason,
        detail: decision.status === 'matched' ? decision.reason : decision.detail,
      });
    }
  }

  deps.log(
    `[import] done: ${summary.offersProcessed} offers processed — ${summary.matched} confidently matched -> offers ` +
      `(${summary.offersCreated} created, ${summary.offersUpdated} price-updated, ${summary.observationsAppended} observations), ` +
      `${summary.draftsPending} -> review drafts; ${summary.productsCreated} products created; ` +
      `${summary.retailersCreated} retailers, ${summary.marketsCreated} markets, ${summary.storesCreated} stores created ` +
      `(origins: ${JSON.stringify(summary.storeOriginBySlug)})`,
  );
  return summary;
}

/** Escapes a chain name for use inside an Overpass regex. */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function main(): Promise<void> {
  const fileArg = process.argv[2];
  if (!fileArg) {
    process.stderr.write('usage: npm run import:flyers -- data/flyer-imports/<file>.json\n');
    process.exit(2);
  }
  const file = readFlyerImportFile(path.resolve(fileArg));
  const config = buildConfig();
  const pool = new Pool({ connectionString: config.database.url });
  const db = drizzle(pool, { schema });
  const off = new OffSearchClient({
    baseUrl: config.openFoodFacts.baseUrl,
    userAgent: IMPORT_USER_AGENT,
    minIntervalMs: OFF_MIN_INTERVAL_MS,
    timeoutMs: OFF_TIMEOUT_MS,
    maxAttempts: OFF_MAX_ATTEMPTS,
    retryDelayMs: OFF_RETRY_DELAY_MS,
  });

  const deps: FlyerImportDeps = {
    db,
    search: (terms) => off.search(terms),
    lookupProduct: (gtin, locale) => off.lookupProduct(gtin, locale),
    planStores: async (batch, batchIndex) => {
      const osm = await fetchStoresFromOverpass(escapeRegex(batch.retailerName), `${batch.retailerName} ${DEMO_CITY}`, {
        endpoints: OVERPASS_ENDPOINTS,
        bbox: DEMO_BBOX,
        timeoutMs: OVERPASS_TIMEOUT_MS,
        userAgent: IMPORT_USER_AGENT,
      });
      if (osm && osm.length > 0) return { origin: 'osm', stores: osm };
      // Unreachable OR empty → labeled demo locations (never fabricated addresses).
      return {
        origin: 'demo',
        stores: demoStores(
          batch.retailerName,
          batch.retailerSlug,
          DEMO_CITY,
          batchIndex % 2 === 0 ? MUNICH_DEMO_POINTS : MUNICH_DEMO_POINTS_ALT,
        ),
      };
    },
    now: () => new Date(),
    log: (line) => process.stdout.write(`${line}\n`),
  };

  try {
    await runFlyerImport(file, deps);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`[import] FAILED: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exit(1);
  });
}
