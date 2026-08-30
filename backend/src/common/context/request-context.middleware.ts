import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { NextFunction, Request, Response } from 'express';
import { AppConfigService } from '../../config/app-config.service';
import { DATABASE, Database } from '../../database/database.module';
import { users } from '../../database/schema';
import { TokenService } from '../../modules/auth/token.service';
import { REQUEST_CONTEXT_KEY, RequestContext } from './request-context';

const LOCALE_PATTERN = /^[a-z]{2}(-[A-Z]{2})?$/;

/**
 * Parses an `Accept-Language` header and returns the highest-q tag that looks like a
 * BCP-47 locale the contract accepts, or `null`.
 */
export function pickLocale(headerValue: string | undefined): string | null {
  if (!headerValue) return null;
  const candidates = headerValue
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params
        .map((p) => p.trim())
        .filter((p) => p.startsWith('q='))
        .map((p) => Number.parseFloat(p.slice(2)))
        .find((n) => Number.isFinite(n));
      return { tag: tag.trim(), q: q ?? 1 };
    })
    .filter((c) => c.tag !== '' && c.tag !== '*')
    .sort((a, b) => b.q - a.q);

  for (const candidate of candidates) {
    const [language, region] = candidate.tag.split('-');
    if (!/^[A-Za-z]{2}$/.test(language)) continue;
    const normalized =
      region && /^[A-Za-z]{2}$/.test(region)
        ? `${language.toLowerCase()}-${region.toUpperCase()}`
        : language.toLowerCase();
    if (LOCALE_PATTERN.test(normalized)) return normalized;
  }
  return null;
}

/** Region subtag of a locale (`de-DE` -> `DE`), or `null` for a language-only tag. */
export function regionOf(locale: string): string | null {
  const [, region] = locale.split('-');
  return region ? region.toUpperCase() : null;
}

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(
    private readonly config: AppConfigService,
    private readonly tokens: TokenService,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const defaults = this.config.defaults;

    const queryLocale = typeof req.query.locale === 'string' ? req.query.locale : undefined;
    const headerLocale = pickLocale(req.header('accept-language'));

    let userId: string | null = null;
    let cohort: string | null = null;
    let profileLocale: string | null = null;
    let profileCountry: string | null = null;

    // Best-effort identity resolution: an invalid token never fails the request here,
    // it simply leaves the context anonymous. Guards are what reject unauthorized calls.
    const claims = this.tokens.tryVerifyAccessToken(req.header('authorization'));
    if (claims) {
      const [row] = await this.db
        .select({
          id: users.id,
          locale: users.locale,
          countryCode: users.countryCode,
          cohort: users.cohort,
        })
        .from(users)
        .where(eq(users.id, claims.sub))
        .limit(1);
      if (row) {
        userId = row.id;
        cohort = row.cohort;
        profileLocale = row.locale;
        profileCountry = row.countryCode;
      }
    }

    // Precedence, CONVENTIONS.md: ?locale > user profile > Accept-Language > default.
    const locale =
      (queryLocale && LOCALE_PATTERN.test(queryLocale) ? queryLocale : null) ??
      profileLocale ??
      headerLocale ??
      defaults.locale;

    // Country mirrors the same precedence, falling back to the locale's region.
    const countryCode = profileCountry ?? regionOf(locale) ?? defaults.countryCode;

    const platformHeader = req.header('x-app-platform');
    const platform =
      platformHeader === 'ios' || platformHeader === 'android' ? platformHeader : null;

    const context: RequestContext = {
      countryCode,
      // v1 serves one currency per market; offers always carry their market's own
      // currency, so this is only the default for user-scoped writes.
      currencyCode: defaults.currencyCode,
      locale,
      timezone: defaults.timezone,
      platform,
      appVersion: req.header('x-app-version') ?? null,
      userId,
      cohort,
    };

    (req as Request & Record<string, unknown>)[REQUEST_CONTEXT_KEY] = context;
    res.setHeader('Content-Language', locale);
    next();
  }
}
