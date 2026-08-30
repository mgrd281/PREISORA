/**
 * The price-intelligence core (constitution §22): freshness, validity, promotion
 * adjustment, the market-wide vs store-specific override, and best-offer selection.
 *
 * Deliberately a PURE module — no Nest, no database — because this is the single
 * likeliest place for a correctness bug (plan "Known risks") and it must be
 * exhaustively unit-testable. `PriceRankingService` only feeds it rows.
 */
import type { PromotionType } from '../../database/schema';
import type { StoreRow } from '../retailers/store.mapper';

export type Freshness = 'fresh' | 'aging' | 'stale';

export interface PromotionInput {
  id: string;
  type: PromotionType;
  percentOff: number | null;
  amountOffMinor: number | null;
  amountOffCurrencyCode: string | null;
  requiresLoyaltyCard: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
}

export interface OfferCandidate {
  id: string;
  productId: string;
  retailerMarketId: string;
  /** `null` = market-wide uniform price applying to every store of the market. */
  storeId: string | null;
  priceAmountMinor: number;
  currencyCode: string;
  observedAt: Date;
  validFrom: Date | null;
  validUntil: Date | null;
  promotion: PromotionInput | null;
  /** The offer's store, already distance-annotated; `null` for market-wide offers. */
  store: StoreRow | null;
  /** Pack size in base units; `null` disables unit pricing. */
  unitPriceDivisor: number | null;
  unitPriceQuantityText: string | null;
}

export interface RankedOffer extends OfferCandidate {
  freshness: Freshness;
  /** Promotion-adjusted price actually paid, in minor units. */
  effectiveAmountMinor: number;
  /** The promotion only if it is in its validity window right now; else `null`. */
  activePromotion: PromotionInput | null;
  unitPriceAmountMinor: number | null;
  distanceMeters: number | null;
  isBest: boolean;
}

export interface RankingOptions {
  now: Date;
  /** `MAX_PRICE_AGE_HOURS` from configuration — never a literal. */
  maxPriceAgeHours: number;
  /**
   * marketId -> ids of that market's stores INSIDE the query radius. Required to
   * decide whether a market-wide offer still has any store left to apply to.
   */
  storeIdsInRadiusByMarket: Map<string, string[]>;
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * `fresh` inside the configured window, `aging` up to twice the window, `stale`
 * beyond. Only `fresh` offers can be `isBest` or prevent `NO_CURRENT_PRICES`;
 * `stale` offers are dropped from the response entirely.
 */
export function classifyFreshness(observedAt: Date, now: Date, maxPriceAgeHours: number): Freshness {
  const ageHours = (now.getTime() - observedAt.getTime()) / HOUR_MS;
  if (ageHours <= maxPriceAgeHours) return 'fresh';
  if (ageHours <= maxPriceAgeHours * 2) return 'aging';
  return 'stale';
}

/** An offer whose advertised validity window does not cover `now` is not on sale. */
export function isWithinValidity(candidate: OfferCandidate, now: Date): boolean {
  if (candidate.validFrom && candidate.validFrom.getTime() > now.getTime()) return false;
  if (candidate.validUntil && candidate.validUntil.getTime() < now.getTime()) return false;
  return true;
}

function isPromotionActive(promotion: PromotionInput, now: Date): boolean {
  if (promotion.startsAt && promotion.startsAt.getTime() > now.getTime()) return false;
  if (promotion.endsAt && promotion.endsAt.getTime() < now.getTime()) return false;
  return true;
}

/**
 * Phase 1 evaluates `percentage` and `absolute` only. `multibuy` and `loyalty` are
 * stored and surfaced but leave `effectivePrice` at the shelf price — the contract
 * says so explicitly, so this is conformance, not a shortcut.
 */
export function applyPromotion(
  priceAmountMinor: number,
  currencyCode: string,
  promotion: PromotionInput | null,
  now: Date,
): { effectiveAmountMinor: number; activePromotion: PromotionInput | null } {
  if (!promotion || !isPromotionActive(promotion, now)) {
    return { effectiveAmountMinor: priceAmountMinor, activePromotion: null };
  }

  if (promotion.type === 'percentage' && promotion.percentOff !== null) {
    const percent = Math.min(100, Math.max(0, promotion.percentOff));
    const effective = Math.round((priceAmountMinor * (100 - percent)) / 100);
    return { effectiveAmountMinor: Math.max(0, effective), activePromotion: promotion };
  }

  if (
    promotion.type === 'absolute' &&
    promotion.amountOffMinor !== null &&
    // Never subtract across currencies.
    (promotion.amountOffCurrencyCode === null ||
      promotion.amountOffCurrencyCode.trim() === currencyCode.trim())
  ) {
    return {
      effectiveAmountMinor: Math.max(0, priceAmountMinor - promotion.amountOffMinor),
      activePromotion: promotion,
    };
  }

  return { effectiveAmountMinor: priceAmountMinor, activePromotion: promotion };
}

function unitPrice(candidate: OfferCandidate): number | null {
  if (candidate.unitPriceDivisor === null || candidate.unitPriceDivisor <= 0) return null;
  // Normalizes the LISTED shelf price, matching how `price` sits next to it on the
  // wire. Documented in README ("unit price").
  return Math.round(candidate.priceAmountMinor / candidate.unitPriceDivisor);
}

/**
 * Applies the market-wide vs store-specific override.
 *
 * The rule the contract states is per-store: "a store-specific offer overrides a
 * market-wide one for that store". Since market-wide offers are rendered as ONE row
 * (`storeId: null`) rather than expanded per store, the equivalent test is coverage:
 * a market-wide offer survives only while at least one of its market's in-radius
 * stores has no store-specific offer of its own. A market with no store in radius at
 * all is unreachable, so its market-wide price is dropped too.
 *
 * Callers must pass stale-free candidates: a store whose only store-specific offers
 * are stale (and thus dropped from the response) must not veto its market's
 * market-wide price.
 */
function suppressCoveredMarketWideOffers(
  candidates: OfferCandidate[],
  storeIdsInRadiusByMarket: Map<string, string[]>,
): OfferCandidate[] {
  const storeOfferIdsByMarket = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    if (candidate.storeId === null) continue;
    const set = storeOfferIdsByMarket.get(candidate.retailerMarketId) ?? new Set<string>();
    set.add(candidate.storeId);
    storeOfferIdsByMarket.set(candidate.retailerMarketId, set);
  }

  return candidates.filter((candidate) => {
    if (candidate.storeId !== null) return true;
    const inRadius = storeIdsInRadiusByMarket.get(candidate.retailerMarketId) ?? [];
    const overridden = storeOfferIdsByMarket.get(candidate.retailerMarketId) ?? new Set<string>();
    return inRadius.some((storeId) => !overridden.has(storeId));
  });
}

/**
 * Ranks offers for ONE product. Returns `fresh` and `aging` offers, best first;
 * `stale` and out-of-validity offers are excluded. At most one offer carries
 * `isBest: true`, and only a `fresh` one ever can.
 */
export function rankOffers(candidates: OfferCandidate[], options: RankingOptions): RankedOffer[] {
  const { now, maxPriceAgeHours } = options;

  const valid = candidates.filter((candidate) => isWithinValidity(candidate, now));
  // Freshness is classified BEFORE the suppression step: only fresh/aging
  // store-specific offers may cover a store, so a fresh market-wide price is never
  // suppressed by stale rows that are about to be dropped anyway.
  const current = valid.filter(
    (candidate) => classifyFreshness(candidate.observedAt, now, maxPriceAgeHours) !== 'stale',
  );
  const surviving = suppressCoveredMarketWideOffers(current, options.storeIdsInRadiusByMarket);

  const ranked: RankedOffer[] = [];
  for (const candidate of surviving) {
    const freshness = classifyFreshness(candidate.observedAt, now, maxPriceAgeHours);

    const { effectiveAmountMinor, activePromotion } = applyPromotion(
      candidate.priceAmountMinor,
      candidate.currencyCode,
      candidate.promotion,
      now,
    );

    ranked.push({
      ...candidate,
      freshness,
      effectiveAmountMinor,
      activePromotion,
      unitPriceAmountMinor: unitPrice(candidate),
      distanceMeters:
        candidate.store?.distanceMeters === undefined || candidate.store?.distanceMeters === null
          ? null
          : Math.round(candidate.store.distanceMeters),
      isBest: false,
    });
  }

  ranked.sort((a, b) => {
    if (a.effectiveAmountMinor !== b.effectiveAmountMinor) {
      return a.effectiveAmountMinor - b.effectiveAmountMinor;
    }
    // Distance is the tiebreak; a market-wide offer has none, so it sorts last.
    const da = a.distanceMeters ?? Number.POSITIVE_INFINITY;
    const db = b.distanceMeters ?? Number.POSITIVE_INFINITY;
    if (da !== db) return da - db;
    return a.id.localeCompare(b.id);
  });

  const best = ranked.find((offer) => offer.freshness === 'fresh');
  if (best) best.isBest = true;

  return ranked;
}

/** `NO_CURRENT_PRICES` is decided on FRESH offers only (contract). */
export function hasFreshOffer(ranked: RankedOffer[]): boolean {
  return ranked.some((offer) => offer.freshness === 'fresh');
}
