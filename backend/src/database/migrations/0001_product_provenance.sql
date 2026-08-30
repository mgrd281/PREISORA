-- Server-side provenance for catalog rows (constitution §22).
--
-- A product may now be DISCOVERED from an external catalog provider on first scan
-- instead of only being seeded, so every row records where it came from. This is
-- deliberately NOT on the wire: the OpenAPI contract is frozen and `Product` has no
-- `source` field. Exposing it additively is a documented follow-up.
--
-- `'seed'` as the default backfills every existing row correctly: everything that
-- exists before this migration came from `npm run seed`.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'seed' NOT NULL;
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "source_ref" text;
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "source_synced_at" timestamp with time zone;
--> statement-breakpoint
-- Mirrors the `offers_source_check` style: the enum lives in the database, not only
-- in the application layer.
ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_source_check";
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_source_check"
  CHECK ("source" IN ('seed', 'openfoodfacts', 'manual'));
--> statement-breakpoint
-- Lets a provenance sweep ("re-sync everything from OFF older than N days") stay an
-- index scan instead of a table scan.
CREATE INDEX IF NOT EXISTS "products_source_idx" ON "products" ("source", "source_synced_at");
