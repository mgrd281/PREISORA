import type { Config } from 'drizzle-kit';
import { buildConfig } from './src/config/configuration';

/**
 * `npm run db:generate` authors new SQL migrations from the Drizzle schema.
 * Migrations are applied by `npm run db:migrate` (src/database/migrate.ts), which
 * uses drizzle-orm's migrator over the same folder.
 *
 * Note: the checked-in `0000_init.sql` is hand-authored so it can carry
 * `CREATE EXTENSION postgis`, the GIST indexes and the two PARTIAL unique indexes on
 * `offers` — none of which drizzle-kit can express from the TS schema today.
 */
export default {
  schema: './src/database/schema/index.ts',
  out: './src/database/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: buildConfig().database.url },
  verbose: true,
  strict: true,
} satisfies Config;
