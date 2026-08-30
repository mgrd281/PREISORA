import type { ProviderImage, ProviderProduct } from '../product-provider.interface';
import type { OffImageSize, OffProduct, OffProductResponse } from './openfoodfacts.types';

/**
 * OFF -> PREISORA. A pure function, unit-tested against recorded payloads.
 *
 * This file is the ONLY place Open Food Facts vocabulary exists. Everything it hands
 * back is `ProviderProduct` (constitution §22).
 */

/**
 * `selected_images.front.<key>` -> the matching entry in `images.front_<lang>.sizes`.
 *
 * Verified empirically against live payloads: the `thumb`/`small`/`display` URLs end in
 * `.100.jpg` / `.200.jpg` / `.400.jpg`, and `sizes["100"|"200"|"400"]` carry the exact
 * `w`/`h` of exactly those files (the boxes are NOT square — Nutella's `front_de` 400
 * rendition is 269x400 — which is precisely why the dimensions must be read and never
 * assumed).
 */
const RENDITIONS: ReadonlyArray<readonly [selectedKey: string, sizeKey: string]> = [
  ['thumb', '100'],
  ['small', '200'],
  ['display', '400'],
];

/**
 * `.../front_de.253.400.jpg` -> `.../front_de.253.full.jpg`.
 *
 * OFF publishes no ready-made URL for the original, only its exact dimensions under
 * `sizes.full`. The size token is the last dot-segment before the extension, so the
 * full-resolution URL is derived by substitution — never by string concatenation of a
 * guessed path. Verified to resolve (HTTP 200) before being relied on; when the display
 * URL does not match this shape the rendition is simply skipped.
 */
const SIZED_IMAGE_URL = /^(.*\.\d+\.)\d+(\.[A-Za-z0-9]+)$/;

const FRONT_PREFIX = 'front_';

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function pixels(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/** Language subtag of a BCP-47 locale (`de-DE` -> `de`), lowercased. */
export function languageOf(locale: string): string {
  return (locale.split('-')[0] ?? '').toLowerCase();
}

/**
 * Name selection, in the order the request asked for it:
 * 1. `product_name_{requested language}` — the locale the client is being served in;
 * 2. `product_name` — OFF's generic name;
 * 3. `product_name_{product's own language}`.
 *
 * Blank strings count as absent (OFF stores `""` for "not translated"). `null` here
 * means NOT FOUND — a nameless product is never persisted.
 */
export function pickName(product: OffProduct, language: string): string | null {
  const productLanguage = text(product.lang)?.toLowerCase();
  const candidates = [
    language === '' ? null : product[`product_name_${language}`],
    product.product_name,
    productLanguage ? product[`product_name_${productLanguage}`] : null,
  ];
  for (const candidate of candidates) {
    const value = text(candidate);
    if (value !== null) return value;
  }
  return null;
}

/** First entry of the comma-separated `brands` list, trimmed. `null` when absent. */
export function pickBrand(product: OffProduct): string | null {
  const brands = text(product.brands);
  if (brands === null) return null;
  for (const part of brands.split(',')) {
    const value = text(part);
    if (value !== null) return value;
  }
  return null;
}

function sizesFor(product: OffProduct, language: string): Record<string, OffImageSize | null> {
  const image = product.images?.[`${FRONT_PREFIX}${language}`];
  const sizes = image?.sizes;
  return sizes && typeof sizes === 'object' ? (sizes as Record<string, OffImageSize | null>) : {};
}

function urlFor(product: OffProduct, selectedKey: string, language: string): string | null {
  return text(product.selected_images?.front?.[selectedKey]?.[language]);
}

function asset(url: string | null, size: OffImageSize | null | undefined): ProviderImage | null {
  if (url === null) return null;
  const widthPx = pixels(size?.w);
  const heightPx = pixels(size?.h);
  // The contract requires url + widthPx + heightPx on EVERY ImageAsset; a rendition we
  // cannot fully describe is dropped rather than emitted half-filled (§34).
  if (widthPx === null || heightPx === null) return null;
  return { url, widthPx, heightPx };
}

/** Renditions of the front image in ONE language; empty when none is fully describable. */
function frontImagesForLanguage(product: OffProduct, language: string): ProviderImage[] {
  const sizes = sizesFor(product, language);
  const images: ProviderImage[] = [];

  for (const [selectedKey, sizeKey] of RENDITIONS) {
    const image = asset(urlFor(product, selectedKey, language), sizes[sizeKey]);
    if (image) images.push(image);
  }

  const displayUrl = urlFor(product, 'display', language);
  const fullMatch = displayUrl?.match(SIZED_IMAGE_URL);
  if (fullMatch) {
    const full = asset(`${fullMatch[1]}full${fullMatch[2]}`, sizes.full);
    if (full) images.push(full);
  }

  // A product whose renditions all point at one file (OFF stores tiny originals
  // unscaled) must not yield the same URL three times.
  const seen = new Set<string>();
  return images.filter((image) => {
    if (seen.has(image.url)) return false;
    seen.add(image.url);
    return true;
  });
}

/**
 * Front-image languages to try, best first: the request's language, then the product's
 * own, then every other front image OFF has, in a stable order.
 *
 * A German scan of a product photographed only in Czech should still get a picture —
 * the packaging is the same object, only the label language differs.
 */
function imageLanguageCandidates(product: OffProduct, language: string): string[] {
  const available = Object.keys(product.images ?? {})
    .filter((key) => key.startsWith(FRONT_PREFIX))
    .map((key) => key.slice(FRONT_PREFIX.length))
    .filter((value) => value !== '')
    .sort();
  const productLanguage = text(product.lang)?.toLowerCase();
  return [...new Set([language, productLanguage ?? '', ...available].filter((v) => v !== ''))];
}

/** `null` — never `[]` — when nothing could be fully determined (contract nullability). */
export function pickImages(product: OffProduct, language: string): ProviderImage[] | null {
  for (const candidate of imageLanguageCandidates(product, language)) {
    const images = frontImagesForLanguage(product, candidate);
    if (images.length > 0) return images;
  }
  return null;
}

/**
 * The adapter's whole job. Returns `null` for every flavour of "no usable product":
 * `status: 0`, a missing `product`, or a product without a usable name. The caller
 * treats all of them identically as a lookup miss.
 */
export function normalizeOffProduct(
  payload: OffProductResponse | null | undefined,
  input: { gtin: string; locale: string; source: ProviderProduct['source'] },
): ProviderProduct | null {
  if (!payload || Number(payload.status) !== 1) return null;
  const product = payload.product;
  if (!product || typeof product !== 'object') return null;

  const language = languageOf(input.locale);
  const name = pickName(product, language);
  if (name === null) return null;

  return {
    gtin: input.gtin,
    name,
    brand: pickBrand(product),
    quantityText: text(product.quantity),
    images: pickImages(product, language),
    source: input.source,
    // OFF's own `code` when present, so provenance points at the upstream record and
    // not merely at what we happened to ask for.
    sourceRef: text(product.code) ?? text(payload.code) ?? input.gtin,
  };
}
