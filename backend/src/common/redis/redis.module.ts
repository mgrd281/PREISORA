import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfigService } from '../../config/app-config.service';

export const REDIS = Symbol('PREISORA_REDIS');

/**
 * Redis is load-bearing in three places (ADR-0001):
 *  1. @nestjs/throttler storage — makes `RATE_LIMITED` a real, shared-state answer;
 *  2. the 60 s feature-flag cache;
 *  3. the short-TTL read-through cache on `GET /products/by-gtin/{gtin}`.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) =>
        new Redis(config.all.redis.url, {
          maxRetriesPerRequest: 2,
          lazyConnect: false,
          enableOfflineQueue: true,
        }),
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    this.redis.disconnect();
  }
}
