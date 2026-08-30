import { boolean, char, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** The five capability keys the contract's `Capabilities.features` object carries. */
export const FEATURE_KEYS = [
  'priceHistory',
  'priceAlerts',
  'shoppingOptimizer',
  'receiptScanner',
  'visualProductScan',
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

/**
 * Feature-flag matrix. A NULL scope column means "any": `country_code = NULL` is a
 * global rule, `platform = NULL` applies to every platform. `FeatureFlagsService`
 * resolves most-specific-wins against the RequestContext.
 *
 * Idempotent seeding relies on the unique index over COALESCE'd scope columns
 * created in the migration (NULLs are distinct in a plain unique index).
 */
export const featureFlags = pgTable('feature_flags', {
  id: uuid('id').primaryKey().defaultRandom(),
  flagKey: text('flag_key').notNull(),
  countryCode: char('country_code', { length: 2 }),
  platform: text('platform'),
  minAppVersion: text('min_app_version'),
  cohort: text('cohort'),
  enabled: boolean('enabled').notNull().default(false),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
