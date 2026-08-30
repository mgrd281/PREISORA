import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { geographyPoint } from './geography';

/** A product image rendition (contract `ImageAsset`). */
export interface ProductImage {
  url: string;
  widthPx: number;
  heightPx: number;
}

/** One weekly opening interval (contract `Store.openingHours[]`). */
export interface OpeningHour {
  dayOfWeek: number;
  opensAt: string;
  closesAt: string;
}

export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gtin: text('gtin').notNull(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    brand: text('brand'),
    quantityText: text('quantity_text'),
    /**
     * Pack size expressed in the base unit of `unitPriceQuantityText`
     * (a 250 g butter with base "1 kg" stores 0.25). `null` disables unit pricing.
     */
    unitPriceDivisor: numeric('unit_price_divisor', { precision: 12, scale: 4 }),
    unitPriceQuantityText: text('unit_price_quantity_text'),
    images: jsonb('images').$type<ProductImage[] | null>(),
    countryCode: char('country_code', { length: 2 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('products_gtin_key').on(table.gtin),
    uniqueIndex('products_slug_key').on(table.slug),
    index('products_name_idx').on(table.name),
  ],
);

export const retailers = pgTable(
  'retailers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('retailers_slug_key').on(table.slug)],
);

/** A retailer's presence in exactly one country (constitution §25). */
export const retailerMarkets = pgTable(
  'retailer_markets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    retailerId: uuid('retailer_id')
      .notNull()
      .references(() => retailers.id, { onDelete: 'cascade' }),
    countryCode: char('country_code', { length: 2 }).notNull(),
    currencyCode: char('currency_code', { length: 3 }).notNull(),
    displayName: text('display_name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('retailer_markets_retailer_country_key').on(table.retailerId, table.countryCode),
  ],
);

export const stores = pgTable(
  'stores',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    retailerMarketId: uuid('retailer_market_id')
      .notNull()
      .references(() => retailerMarkets.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    location: geographyPoint('location').notNull(),
    street: text('street').notNull(),
    postalCode: text('postal_code').notNull(),
    city: text('city').notNull(),
    countryCode: char('country_code', { length: 2 }).notNull(),
    openingHours: jsonb('opening_hours').$type<OpeningHour[] | null>(),
    externalRef: text('external_ref'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The GIST index is what makes ST_DWithin radius queries an index scan.
    index('stores_location_gix').using('gist', table.location),
    uniqueIndex('stores_market_external_ref_key').on(table.retailerMarketId, table.externalRef),
  ],
);

export const promotionTypes = ['percentage', 'absolute', 'multibuy', 'loyalty'] as const;
export type PromotionType = (typeof promotionTypes)[number];

export const promotions = pgTable('promotions', {
  id: uuid('id').primaryKey().defaultRandom(),
  retailerMarketId: uuid('retailer_market_id').references(() => retailerMarkets.id, {
    onDelete: 'cascade',
  }),
  type: text('type').$type<PromotionType>().notNull(),
  percentOff: integer('percent_off'),
  amountOffMinor: bigint('amount_off_minor', { mode: 'number' }),
  amountOffCurrencyCode: char('amount_off_currency_code', { length: 3 }),
  requiresLoyaltyCard: boolean('requires_loyalty_card').notNull().default(false),
  label: text('label'),
  startsAt: timestamp('starts_at', { withTimezone: true }),
  endsAt: timestamp('ends_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});
