/**
 * Canonical `products.slug` derivation (glossary: "Product ... canonical `slug`").
 *
 * Server-side and deterministic: the same brand/name/quantity/GTIN always produce the
 * same candidate list, so a re-run of a discovery converges instead of drifting.
 */

/** Transliterations that must happen BEFORE diacritics are stripped. */
const TRANSLITERATIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/ä/g, 'ae'],
  [/ö/g, 'oe'],
  [/ü/g, 'ue'],
  [/ß/g, 'ss'],
  [/æ/g, 'ae'],
  [/ø/g, 'oe'],
  [/å/g, 'aa'],
  [/đ/g, 'd'],
  [/ł/g, 'l'],
  [/&/g, ' and '],
];

const MAX_SLUG_LENGTH = 80;

/**
 * URL-safe, ASCII-only slug fragment. Not market-specific: the transliteration table
 * covers the Latin scripts of the roadmap markets (§24) and anything it does not know
 * is decomposed and stripped rather than being encoded.
 */
export function slugify(value: string): string {
  let text = value.toLowerCase();
  for (const [pattern, replacement] of TRANSLITERATIONS) text = text.replace(pattern, replacement);
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '');
}

/**
 * The slug candidates for a discovered product, most desirable first.
 *
 * `products_slug_key` is UNIQUE, and two different GTINs can legitimately normalize to
 * the same brand+name+quantity (regional variants, multipacks). The caller walks this
 * list until an insert succeeds, so a collision costs one extra round trip and NEVER a
 * 500. The last candidate embeds the full GTIN and is therefore collision-free by
 * construction — a GTIN is unique in `products` already.
 */
export function buildSlugCandidates(input: {
  brand: string | null;
  name: string;
  quantityText: string | null;
  gtin: string;
}): string[] {
  const base = slugify([input.brand, input.name, input.quantityText].filter(Boolean).join(' '));
  const short = input.gtin.slice(-6);
  const candidates = base === '' ? [] : [base, `${base}-${short}`, `${base}-${input.gtin}`];
  candidates.push(`product-${input.gtin}`);
  return [...new Set(candidates)];
}
