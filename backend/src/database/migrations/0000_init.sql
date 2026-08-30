-- PREISORA initial schema.
-- PostGIS must exist before any geography column is declared.
CREATE EXTENSION IF NOT EXISTS postgis;
--> statement-breakpoint
-- Trigram index support for the phase-1 ILIKE product search.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "products" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "gtin" text NOT NULL,
  "slug" text NOT NULL,
  "name" text NOT NULL,
  "brand" text,
  "quantity_text" text,
  "unit_price_divisor" numeric(12, 4),
  "unit_price_quantity_text" text,
  "images" jsonb,
  "country_code" char(2) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "products_gtin_key" ON "products" ("gtin");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "products_slug_key" ON "products" ("slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_name_idx" ON "products" ("name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_name_trgm_idx" ON "products" USING gin ("name" gin_trgm_ops);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "retailers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "retailers_slug_key" ON "retailers" ("slug");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "retailer_markets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "retailer_id" uuid NOT NULL REFERENCES "retailers"("id") ON DELETE CASCADE,
  "country_code" char(2) NOT NULL,
  "currency_code" char(3) NOT NULL,
  "display_name" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "retailer_markets_retailer_country_key"
  ON "retailer_markets" ("retailer_id", "country_code");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "stores" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "retailer_market_id" uuid NOT NULL REFERENCES "retailer_markets"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "location" geography(Point,4326) NOT NULL,
  "street" text NOT NULL,
  "postal_code" text NOT NULL,
  "city" text NOT NULL,
  "country_code" char(2) NOT NULL,
  "opening_hours" jsonb,
  "external_ref" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Makes ST_DWithin radius queries an index scan instead of a full table scan.
CREATE INDEX IF NOT EXISTS "stores_location_gix" ON "stores" USING gist ("location");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stores_market_external_ref_key"
  ON "stores" ("retailer_market_id", "external_ref");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "promotions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "retailer_market_id" uuid REFERENCES "retailer_markets"("id") ON DELETE CASCADE,
  "type" text NOT NULL,
  "percent_off" integer,
  "amount_off_minor" bigint,
  "amount_off_currency_code" char(3),
  "requires_loyalty_card" boolean DEFAULT false NOT NULL,
  "label" text,
  "starts_at" timestamp with time zone,
  "ends_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "promotions_type_check"
    CHECK ("type" IN ('percentage', 'absolute', 'multibuy', 'loyalty'))
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "offers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  "retailer_market_id" uuid NOT NULL REFERENCES "retailer_markets"("id") ON DELETE CASCADE,
  "store_id" uuid REFERENCES "stores"("id") ON DELETE CASCADE,
  "price_amount_minor" bigint NOT NULL,
  "currency_code" char(3) NOT NULL,
  "promotion_id" uuid REFERENCES "promotions"("id") ON DELETE SET NULL,
  "observed_at" timestamp with time zone NOT NULL,
  "valid_from" timestamp with time zone,
  "valid_until" timestamp with time zone,
  "source" text DEFAULT 'seed' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "offers_source_check" CHECK ("source" IN ('seed', 'manual', 'provider'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offers_product_idx" ON "offers" ("product_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offers_store_idx" ON "offers" ("store_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offers_market_idx" ON "offers" ("retailer_market_id");
--> statement-breakpoint
-- Two partial unique indexes: one current store-specific price per
-- (product, market, store), and one current market-wide price per (product, market).
-- A plain composite unique index would not constrain the NULL store_id rows.
CREATE UNIQUE INDEX IF NOT EXISTS "offers_product_market_store_key"
  ON "offers" ("product_id", "retailer_market_id", "store_id")
  WHERE "store_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "offers_product_market_wide_key"
  ON "offers" ("product_id", "retailer_market_id")
  WHERE "store_id" IS NULL;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "price_observations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  "retailer_market_id" uuid NOT NULL REFERENCES "retailer_markets"("id") ON DELETE CASCADE,
  "store_id" uuid REFERENCES "stores"("id") ON DELETE CASCADE,
  "price_amount_minor" bigint NOT NULL,
  "currency_code" char(3) NOT NULL,
  "observed_at" timestamp with time zone NOT NULL,
  "source" text DEFAULT 'seed' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "price_observations_product_observed_idx"
  ON "price_observations" ("product_id", "observed_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" text,
  "display_name" text,
  "country_code" char(2) NOT NULL,
  "locale" text NOT NULL,
  "cohort" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key" ON "users" ("email");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "user_identities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "provider" text NOT NULL,
  "provider_subject" text,
  "password_hash" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "user_identities_provider_check"
    CHECK ("provider" IN ('anonymous', 'email', 'apple', 'google'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_identities_provider_subject_key"
  ON "user_identities" ("provider", "provider_subject");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_identities_user_idx" ON "user_identities" ("user_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "refresh_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "refresh_tokens_hash_key" ON "refresh_tokens" ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "refresh_tokens_user_idx" ON "refresh_tokens" ("user_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "devices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "platform" text NOT NULL,
  "push_token" text NOT NULL,
  "app_version" text NOT NULL,
  "locale" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "devices_platform_check" CHECK ("platform" IN ('ios', 'android'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "devices_user_platform_token_key"
  ON "devices" ("user_id", "platform", "push_token");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "favorites" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "favorites_user_product_key"
  ON "favorites" ("user_id", "product_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "price_alerts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  "target_amount_minor" bigint NOT NULL,
  "target_currency_code" char(3) NOT NULL,
  "radius_meters" integer NOT NULL,
  "location" geography(Point,4326) NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "last_triggered_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "price_alerts_user_idx" ON "price_alerts" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "price_alerts_active_idx" ON "price_alerts" ("is_active");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "price_alerts_location_gix" ON "price_alerts" USING gist ("location");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "shopping_lists" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shopping_lists_user_idx" ON "shopping_lists" ("user_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "shopping_list_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "list_id" uuid NOT NULL REFERENCES "shopping_lists"("id") ON DELETE CASCADE,
  "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  "quantity" integer DEFAULT 1 NOT NULL,
  "note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "shopping_list_items_list_product_key"
  ON "shopping_list_items" ("list_id", "product_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "feature_flags" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "flag_key" text NOT NULL,
  "country_code" char(2),
  "platform" text,
  "min_app_version" text,
  "cohort" text,
  "enabled" boolean DEFAULT false NOT NULL,
  "description" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- COALESCE'd so that NULL scope columns ("any") still collide, which is what makes
-- `npm run seed` idempotent for flags.
CREATE UNIQUE INDEX IF NOT EXISTS "feature_flags_scope_key" ON "feature_flags" (
  "flag_key",
  COALESCE("country_code", '**'),
  COALESCE("platform", '*'),
  COALESCE("min_app_version", '*'),
  COALESCE("cohort", '*')
);
