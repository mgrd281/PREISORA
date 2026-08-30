-- Flyer-import review queue (constitution §22: product matching is server
-- intelligence).
--
-- Every harvested flyer offer is recorded here verbatim — matched or not — so an
-- import run is fully auditable. Only rows with a CONFIDENT product match are
-- mirrored into `offers`; everything else waits in `match_status = 'pending'` for
-- review. Deliberately NOT on the wire: the OpenAPI contract is frozen and has no
-- draft resource.
CREATE TABLE IF NOT EXISTS "flyer_offer_drafts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "retailer_market_id" uuid NOT NULL REFERENCES "retailer_markets"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "brand" text,
  "quantity_text" text,
  "price_minor" bigint NOT NULL,
  "old_price_minor" bigint,
  "currency_code" char(3) NOT NULL,
  "valid_from" timestamp with time zone,
  "valid_until" timestamp with time zone,
  "source_url" text,
  "harvested_at" timestamp with time zone,
  "match_status" text DEFAULT 'pending' NOT NULL,
  "match_reason" text,
  "matched_product_id" uuid REFERENCES "products"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "flyer_offer_drafts_status_check"
    CHECK ("match_status" IN ('pending', 'matched', 'rejected'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "flyer_offer_drafts_market_idx"
  ON "flyer_offer_drafts" ("retailer_market_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "flyer_offer_drafts_status_idx"
  ON "flyer_offer_drafts" ("match_status");
--> statement-breakpoint
-- The import's natural key: one draft per (market, flyer name, quantity). COALESCE
-- keeps rows without a quantity inside the constraint (NULLs would each be unique).
-- Re-running the same import file therefore UPDATES rather than duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS "flyer_offer_drafts_natural_key"
  ON "flyer_offer_drafts" ("retailer_market_id", "name", COALESCE("quantity_text", ''));
