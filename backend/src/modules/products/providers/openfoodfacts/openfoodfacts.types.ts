/**
 * The shape of the Open Food Facts `/api/v2/product/{code}.json` response.
 *
 * DELIBERATELY LOOSE. This is a community-edited database: every field is optional,
 * many are blank strings, and image size entries can be missing `w` or `h`. Typing it
 * optimistically would only move the failure from the normalizer (where it is a
 * handled miss) into the request path (where it would be a 5xx).
 *
 * Nothing outside this folder may import these types — that is the whole point of
 * `ProviderProduct` (constitution §22).
 */

/** One rendition's exact pixel box, as OFF records it. Values are unknown by design. */
export interface OffImageSize {
  w?: unknown;
  h?: unknown;
}

export interface OffImage {
  sizes?: Record<string, OffImageSize | null | undefined> | null;
}

export interface OffSelectedImages {
  /** `front.{thumb|small|display}.{languageCode}` -> ready-made URL. */
  front?: Record<string, Record<string, unknown> | null | undefined> | null;
}

export interface OffProduct {
  code?: unknown;
  /** The product's own primary language code, e.g. `de`. */
  lang?: unknown;
  /** Comma-separated brand list, e.g. `"Ferrero"` or `"Ritter Sport, Alfred Ritter"`. */
  brands?: unknown;
  /** Free-text pack size, e.g. `"500g"`. */
  quantity?: unknown;
  images?: Record<string, OffImage | null | undefined> | null;
  selected_images?: OffSelectedImages | null;
  /** `product_name`, `product_name_de`, `product_name_en`, ... are read dynamically. */
  [field: string]: unknown;
}

export interface OffProductResponse {
  /** `1` = found, `0` = not found. */
  status?: unknown;
  status_verbose?: unknown;
  code?: unknown;
  product?: OffProduct | null;
}
