import { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import { API, createTestApp, expectErrorEnvelope, http } from './helpers';

const LIMIT = 5;

/**
 * `RATE_LIMITED` is a REAL answer, not a documented-but-dead code path: the throttler
 * counts through the Redis storage in `src/common/throttler/`. This spec boots the app
 * with a deliberately tiny window and drives it past the limit.
 */
describe('rate limiting (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // Read by ConfigModule when the app graph is built below.
    process.env.THROTTLE_LIMIT = String(LIMIT);
    process.env.THROTTLE_TTL_SECONDS = '5';
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    // Leave no blocked-IP state behind for the other e2e files.
    const redis = new Redis(process.env.REDIS_URL as string);
    const keys = await redis.keys('throttle*');
    if (keys.length > 0) await redis.del(...keys);
    redis.disconnect();

    delete process.env.THROTTLE_LIMIT;
    delete process.env.THROTTLE_TTL_SECONDS;
  });

  it('answers 429 RATE_LIMITED with the contract RateLimit-* headers once the window is exhausted', async () => {
    let limited: { status: number; body: unknown; headers: Record<string, string> } | null = null;

    for (let i = 0; i < LIMIT + 3; i += 1) {
      const response = await http(app).get(`${API}/health`);
      if (response.status === 429) {
        limited = response as never;
        break;
      }
      expect(response.status).toBe(200);
    }

    expect(limited).not.toBeNull();
    expectErrorEnvelope(limited!.body, 'RATE_LIMITED');
    expect((limited!.body as { retryable: boolean }).retryable).toBe(true);
    expect(limited!.headers['ratelimit-limit']).toBe(String(LIMIT));
    expect(limited!.headers['ratelimit-remaining']).toBe('0');
    expect(Number(limited!.headers['ratelimit-reset'])).toBeGreaterThan(0);
  });
});
