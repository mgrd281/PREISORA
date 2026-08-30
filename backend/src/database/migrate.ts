/**
 * `npm run db:migrate` — applies the SQL migrations in `src/database/migrations`
 * (drizzle-kit format: numbered `.sql` files + `meta/_journal.json`).
 *
 * Standalone by design: it must run before the Nest app can boot.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as path from 'node:path';
import { Pool } from 'pg';
import { buildConfig } from '../config/configuration';

export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: path.join(__dirname, 'migrations') });
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const url = process.argv[2] ?? buildConfig().database.url;
  const redacted = url.replace(/\/\/([^:]+):[^@]*@/, '//$1:***@');
  process.stdout.write(`[migrate] applying migrations to ${redacted}\n`);
  await runMigrations(url);
  process.stdout.write('[migrate] done\n');
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`[migrate] FAILED: ${String(error)}\n`);
    process.exit(1);
  });
}
