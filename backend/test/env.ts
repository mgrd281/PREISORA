/**
 * Runs in every jest worker BEFORE any module is imported.
 *
 * The e2e suite must never touch the development database OR its Redis keyspace, so
 * both are redirected here rather than relying on the shell. The Redis part is not
 * cosmetic: the GTIN read-through cache would otherwise hand the suite product ids
 * from a previous run's (now dropped) database.
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://preisora:preisora@localhost:5432/preisora_test';
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1';
// The throttler stays REAL (Redis-backed); the window is just wide enough that the
// suite's own request volume never trips it.
process.env.THROTTLE_LIMIT = process.env.THROTTLE_LIMIT ?? '100000';
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? 'e2e-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? 'e2e-refresh-secret';

export {};
