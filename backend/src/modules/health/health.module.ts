import { Controller, Get, Inject, Injectable, Module } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import Redis from 'ioredis';
import type { HealthDto } from '../../common/api/schemas';
import { AppException } from '../../common/errors/app-exception';
import { REDIS } from '../../common/redis/redis.tokens';
import { AppConfigService } from '../../config/app-config.service';
import { DATABASE, Database } from '../../database/database.module';

@Injectable()
export class HealthService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly config: AppConfigService,
  ) {}

  /** `ok` only when BOTH critical dependencies answer; otherwise 503 (contract). */
  async check(): Promise<HealthDto> {
    try {
      await this.db.execute(sql`SELECT 1`);
      await this.redis.ping();
    } catch (error) {
      throw new AppException('SERVICE_TEMPORARILY_UNAVAILABLE', {
        dependency: String(error).includes('Redis') ? 'redis' : 'database',
      });
    }
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: this.config.all.version,
    };
  }
}

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  getHealth(): Promise<HealthDto> {
    return this.health.check();
  }
}

@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
