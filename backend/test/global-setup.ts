/**
 * Jest globalSetup for the e2e suite.
 *
 * Creates a FRESH `preisora_test` database, migrates it, seeds it, and flushes the
 * test Redis database. Both halves matter: recreating Postgres without clearing the
 * GTIN/feature-flag caches would leave the suite reading ids that no longer exist.
 */
import Redis from 'ioredis';
import { Client } from 'pg';
import { runMigrations } from '../src/database/migrate';
import { seedDatabase } from '../src/seed/seed';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://preisora:preisora@localhost:5432/preisora_test';
/** A dedicated Redis logical database, so a flush never touches development data. */
const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1';

function adminUrl(url: string): { adminUrl: string; databaseName: string } {
  const parsed = new URL(url);
  const databaseName = parsed.pathname.replace(/^\//, '');
  parsed.pathname = '/postgres';
  return { adminUrl: parsed.toString(), databaseName };
}

export default async function globalSetup(): Promise<void> {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.REDIS_URL = TEST_REDIS_URL;

  const { adminUrl: admin, databaseName } = adminUrl(TEST_DATABASE_URL);
  const client = new Client({ connectionString: admin });
  await client.connect();
  try {
    // FORCE terminates leftover connections from an interrupted previous run.
    await client.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await client.query(`CREATE DATABASE "${databaseName}"`);
  } finally {
    await client.end();
  }

  await runMigrations(TEST_DATABASE_URL);
  await seedDatabase(TEST_DATABASE_URL);

  const redis = new Redis(TEST_REDIS_URL);
  try {
    await redis.flushdb();
  } finally {
    redis.disconnect();
  }

  process.stdout.write(
    `[e2e] ${databaseName} recreated, migrated and seeded; test Redis db flushed\n`,
  );
}
