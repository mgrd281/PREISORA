/**
 * Open Food Facts client for the IMPORT pipeline (search + full-record lookup).
 *
 * Kept separate from the request-path `OpenFoodFactsProvider` on purpose: this one
 * runs in a batch CLI, is allowed to be slow, and must be an aggressively polite
 * citizen — OFF's search API is rate-limited to ~10 req/min, so calls are spaced
 * `minIntervalMs` apart and every 429/5xx is retried with a backoff instead of
 * hammering. It reuses the provider's normalizer, so OFF vocabulary still exists
 * only inside provider/import adapter code (§22).
 */
import { normalizeOffProduct } from '../modules/products/providers/openfoodfacts/openfoodfacts.normalizer';
import type { ProviderProduct } from '../modules/products/providers/product-provider.interface';
import type { OffProductResponse } from '../modules/products/providers/openfoodfacts/openfoodfacts.types';
import type { SearchCandidate } from './matcher';

export interface OffSearchClientOptions {
  baseUrl: string;
  /** Descriptive UA, per OFF usage terms (e.g. `PREISORA-dev/0.1`). */
  userAgent: string;
  /** Minimum spacing between ANY two requests this client makes. */
  minIntervalMs: number;
  timeoutMs: number;
  maxAttempts: number;
  /** Backoff after a 429/5xx before the next attempt. */
  retryDelayMs: number;
  log?: (line: string) => void;
}

interface OffSearchResponse {
  count?: number;
  products?: SearchCandidate[];
}

const SEARCH_FIELDS = 'code,product_name,brands,quantity,countries_tags';
const PRODUCT_FIELDS =
  'code,lang,brands,quantity,product_name,images,selected_images,product_name_de,product_name_en';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class OffSearchClient {
  private lastRequestAt = 0;

  constructor(private readonly options: OffSearchClientOptions) {}

  /** `cgi/search.pl` free-text search, first page only. `[]` on persistent failure. */
  async search(terms: string): Promise<SearchCandidate[]> {
    const url = new URL('cgi/search.pl', this.base());
    url.searchParams.set('search_terms', terms);
    url.searchParams.set('json', '1');
    url.searchParams.set('page_size', '10');
    url.searchParams.set('fields', SEARCH_FIELDS);
    const payload = await this.request<OffSearchResponse>(url, `search "${terms}"`);
    return payload?.products ?? [];
  }

  /**
   * Full product record via the (more lenient) `api/v2` GET, normalized through the
   * SAME pure normalizer the scan-path provider uses. `null` on any failure — the
   * caller then builds a leaner product from the search hit instead.
   */
  async lookupProduct(gtin: string, locale: string): Promise<ProviderProduct | null> {
    const url = new URL(`api/v2/product/${encodeURIComponent(gtin)}.json`, this.base());
    url.searchParams.set('fields', PRODUCT_FIELDS);
    const payload = await this.request<OffProductResponse>(url, `product ${gtin}`);
    return normalizeOffProduct(payload, { gtin, locale, source: 'openfoodfacts' });
  }

  private base(): string {
    const { baseUrl } = this.options;
    return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  }

  private async request<T>(url: URL, label: string): Promise<T | null> {
    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt += 1) {
      await this.throttle();
      try {
        const response = await fetch(url, {
          headers: { accept: 'application/json', 'user-agent': this.options.userAgent },
          signal: AbortSignal.timeout(this.options.timeoutMs),
        });
        if (response.ok) return (await response.json()) as T;
        // Status only, never an upstream body, into our logs.
        this.log(`openfoodfacts ${label}: HTTP ${response.status} (attempt ${attempt}/${this.options.maxAttempts})`);
        if (response.status < 500 && response.status !== 429) return null;
      } catch (error) {
        this.log(
          `openfoodfacts ${label} failed (attempt ${attempt}/${this.options.maxAttempts}): ${
            error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error'
          }`,
        );
      }
      if (attempt < this.options.maxAttempts) await sleep(this.options.retryDelayMs * attempt);
    }
    return null;
  }

  /** Enforces `minIntervalMs` between requests — the politeness contract. */
  private async throttle(): Promise<void> {
    const wait = this.lastRequestAt + this.options.minIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastRequestAt = Date.now();
  }

  private log(line: string): void {
    (this.options.log ?? ((text: string) => process.stderr.write(`${text}\n`)))(line);
  }
}
