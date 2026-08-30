import {
  char,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const identityProviders = ['anonymous', 'email', 'apple', 'google'] as const;
export type IdentityProvider = (typeof identityProviders)[number];

export const devicePlatforms = ['ios', 'android'] as const;
export type DevicePlatform = (typeof devicePlatforms)[number];

/** `users.id` is the ONLY primary identity (constitution §11). */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email'),
    displayName: text('display_name'),
    countryCode: char('country_code', { length: 2 }).notNull(),
    locale: text('locale').notNull(),
    /** Feature-flag cohort; assignment logic is deferred (flags may target it). */
    cohort: text('cohort'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('users_email_key').on(table.email)],
);

/**
 * A linked sign-in method. `UNIQUE(provider, provider_subject)`; anonymous rows
 * carry `provider_subject = NULL` (Postgres treats NULLs as distinct, so an account
 * per anonymous session is exactly what the constraint allows).
 */
export const userIdentities = pgTable(
  'user_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').$type<IdentityProvider>().notNull(),
    providerSubject: text('provider_subject'),
    /** argon2id hash — only ever set for the `email` provider. */
    passwordHash: text('password_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('user_identities_provider_subject_key').on(table.provider, table.providerSubject),
    index('user_identities_user_idx').on(table.userId),
  ],
);

/** Refresh tokens are stored hashed and rotated on every use. */
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('refresh_tokens_hash_key').on(table.tokenHash),
    index('refresh_tokens_user_idx').on(table.userId),
  ],
);

export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    platform: text('platform').$type<DevicePlatform>().notNull(),
    pushToken: text('push_token').notNull(),
    appVersion: text('app_version').notNull(),
    locale: text('locale').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('devices_user_platform_token_key').on(table.userId, table.platform, table.pushToken),
  ],
);
