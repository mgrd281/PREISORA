import { Inject, Injectable } from '@nestjs/common';
import type { CapabilitiesDto } from '../../common/api/schemas';
import { RequestContext } from '../../common/context/request-context';
import { RedisCacheService } from '../../common/redis/redis-cache.service';
import { AppConfigService } from '../../config/app-config.service';
import { DATABASE, Database } from '../../database/database.module';
import { FEATURE_KEYS, FeatureKey, featureFlags } from '../../database/schema';
import { FlagContext, FlagRow, resolveFlag } from './flag-resolution';

const CACHE_KEY = 'feature-flags:all';

@Injectable()
export class FeatureFlagsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly cache: RedisCacheService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * The whole (small) flag table behind a 60 s Redis cache — one round trip per
   * minute per instance, and resolution stays in memory.
   */
  private async loadRows(): Promise<FlagRow[]> {
    const cached = await this.cache.get<FlagRow[]>(CACHE_KEY);
    if (cached) return cached;

    const rows = await this.db
      .select({
        flagKey: featureFlags.flagKey,
        countryCode: featureFlags.countryCode,
        platform: featureFlags.platform,
        minAppVersion: featureFlags.minAppVersion,
        cohort: featureFlags.cohort,
        enabled: featureFlags.enabled,
        createdAt: featureFlags.createdAt,
      })
      .from(featureFlags);

    await this.cache.set(CACHE_KEY, rows, this.config.all.featureFlags.cacheTtlSeconds);
    return rows;
  }

  private static toFlagContext(ctx: RequestContext): FlagContext {
    return {
      countryCode: ctx.countryCode,
      platform: ctx.platform,
      appVersion: ctx.appVersion,
      cohort: ctx.cohort,
    };
  }

  async isEnabled(flagKey: FeatureKey, ctx: RequestContext): Promise<boolean> {
    const rows = await this.loadRows();
    return resolveFlag(rows, flagKey, FeatureFlagsService.toFlagContext(ctx));
  }

  /** `GET /capabilities` — the five contract features, resolved for this caller. */
  async resolveCapabilities(ctx: RequestContext): Promise<CapabilitiesDto> {
    const rows = await this.loadRows();
    const flagContext = FeatureFlagsService.toFlagContext(ctx);
    const features = Object.fromEntries(
      FEATURE_KEYS.map((key) => [key, resolveFlag(rows, key, flagContext)]),
    ) as CapabilitiesDto['features'];
    return { features };
  }

  /** Called by the seed so a re-seed is visible without waiting out the TTL. */
  async invalidateCache(): Promise<void> {
    await this.cache.del(CACHE_KEY);
  }
}
