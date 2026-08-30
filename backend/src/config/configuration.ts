/**
 * The ONLY place market defaults live (constitution §24).
 *
 * No `'DE'` / `'EUR'` / `'de-DE'` literal may appear anywhere in business logic —
 * services read `config.defaults.*` instead. That is what lets a second market be
 * added without touching ranking, optimizer or context code.
 */

function int(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function str(value: string | undefined, fallback: string): string {
  return value === undefined || value.trim() === '' ? fallback : value;
}

export interface AppConfig {
  env: string;
  isTest: boolean;
  port: number;
  version: string;
  database: { url: string };
  redis: { url: string };
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessTtlSeconds: number;
    refreshTtlDays: number;
  };
  /** Market defaults — the single source of country/currency/locale/timezone. */
  defaults: {
    countryCode: string;
    currencyCode: string;
    locale: string;
    timezone: string;
  };
  pricing: {
    maxPriceAgeHours: number;
    defaultRadiusMeters: number;
    maxRadiusMeters: number;
    geoResultLimit: number;
    gtinCacheTtlSeconds: number;
  };
  featureFlags: { cacheTtlSeconds: number };
  throttle: { ttlSeconds: number; limit: number };
  alerts: { cron: string; retriggerCooldownHours: number };
}

export function buildConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = str(env.NODE_ENV, 'development');
  return {
    env: nodeEnv,
    isTest: nodeEnv === 'test',
    port: int(env.PORT, 3000),
    version: str(env.APP_VERSION, '1.0.0'),
    database: {
      url: str(env.DATABASE_URL, 'postgres://preisora:preisora@localhost:5432/preisora'),
    },
    redis: { url: str(env.REDIS_URL, 'redis://localhost:6379') },
    jwt: {
      accessSecret: str(env.JWT_ACCESS_SECRET, 'dev-only-access-secret-change-me'),
      refreshSecret: str(env.JWT_REFRESH_SECRET, 'dev-only-refresh-secret-change-me'),
      accessTtlSeconds: int(env.JWT_ACCESS_TTL_SECONDS, 900),
      refreshTtlDays: int(env.JWT_REFRESH_TTL_DAYS, 30),
    },
    defaults: {
      countryCode: str(env.DEFAULT_COUNTRY_CODE, 'DE'),
      currencyCode: str(env.DEFAULT_CURRENCY_CODE, 'EUR'),
      locale: str(env.DEFAULT_LOCALE, 'de-DE'),
      timezone: str(env.DEFAULT_TIMEZONE, 'Europe/Berlin'),
    },
    pricing: {
      maxPriceAgeHours: int(env.MAX_PRICE_AGE_HOURS, 72),
      defaultRadiusMeters: int(env.DEFAULT_RADIUS_METERS, 5000),
      maxRadiusMeters: int(env.MAX_RADIUS_METERS, 50000),
      geoResultLimit: int(env.GEO_RESULT_LIMIT, 50),
      gtinCacheTtlSeconds: int(env.GTIN_CACHE_TTL_SECONDS, 60),
    },
    featureFlags: { cacheTtlSeconds: int(env.FEATURE_FLAG_CACHE_TTL_SECONDS, 60) },
    throttle: {
      ttlSeconds: int(env.THROTTLE_TTL_SECONDS, 60),
      limit: int(env.THROTTLE_LIMIT, 300),
    },
    alerts: {
      cron: str(env.ALERT_ENGINE_CRON, '0 */15 * * * *'),
      retriggerCooldownHours: int(env.ALERT_RETRIGGER_COOLDOWN_HOURS, 24),
    },
  };
}

/** Injection token / namespace used by `ConfigService.get<AppConfig>('app')`. */
export const APP_CONFIG_NAMESPACE = 'app';

export default () => ({ [APP_CONFIG_NAMESPACE]: buildConfig() });
