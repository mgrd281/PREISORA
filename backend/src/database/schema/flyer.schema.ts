import { bigint, char, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { products, retailerMarkets } from './catalog.schema';

/**
 * Review state of a harvested flyer offer.
 *
 * - `pending`  — no confident product match yet; awaits human review.
 * - `matched`  — confidently linked to a `products` row; the price went to `offers`.
 * - `rejected` — a reviewer decided this row must never become an offer.
 */
export const flyerMatchStatuses = ['pending', 'matched', 'rejected'] as const;
export type FlyerMatchStatus = (typeof flyerMatchStatuses)[number];

/**
 * The flyer-import review queue (server-side only — NOT on the wire; the OpenAPI
 * contract is frozen and knows nothing of drafts).
 *
 * EVERY harvested flyer offer lands here, matched or not, so the table is the full
 * audit trail of an import: what the flyer said verbatim, what the matcher decided
 * and why. Only rows that ALSO earned a confident product match are mirrored into
 * `offers` — a price is never attached to a product on a guess (a wrong price on a
 * scan kills the product's credibility).
 *
 * Natural key (enforced by `flyer_offer_drafts_natural_key` in the migration):
 * (retailer_market_id, name, quantity_text) — re-importing the same file updates in
 * place instead of duplicating.
 */
export const flyerOfferDrafts = pgTable(
  'flyer_offer_drafts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    retailerMarketId: uuid('retailer_market_id')
      .notNull()
      .references(() => retailerMarkets.id, { onDelete: 'cascade' }),
    /** Product name exactly as the flyer printed it. */
    name: text('name').notNull(),
    brand: text('brand'),
    quantityText: text('quantity_text'),
    priceMinor: bigint('price_minor', { mode: 'number' }).notNull(),
    /** The crossed-out previous price, when the flyer advertised one. */
    oldPriceMinor: bigint('old_price_minor', { mode: 'number' }),
    currencyCode: char('currency_code', { length: 3 }).notNull(),
    validFrom: timestamp('valid_from', { withTimezone: true }),
    validUntil: timestamp('valid_until', { withTimezone: true }),
    /** The retailer's own public page the batch was harvested from. */
    sourceUrl: text('source_url'),
    harvestedAt: timestamp('harvested_at', { withTimezone: true }),
    matchStatus: text('match_status').$type<FlyerMatchStatus>().notNull().default('pending'),
    /** Machine-readable reason for the current status (e.g. `ambiguous_gtins`). */
    matchReason: text('match_reason'),
    matchedProductId: uuid('matched_product_id').references(() => products.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('flyer_offer_drafts_market_idx').on(table.retailerMarketId),
    index('flyer_offer_drafts_status_idx').on(table.matchStatus),
  ],
);
