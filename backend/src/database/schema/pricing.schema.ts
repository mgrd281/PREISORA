import { bigint, char, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { products, promotions, retailerMarkets, stores } from './catalog.schema';

/** Where an offer came from — the seam for provider ingestion (deferred). */
export const offerSources = ['seed', 'manual', 'provider'] as const;
export type OfferSource = (typeof offerSources)[number];

/**
 * CURRENT price state, upserted per (product, market, store).
 *
 * `store_id` NULL means a market-wide uniform price that applies to every store of
 * the market. A store-specific row overrides the market-wide row FOR THAT STORE —
 * see `PriceRankingService`, where that rule is implemented and unit-tested.
 */
export const offers = pgTable(
  'offers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    retailerMarketId: uuid('retailer_market_id')
      .notNull()
      .references(() => retailerMarkets.id, { onDelete: 'cascade' }),
    storeId: uuid('store_id').references(() => stores.id, { onDelete: 'cascade' }),
    priceAmountMinor: bigint('price_amount_minor', { mode: 'number' }).notNull(),
    currencyCode: char('currency_code', { length: 3 }).notNull(),
    promotionId: uuid('promotion_id').references(() => promotions.id, { onDelete: 'set null' }),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    validFrom: timestamp('valid_from', { withTimezone: true }),
    validUntil: timestamp('valid_until', { withTimezone: true }),
    source: text('source').$type<OfferSource>().notNull().default('seed'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('offers_product_idx').on(table.productId),
    index('offers_store_idx').on(table.storeId),
    index('offers_market_idx').on(table.retailerMarketId),
  ],
);

/** Append-only price history. Feeds `PriceHistoryService` aggregation only. */
export const priceObservations = pgTable(
  'price_observations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    retailerMarketId: uuid('retailer_market_id')
      .notNull()
      .references(() => retailerMarkets.id, { onDelete: 'cascade' }),
    storeId: uuid('store_id').references(() => stores.id, { onDelete: 'cascade' }),
    priceAmountMinor: bigint('price_amount_minor', { mode: 'number' }).notNull(),
    currencyCode: char('currency_code', { length: 3 }).notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    source: text('source').$type<OfferSource>().notNull().default('seed'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('price_observations_product_observed_idx').on(table.productId, table.observedAt)],
);
