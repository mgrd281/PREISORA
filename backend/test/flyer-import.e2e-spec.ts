/**
 * The flyer-import pipeline, end to end and OFFLINE: recorded Open Food Facts
 * payloads stand in for the search/lookup network calls, and the labeled demo
 * store fallback stands in for Overpass — no e2e run performs a third-party
 * network call (same policy as the provider suite).
 *
 * Proves the funnel the pipeline exists for: import a real harvested file, then
 * scan the one confidently-matched GTIN and get "cheapest place: <chain> at
 * <price>" out of the frozen wire contract.
 */
import { INestApplication } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Pool } from 'pg';
import { normalizeOffProduct } from '../src/modules/products/providers/openfoodfacts/openfoodfacts.normalizer';
import type { OffProductResponse } from '../src/modules/products/providers/openfoodfacts/openfoodfacts.types';
import * as schema from '../src/database/schema';
import { flyerOfferDrafts, offers, priceObservations, products, retailers, stores } from '../src/database/schema';
import { readFlyerImportFile } from '../src/import/flyer-import-file';
import { FlyerImportDeps, ImportSummary, runFlyerImport } from '../src/import/import-flyers';
import type { SearchCandidate } from '../src/import/matcher';
import { demoStores, MUNICH_DEMO_POINTS, MUNICH_DEMO_POINTS_ALT } from '../src/import/store-provisioning';
import { API, MUNICH, createTestApp, http } from './helpers';

const IMPORT_FILE = path.join(__dirname, '..', 'data', 'flyer-imports', '2026-W36.json');
const FIXTURES = path.join(__dirname, 'fixtures', 'openfoodfacts-search');
const MATCHED_GTIN = '4061458056557'; // Farmer Macadamia geröstet & gesalzen, 125 g

function fixture<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8')) as T;
}

/** Recorded search payloads, keyed by the exact terms the importer builds. */
const SEARCH_FIXTURES: Record<string, string> = {
  'Farmer Macadamia gesalzen': 'search-farmer-macadamia-gesalzen.json',
  'Ferrero B-ready': 'search-ferrero-b-ready.json',
  'Golden Seafood Garnelen Sortiment XXL': 'search-golden-seafood-garnelen.json',
  "Rio d'Oro Orangennektar": 'search-rio-doro-orangennektar.json',
};

describe('flyer import pipeline (e2e, offline)', () => {
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let app: INestApplication;
  let firstRun: ImportSummary;
  let secondRun: ImportSummary;

  const deps = (): FlyerImportDeps => ({
    db,
    search: async (terms) => {
      const file = SEARCH_FIXTURES[terms];
      return file ? fixture<{ products: SearchCandidate[] }>(file).products : [];
    },
    lookupProduct: async (gtin, locale) =>
      gtin === MATCHED_GTIN
        ? normalizeOffProduct(fixture<OffProductResponse>('product-4061458056557.json'), {
            gtin,
            locale,
            source: 'openfoodfacts',
          })
        : null,
    planStores: async (batch, batchIndex) => ({
      origin: 'demo',
      stores: demoStores(
        batch.retailerName,
        batch.retailerSlug,
        'München',
        batchIndex % 2 === 0 ? MUNICH_DEMO_POINTS : MUNICH_DEMO_POINTS_ALT,
      ),
    }),
    now: () => new Date(),
    log: () => undefined,
  });

  async function counts() {
    const [drafts, offerRows, observationRows, productRows] = await Promise.all([
      db.select({ id: flyerOfferDrafts.id }).from(flyerOfferDrafts),
      db.select({ id: offers.id }).from(offers).where(eq(offers.source, 'provider')),
      db
        .select({ id: priceObservations.id })
        .from(priceObservations)
        .where(eq(priceObservations.source, 'provider')),
      db.select({ id: products.id }).from(products).where(eq(products.source, 'openfoodfacts')),
    ]);
    return {
      drafts: drafts.length,
      offers: offerRows.length,
      observations: observationRows.length,
      offProducts: productRows.length,
    };
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = drizzle(pool, { schema });
    const file = readFlyerImportFile(IMPORT_FILE);
    firstRun = await runFlyerImport(file, deps());
    secondRun = await runFlyerImport(file, deps());
    app = await createTestApp();
  });

  afterAll(async () => {
    // This suite shares the test database with suites that assert Munich is
    // store-free and the seed is untouched — everything the import created is
    // removed again (retailer cascade covers markets, stores, offers and drafts).
    await db.delete(retailers).where(inArray(retailers.slug, ['aldi-sued', 'norma']));
    await db.delete(products).where(eq(products.gtin, MATCHED_GTIN));
    await app?.close();
    await pool.end();
  });

  it('processes all 16 offers: 1 confident match, 15 review drafts (the honest split)', () => {
    expect(firstRun.offersProcessed).toBe(16);
    expect(firstRun.matched).toBe(1);
    expect(firstRun.draftsPending).toBe(15);
    expect(firstRun.offersCreated).toBe(1);
    expect(firstRun.productsCreated).toBe(1);
    expect(firstRun.retailersCreated).toBe(2);
    expect(firstRun.marketsCreated).toBe(2);
    expect(firstRun.storesCreated).toBe(6); // 3 labeled demo locations per chain
    const matched = firstRun.outcomes.find((o) => o.outcome === 'offer');
    expect(matched).toMatchObject({ name: 'Farmer Macadamia gesalzen', matchedGtin: MATCHED_GTIN });
  });

  it('is idempotent: the second run converges instead of duplicating', async () => {
    expect(secondRun.offersProcessed).toBe(16);
    expect(secondRun.matched).toBe(1);
    expect(secondRun.offersCreated).toBe(0);
    expect(secondRun.offersUpdated).toBe(0); // price unchanged → no new observation
    expect(secondRun.observationsAppended).toBe(0);
    expect(secondRun.productsCreated).toBe(0);
    expect(secondRun.retailersCreated).toBe(0);
    expect(secondRun.storesCreated).toBe(0);

    const after = await counts();
    expect(after.drafts).toBe(16); // every flyer row exactly once
    expect(after.offers).toBe(1);
    expect(after.observations).toBe(1);
    expect(after.offProducts).toBe(1);
  });

  it('keeps every unmatched offer as a pending draft with a machine-readable reason', async () => {
    const pending = await db
      .select({
        name: flyerOfferDrafts.name,
        matchStatus: flyerOfferDrafts.matchStatus,
        matchReason: flyerOfferDrafts.matchReason,
        matchedProductId: flyerOfferDrafts.matchedProductId,
      })
      .from(flyerOfferDrafts)
      .where(eq(flyerOfferDrafts.matchStatus, 'pending'));
    expect(pending).toHaveLength(15);
    for (const draft of pending) {
      expect(draft.matchedProductId).toBeNull();
      expect(draft.matchReason).toMatch(/^(no_brand|no_result|brand_mismatch|quantity_mismatch|ambiguous_gtins|invalid_gtin):/);
    }
    // The two sharp cases the matcher must refuse:
    expect(pending.find((d) => d.name === 'Ferrero B-ready')?.matchReason).toContain('quantity_mismatch');
    expect(pending.find((d) => d.name === "Rio d'Oro Orangennektar")?.matchReason).toContain('ambiguous_gtins');
  });

  it('the matched draft row points at the created product', async () => {
    const [draft] = await db
      .select({
        matchStatus: flyerOfferDrafts.matchStatus,
        matchedProductId: flyerOfferDrafts.matchedProductId,
      })
      .from(flyerOfferDrafts)
      .where(eq(flyerOfferDrafts.name, 'Farmer Macadamia gesalzen'));
    expect(draft.matchStatus).toBe('matched');
    expect(draft.matchedProductId).not.toBeNull();
  });

  it('answers the scan journey: by-gtin → offers near Munich → ALDI SÜD is best', async () => {
    const product = await http(app).get(`${API}/products/by-gtin/${MATCHED_GTIN}`).expect(200);
    expect(product.body).toMatchObject({
      gtin: MATCHED_GTIN,
      brand: 'Farmer',
    });

    const offersPage = await http(app)
      .get(`${API}/products/${product.body.id}/offers`)
      .query({ lat: MUNICH.lat, lng: MUNICH.lng, radiusMeters: 8000 })
      .expect(200);

    expect(offersPage.body.data).toHaveLength(1);
    const best = offersPage.body.data[0];
    expect(best).toMatchObject({
      isBest: true,
      freshness: 'fresh',
      storeId: null, // market-wide: one price for the whole chain (§25 model)
      distanceMeters: null, // the contract renders market-wide offers without a distance
      price: { amountMinor: 299, currencyCode: 'EUR' },
      effectivePrice: { amountMinor: 299 },
    });

    // The chain's reachability (and distance) is on the stores surface: the
    // market-wide ALDI SÜD offer only survived because its stores are in radius.
    const [offerRow] = await db
      .select({ retailerMarketId: offers.retailerMarketId })
      .from(offers)
      .where(and(eq(offers.source, 'provider'), isNull(offers.storeId)));
    expect(best.retailerMarketId).toBe(offerRow.retailerMarketId);

    const storesPage = await http(app)
      .get(`${API}/stores`)
      .query({ lat: MUNICH.lat, lng: MUNICH.lng, radiusMeters: 8000 })
      .expect(200);
    const aldiStores = storesPage.body.data.filter(
      (store: { retailerMarketId: string }) => store.retailerMarketId === best.retailerMarketId,
    );
    expect(aldiStores.length).toBeGreaterThan(0);
    expect(aldiStores[0].distanceMeters).toBeGreaterThan(0);
    expect(aldiStores[0].name).toContain('Beispiel-Standort'); // honestly labeled fallback
  });

  it('far away from Munich the imported offer is unreachable (NO_CURRENT_PRICES)', async () => {
    const product = await http(app).get(`${API}/products/by-gtin/${MATCHED_GTIN}`).expect(200);
    await http(app)
      .get(`${API}/products/${product.body.id}/offers`)
      .query({ lat: 53.55, lng: 9.99, radiusMeters: 5000 })
      .expect(404);
  });
});
