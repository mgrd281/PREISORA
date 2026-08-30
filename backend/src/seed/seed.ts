/**
 * `npm run seed` — idempotent demo data.
 *
 * Runs standalone (no Nest container) so it can be used in CI, in the e2e setup and
 * from a shell against any DATABASE_URL. Re-running it converges to the same state:
 * catalog rows upsert on their natural keys, and price rows tagged `source = 'seed'`
 * are replaced wholesale.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { buildConfig } from '../config/configuration';
import * as schema from '../database/schema';
import {
  featureFlags,
  offers,
  priceObservations,
  products,
  promotions,
  retailerMarkets,
  retailers,
  stores,
} from '../database/schema';
import {
  SEED_FEATURE_FLAGS,
  SEED_PRODUCTS,
  SEED_PROMOTION,
  SEED_RETAILERS,
  SEED_STORE_PRICE_OVERRIDES,
  seedGtin,
} from './seed-data';

type Db = NodePgDatabase<typeof schema>;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const OBSERVATION_DAYS = 30;

/** Deterministic jitter so a re-seed produces the same history, not a new one. */
function jitterFactor(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return 0.94 + (x - Math.floor(x)) * 0.12; // 0.94 .. 1.06
}

function priceFor(reference: number, index: number, factor = 1): number {
  return Math.max(1, Math.round(reference * index * factor));
}

async function seedRetailersAndStores(
  db: Db,
  countryCode: string,
  currencyCode: string,
): Promise<{
  marketIdBySlug: Map<string, string>;
  storeIdByRef: Map<string, string>;
}> {
  const marketIdBySlug = new Map<string, string>();
  const storeIdByRef = new Map<string, string>();

  for (const retailer of SEED_RETAILERS) {
    const [retailerRow] = await db
      .insert(retailers)
      .values({ name: retailer.name, slug: retailer.slug })
      .onConflictDoUpdate({ target: retailers.slug, set: { name: retailer.name } })
      .returning({ id: retailers.id });

    const [marketRow] = await db
      .insert(retailerMarkets)
      .values({
        retailerId: retailerRow.id,
        countryCode,
        currencyCode,
        displayName: retailer.marketDisplayName,
      })
      .onConflictDoUpdate({
        target: [retailerMarkets.retailerId, retailerMarkets.countryCode],
        set: { currencyCode, displayName: retailer.marketDisplayName },
      })
      .returning({ id: retailerMarkets.id });

    marketIdBySlug.set(retailer.slug, marketRow.id);

    for (const store of retailer.stores) {
      const [storeRow] = await db
        .insert(stores)
        .values({
          retailerMarketId: marketRow.id,
          name: store.name,
          location: sql`ST_SetSRID(ST_MakePoint(${store.lng}, ${store.lat}), 4326)::geography` as never,
          street: store.street,
          postalCode: store.postalCode,
          city: store.city,
          countryCode,
          openingHours: store.openingHours,
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
            openingHours: store.openingHours,
          },
        })
        .returning({ id: stores.id });
      storeIdByRef.set(store.externalRef, storeRow.id);
    }
  }

  return { marketIdBySlug, storeIdByRef };
}

async function seedProducts(db: Db, countryCode: string): Promise<Map<string, string>> {
  const productIdBySlug = new Map<string, string>();

  for (const product of SEED_PRODUCTS) {
    const gtin = seedGtin(product);
    const [row] = await db
      .insert(products)
      .values({
        gtin,
        slug: product.slug,
        name: product.name,
        brand: product.brand,
        quantityText: product.quantityText,
        unitPriceDivisor: product.unitPriceDivisor,
        unitPriceQuantityText: product.unitPriceQuantityText,
        // Image population is a documented seam (constitution §34): the column is
        // nullable and the demo ships without imagery.
        images: null,
        countryCode,
      })
      .onConflictDoUpdate({
        target: products.gtin,
        set: {
          slug: product.slug,
          name: product.name,
          brand: product.brand,
          quantityText: product.quantityText,
          unitPriceDivisor: product.unitPriceDivisor,
          unitPriceQuantityText: product.unitPriceQuantityText,
          countryCode,
          updatedAt: new Date(),
        },
      })
      .returning({ id: products.id });
    productIdBySlug.set(product.slug, row.id);
  }

  return productIdBySlug;
}

async function seedPrices(
  db: Db,
  currencyCode: string,
  marketIdBySlug: Map<string, string>,
  storeIdByRef: Map<string, string>,
  productIdBySlug: Map<string, string>,
  now: Date,
): Promise<{ offers: number; observations: number }> {
  const productIds = [...productIdBySlug.values()];

  // Replace everything this seed owns; anything ingested by a provider survives.
  await db
    .delete(offers)
    .where(and(inArray(offers.productId, productIds), eq(offers.source, 'seed')));
  await db
    .delete(priceObservations)
    .where(
      and(inArray(priceObservations.productId, productIds), eq(priceObservations.source, 'seed')),
    );
  await db.delete(promotions).where(eq(promotions.label, SEED_PROMOTION.label));

  // --- the one demo promotion -----------------------------------------------
  const promotionMarketId = marketIdBySlug.get(SEED_PROMOTION.retailerSlug);
  const [promotionRow] = await db
    .insert(promotions)
    .values({
      retailerMarketId: promotionMarketId ?? null,
      type: SEED_PROMOTION.type,
      percentOff: SEED_PROMOTION.percentOff,
      requiresLoyaltyCard: false,
      label: SEED_PROMOTION.label,
      startsAt: new Date(now.getTime() - SEED_PROMOTION.startsAtDaysAgo * DAY_MS),
      endsAt: new Date(now.getTime() + SEED_PROMOTION.endsAtDaysAhead * DAY_MS),
    })
    .returning({ id: promotions.id });

  const offerRows: (typeof offers.$inferInsert)[] = [];
  const observationRows: (typeof priceObservations.$inferInsert)[] = [];

  for (const retailer of SEED_RETAILERS) {
    const marketId = marketIdBySlug.get(retailer.slug);
    if (!marketId) continue;

    for (const [productIndex, product] of SEED_PRODUCTS.entries()) {
      const productId = productIdBySlug.get(product.slug);
      if (!productId) continue;

      const marketWideAmount = priceFor(product.referenceAmountMinor, retailer.priceIndex);
      const isPromoted =
        retailer.slug === SEED_PROMOTION.retailerSlug && product.slug === SEED_PROMOTION.productSlug;

      // Market-wide uniform price: applies to every store of the market that has no
      // store-specific price of its own.
      offerRows.push({
        productId,
        retailerMarketId: marketId,
        storeId: null,
        priceAmountMinor: marketWideAmount,
        currencyCode,
        promotionId: isPromoted ? promotionRow.id : null,
        observedAt: new Date(now.getTime() - 2 * HOUR_MS),
        validFrom: null,
        validUntil: null,
        source: 'seed',
      });

      // Store-specific overrides.
      for (const store of retailer.stores) {
        const factor = SEED_STORE_PRICE_OVERRIDES[store.externalRef]?.[product.slug];
        if (factor === undefined) continue;
        const storeId = storeIdByRef.get(store.externalRef);
        if (!storeId) continue;
        offerRows.push({
          productId,
          retailerMarketId: marketId,
          storeId,
          priceAmountMinor: priceFor(product.referenceAmountMinor, retailer.priceIndex, factor),
          currencyCode,
          promotionId: null,
          observedAt: new Date(now.getTime() - 3 * HOUR_MS),
          validFrom: null,
          validUntil: null,
          source: 'seed',
        });
      }

      // 30 days of history for the price-history aggregation.
      for (let dayOffset = OBSERVATION_DAYS; dayOffset >= 1; dayOffset -= 1) {
        const observedAt = new Date(now.getTime() - dayOffset * DAY_MS + 9 * HOUR_MS);
        const factor = jitterFactor(productIndex * 97 + dayOffset * 13 + retailer.slug.length);
        observationRows.push({
          productId,
          retailerMarketId: marketId,
          storeId: null,
          priceAmountMinor: priceFor(product.referenceAmountMinor, retailer.priceIndex, factor),
          currencyCode,
          observedAt,
          source: 'seed',
        });
      }

      // Today's observation mirrors the current market-wide offer.
      observationRows.push({
        productId,
        retailerMarketId: marketId,
        storeId: null,
        priceAmountMinor: marketWideAmount,
        currencyCode,
        observedAt: new Date(now.getTime() - 2 * HOUR_MS),
        source: 'seed',
      });
    }
  }

  for (let i = 0; i < offerRows.length; i += 200) {
    await db.insert(offers).values(offerRows.slice(i, i + 200));
  }
  for (let i = 0; i < observationRows.length; i += 500) {
    await db.insert(priceObservations).values(observationRows.slice(i, i + 500));
  }

  return { offers: offerRows.length, observations: observationRows.length };
}

async function seedFeatureFlags(db: Db): Promise<number> {
  for (const flag of SEED_FEATURE_FLAGS) {
    const scope = and(
      eq(featureFlags.flagKey, flag.flagKey),
      flag.countryCode === null
        ? isNull(featureFlags.countryCode)
        : eq(featureFlags.countryCode, flag.countryCode),
      flag.platform === null
        ? isNull(featureFlags.platform)
        : eq(featureFlags.platform, flag.platform),
      flag.minAppVersion === null
        ? isNull(featureFlags.minAppVersion)
        : eq(featureFlags.minAppVersion, flag.minAppVersion),
      flag.cohort === null ? isNull(featureFlags.cohort) : eq(featureFlags.cohort, flag.cohort),
    );

    const [existing] = await db
      .select({ id: featureFlags.id })
      .from(featureFlags)
      .where(scope)
      .limit(1);

    if (existing) {
      await db
        .update(featureFlags)
        .set({ enabled: flag.enabled, description: flag.description, updatedAt: new Date() })
        .where(eq(featureFlags.id, existing.id));
    } else {
      await db.insert(featureFlags).values(flag);
    }
  }
  return SEED_FEATURE_FLAGS.length;
}

export interface SeedSummary {
  retailers: number;
  stores: number;
  products: number;
  offers: number;
  observations: number;
  featureFlags: number;
}

export async function seedDatabase(databaseUrl: string, now: Date = new Date()): Promise<SeedSummary> {
  const config = buildConfig();
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  try {
    const db = drizzle(pool, { schema });
    const { countryCode, currencyCode } = config.defaults;

    const { marketIdBySlug, storeIdByRef } = await seedRetailersAndStores(
      db,
      countryCode,
      currencyCode,
    );
    const productIdBySlug = await seedProducts(db, countryCode);
    const priceCounts = await seedPrices(
      db,
      currencyCode,
      marketIdBySlug,
      storeIdByRef,
      productIdBySlug,
      now,
    );
    const flagCount = await seedFeatureFlags(db);

    return {
      retailers: SEED_RETAILERS.length,
      stores: storeIdByRef.size,
      products: productIdBySlug.size,
      offers: priceCounts.offers,
      observations: priceCounts.observations,
      featureFlags: flagCount,
    };
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const url = process.argv[2] ?? buildConfig().database.url;
  const redacted = url.replace(/\/\/([^:]+):[^@]*@/, '//$1:***@');
  process.stdout.write(`[seed] seeding ${redacted}\n`);
  const summary = await seedDatabase(url);
  process.stdout.write(
    `[seed] done: ${summary.retailers} retailers, ${summary.stores} stores, ` +
      `${summary.products} products, ${summary.offers} offers, ` +
      `${summary.observations} observations, ${summary.featureFlags} feature flags\n`,
  );
  process.stdout.write('[seed] all data is FICTIONAL demo data (no real trademarks).\n');
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`[seed] FAILED: ${String(error)}\n`);
    process.exit(1);
  });
}
