import { Inject, Injectable } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import Redis from 'ioredis';
import { REDIS } from '../redis/redis.tokens';

/**
 * Redis-backed throttler storage — this is what makes `RATE_LIMITED` a real answer
 * rather than a per-process approximation (ADR-0001: "Redis is load-bearing").
 *
 * One Lua script per hit keeps the counter, its TTL and the block flag atomic, so
 * concurrent requests cannot slip past the limit between INCR and EXPIRE.
 */
const HIT_SCRIPT = `
local hitsKey = KEYS[1]
local blockKey = KEYS[2]
local ttlMs = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local blockMs = tonumber(ARGV[3])

local blockTtl = redis.call('PTTL', blockKey)
if blockTtl > 0 then
  local blockedHits = tonumber(redis.call('GET', hitsKey) or limit + 1)
  return { blockedHits, blockTtl, 1, blockTtl }
end

local hits = redis.call('INCR', hitsKey)
if hits == 1 then
  redis.call('PEXPIRE', hitsKey, ttlMs)
end
local remainingTtl = redis.call('PTTL', hitsKey)
if remainingTtl < 0 then
  redis.call('PEXPIRE', hitsKey, ttlMs)
  remainingTtl = ttlMs
end

if hits > limit then
  redis.call('SET', blockKey, '1', 'PX', blockMs)
  return { hits, remainingTtl, 1, blockMs }
end

return { hits, remainingTtl, 0, 0 }
`;

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const hitsKey = `throttle:${throttlerName}:${key}`;
    const blockKey = `throttle-block:${throttlerName}:${key}`;
    const effectiveBlockMs = blockDuration > 0 ? blockDuration : ttl;

    const result = (await this.redis.eval(
      HIT_SCRIPT,
      2,
      hitsKey,
      blockKey,
      String(ttl),
      String(limit),
      String(effectiveBlockMs),
    )) as [number, number, number, number];

    const [totalHits, timeToExpireMs, isBlocked, timeToBlockExpireMs] = result;
    return {
      totalHits,
      timeToExpire: Math.ceil(timeToExpireMs / 1000),
      isBlocked: isBlocked === 1,
      timeToBlockExpire: Math.ceil(timeToBlockExpireMs / 1000),
    };
  }
}
