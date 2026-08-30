/**
 * Flyer-offer → catalog-product matching (constitution §22: product matching is
 * SERVER intelligence, and this module is where it lives for flyer imports).
 *
 * THE SAFETY RULE: a price is attached to a product ONLY on a confident match —
 * brand AND pack size must both verify. Everything else becomes a review-queue
 * draft. A missing offer is a gap; a wrong price on a scan kills the product's
 * credibility, so the matcher is built to say "not sure" often and "yes" rarely.
 */
import { isValidGtinChecksum, normalizeGtin } from '../common/gtin/gtin';
import { quantitiesEqual } from './quantity';

/** One search hit as the catalog search API returns it (already provider-shaped). */
export interface SearchCandidate {
  code: string;
  product_name?: string;
  brands?: string;
  quantity?: string;
  countries_tags?: string[];
}

/** The flyer facts the matcher decides on. */
export interface MatchInput {
  name: string;
  brand?: string | null;
  quantityText?: string | null;
  /** Country the batch belongs to; used only as a BONUS signal, never required. */
  countryCode: string;
}

/**
 * Matching thresholds and rules — deliberately constants, not configuration
 * (documented here, tested in matcher.spec.ts; env sprawl would only invite
 * loosening them ad hoc):
 *
 * - BRAND: case-/whitespace-/diacritic-insensitive containment between the flyer
 *   brand and ANY entry of the candidate's comma-separated brand list. Required.
 * - QUANTITY: exact equality after unit normalization (130 g == 130g,
 *   1,5 l == 1500 ml). Required. Unparseable on either side = no match.
 * - AMBIGUITY: more than one distinct GTIN surviving both gates = NO match
 *   (`ambiguous_gtins`). Multiple size variants with none matching =
 *   `quantity_mismatch`. The country bonus signal is applied first: when exactly
 *   one survivor lists the batch country, it wins the tie.
 * - GTIN: a candidate whose code fails the GS1 checksum is discarded outright.
 */
export const MATCH_RULES = {
  brandRequired: true,
  quantityRequired: true,
  maxDistinctGtins: 1,
} as const;

export type MatchDecision =
  | { status: 'matched'; gtin: string; candidate: SearchCandidate; reason: string }
  | { status: 'unmatched'; reason: UnmatchedReason; detail: string };

export type UnmatchedReason =
  | 'no_brand' // flyer row has no brand → the brand gate can never pass
  | 'no_result' // search returned nothing usable at all
  | 'brand_mismatch' // results exist, none carries the flyer's brand
  | 'quantity_mismatch' // brand matches exist, but no size agrees (e.g. 22g/44g/220g vs 132g)
  | 'ambiguous_gtins' // >1 distinct GTIN passes every gate — refusing to guess
  | 'invalid_gtin' // a pre-resolved GTIN in the import row failed its checksum
  | 'search_failed'; // the catalog search was unavailable after every retry

/** Lowercase, strip diacritics, collapse every non-alphanumeric run to one space. */
export function normalizeBrandText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Brand gate: containment in either direction against each entry of the
 * candidate's brand list ("Rio d'Oro, riha WeserGold" → two entries). Containment,
 * not equality, because flyers print "funny-frisch" where catalogs may say
 * "Funny Frisch" or "funny-frisch Chips".
 */
export function brandMatches(flyerBrand: string, candidateBrands: string | undefined): boolean {
  const wanted = normalizeBrandText(flyerBrand);
  if (wanted === '' || !candidateBrands) return false;
  return candidateBrands.split(',').some((entry) => {
    const have = normalizeBrandText(entry);
    return have !== '' && (have.includes(wanted) || wanted.includes(have));
  });
}

/**
 * The decision. Pure and synchronous — every I/O concern (search, throttling,
 * retries) lives in the client, so this logic is unit-testable against recorded
 * payloads.
 */
export function decideMatch(input: MatchInput, candidates: SearchCandidate[]): MatchDecision {
  const flyerBrand = input.brand?.trim() ?? '';
  if (flyerBrand === '') {
    return {
      status: 'unmatched',
      reason: 'no_brand',
      detail: 'flyer row carries no brand; the brand gate can never be satisfied',
    };
  }

  const usable = candidates.filter((candidate) => isValidGtinChecksum(normalizeGtin(candidate.code ?? '')));
  if (usable.length === 0) {
    return { status: 'unmatched', reason: 'no_result', detail: 'search returned no usable candidate' };
  }

  const brandMatched = usable.filter((candidate) => brandMatches(flyerBrand, candidate.brands));
  if (brandMatched.length === 0) {
    return {
      status: 'unmatched',
      reason: 'brand_mismatch',
      detail: `no candidate carries brand "${flyerBrand}"`,
    };
  }

  const confident = brandMatched.filter((candidate) =>
    quantitiesEqual(input.quantityText, candidate.quantity),
  );
  if (confident.length === 0) {
    const sizes = [...new Set(brandMatched.map((c) => c.quantity ?? '?'))].join(', ');
    return {
      status: 'unmatched',
      reason: 'quantity_mismatch',
      detail: `brand matches exist but no pack size equals "${input.quantityText ?? '?'}" (seen: ${sizes})`,
    };
  }

  let survivors = dedupeByGtin(confident);
  if (survivors.length > MATCH_RULES.maxDistinctGtins) {
    // Bonus signal, applied only as a tiebreaker: the batch country listed in
    // countries_tags. It never REJECTS anything on its own.
    const countryTag = `en:${countryName(input.countryCode)}`;
    const inCountry = survivors.filter((c) => (c.countries_tags ?? []).includes(countryTag));
    if (inCountry.length === 1) survivors = inCountry;
  }

  if (survivors.length > MATCH_RULES.maxDistinctGtins) {
    const gtins = survivors.map((c) => c.code).join(', ');
    return {
      status: 'unmatched',
      reason: 'ambiguous_gtins',
      detail: `${survivors.length} distinct GTINs pass every gate (${gtins}); refusing to guess`,
    };
  }

  const winner = survivors[0];
  return {
    status: 'matched',
    gtin: normalizeGtin(winner.code),
    candidate: winner,
    reason: `brand "${flyerBrand}" and quantity "${input.quantityText}" verified against ${winner.code}`,
  };
}

function dedupeByGtin(candidates: SearchCandidate[]): SearchCandidate[] {
  const byGtin = new Map<string, SearchCandidate>();
  for (const candidate of candidates) {
    const gtin = normalizeGtin(candidate.code);
    if (!byGtin.has(gtin)) byGtin.set(gtin, candidate);
  }
  return [...byGtin.values()];
}

/**
 * ISO 3166 alpha-2 → the English country word used by catalog country tags.
 * Only the markets of the roadmap (§24) are listed; an unknown code simply
 * disables the bonus signal — it can never break a match.
 */
const COUNTRY_TAG_NAMES: Record<string, string> = {
  DE: 'germany',
  AT: 'austria',
  CH: 'switzerland',
  NL: 'netherlands',
  FR: 'france',
};

function countryName(countryCode: string): string {
  return COUNTRY_TAG_NAMES[countryCode.toUpperCase()] ?? '';
}
