import type { RequestContext } from '../../../common/context/request-context';
import type { ProductSource } from '../../../database/schema';

/**
 * One image rendition as a provider offers it. Identical in shape to the contract's
 * `ImageAsset` on purpose: all three fields are REQUIRED, so a rendition whose URL or
 * pixel dimensions cannot be determined is dropped by the adapter rather than
 * emitted half-filled (constitution §34).
 */
export interface ProviderImage {
  url: string;
  widthPx: number;
  heightPx: number;
}

/**
 * A product as PREISORA understands it, already normalized by the adapter.
 *
 * Platform- AND provider-neutral: no upstream field name, no upstream id shape and no
 * upstream locale convention may leak past the adapter that produced this
 * (constitution §22, "provider normalization" is server-side).
 *
 * Notably absent: prices, offers, retailers, stores. A product provider describes
 * WHAT something is, never what it costs.
 */
export interface ProviderProduct {
  /** The GTIN that was looked up, normalized (leading zeros preserved). */
  gtin: string;
  /** Non-empty. A provider result without a usable name is NOT a result. */
  name: string;
  brand: string | null;
  quantityText: string | null;
  /** `null` — never `[]` — when no rendition could be fully determined. */
  images: ProviderImage[] | null;
  /** Which provider produced this; persisted as `products.source`. */
  source: ProductSource;
  /** The record's identifier at that provider; persisted as `products.source_ref`. */
  sourceRef: string;
}

/**
 * The seam a second catalog provider drops into (constitution §22).
 *
 * Contract for every implementation:
 * - resolve `null` for "the provider has no such product" — never throw for that;
 * - never throw for a network, timeout, HTTP or parse failure either: log at warn
 *   level and resolve `null`. A provider problem is a lookup miss, never a 5xx;
 * - never invent data, and never return a nameless product.
 */
export interface ProductProvider {
  /** Stable identity of the provider, mirrored into `products.source`. */
  readonly source: ProductSource;
  lookupByGtin(gtin: string, ctx: RequestContext): Promise<ProviderProduct | null>;
}

/** DI token. Callers depend on this, never on a concrete provider class. */
export const PRODUCT_PROVIDER = Symbol('PRODUCT_PROVIDER');
