import { Injectable, Logger } from '@nestjs/common';
import type { RequestContext } from '../../../../common/context/request-context';
import { AppConfigService } from '../../../../config/app-config.service';
import type { ProductSource } from '../../../../database/schema';
import type { ProductProvider, ProviderProduct } from '../product-provider.interface';
import { normalizeOffProduct } from './openfoodfacts.normalizer';
import type { OffProductResponse } from './openfoodfacts.types';

/**
 * Only the fields the normalizer reads are requested. OFF documents `fields=` as the
 * way to keep a response small, and a product record is otherwise ~100 kB of
 * nutriments we would parse and throw away on every scan (§35).
 */
const FIELDS = [
  'code',
  'lang',
  'brands',
  'quantity',
  'product_name',
  'images',
  'selected_images',
] as const;

/** Localized name fields are requested per language; this bounds how many we ask for. */
function nameFields(language: string): string[] {
  return [...new Set([language, 'en'].filter((value) => /^[a-z]{2,3}$/.test(value)))].map(
    (value) => `product_name_${value}`,
  );
}

/**
 * Open Food Facts catalog adapter (ODbL data — see backend/README.md for the
 * attribution obligation).
 *
 * Failure policy, per the seam contract: a network error, a timeout, a non-200, an
 * unparseable body or `status: 0` all resolve to `null`. Nothing upstream is ever
 * re-thrown or echoed, so an OFF incident can only ever look like "we do not know this
 * barcode" — never like a PREISORA outage.
 */
@Injectable()
export class OpenFoodFactsProvider implements ProductProvider {
  readonly source: ProductSource = 'openfoodfacts';

  private readonly logger = new Logger(OpenFoodFactsProvider.name);

  constructor(private readonly config: AppConfigService) {}

  async lookupByGtin(gtin: string, ctx: RequestContext): Promise<ProviderProduct | null> {
    const settings = this.config.openFoodFacts;
    const language = ctx.locale.split('-')[0]?.toLowerCase() ?? '';
    const url = new URL(
      `api/v2/product/${encodeURIComponent(gtin)}.json`,
      settings.baseUrl.endsWith('/') ? settings.baseUrl : `${settings.baseUrl}/`,
    );
    url.searchParams.set('fields', [...FIELDS, ...nameFields(language)].join(','));

    let payload: OffProductResponse;
    try {
      const response = await fetch(url, {
        headers: {
          accept: 'application/json',
          // OFF's usage terms ask every client to identify itself.
          'user-agent': settings.userAgent,
        },
        signal: AbortSignal.timeout(settings.timeoutMs),
      });
      if (!response.ok) {
        // Status only — an upstream error body must never reach a client or a log line.
        this.logger.warn(`openfoodfacts lookup ${gtin}: HTTP ${response.status}`);
        return null;
      }
      payload = (await response.json()) as OffProductResponse;
    } catch (error) {
      this.logger.warn(`openfoodfacts lookup ${gtin} failed: ${errorSummary(error)}`);
      return null;
    }

    return normalizeOffProduct(payload, { gtin, locale: ctx.locale, source: this.source });
  }
}

/** Name and message of OUR client error only — an upstream response body never enters a log. */
function errorSummary(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return 'unknown error';
}
