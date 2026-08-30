/**
 * The shopping optimizer (constitution §23) — pure, deterministic, unit-testable.
 *
 * Only FRESH offers reach this module; the caller is responsible for that filter
 * (the contract says the optimizer runs "over fresh offers in radius").
 */
import type { RankedOffer } from '../offers/price-ranking';

export type OptimizerStrategy = 'cheapest_total' | 'fewest_stores' | 'balanced';

export interface OptimizerItem {
  productId: string;
  quantity: number;
}

export interface OptimizerStore {
  id: string;
  distanceMeters: number | null;
}

export interface OptimizeInput {
  items: OptimizerItem[];
  /** Candidate stores, nearest first. */
  stores: OptimizerStore[];
  /** storeId -> productId -> the offer that store sells the product at. */
  priceMatrix: Map<string, Map<string, RankedOffer>>;
  strategy: 'cheapest_total' | 'fewest_stores';
  now: Date;
  maxPriceAgeHours: number;
  /** `cheapest_total` splits across at most this many stores. */
  maxStores: number;
  /** Upper bound on the exhaustive search's input set. */
  maxCandidateStores: number;
}

export interface PlannedItem {
  productId: string;
  quantity: number;
  offer: RankedOffer;
}

export interface PlannedStore {
  storeId: string;
  items: PlannedItem[];
  subtotalMinor: number;
}

export interface OptimizePlan {
  strategy: 'cheapest_total' | 'fewest_stores';
  stores: PlannedStore[];
  totalMinor: number;
  savingsMinor: number;
  confidence: number;
  currencyCode: string | null;
  unavailable: Array<{ productId: string; reason: string }>;
}

const HOUR_MS = 60 * 60 * 1000;
export const UNAVAILABLE_REASON = 'no_fresh_offer_in_radius';

/** Cross-currency baskets are not comparable; the dominant currency wins. */
function dominantCurrency(priceMatrix: Map<string, Map<string, RankedOffer>>): string | null {
  const counts = new Map<string, number>();
  for (const byProduct of priceMatrix.values()) {
    for (const offer of byProduct.values()) {
      const code = offer.currencyCode.trim();
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
  }
  let winner: string | null = null;
  let best = -1;
  for (const [code, count] of counts) {
    if (count > best) {
      winner = code;
      best = count;
    }
  }
  return winner;
}

function combinations<T>(items: T[], maxSize: number): T[][] {
  const result: T[][] = [];
  const walk = (start: number, current: T[]): void => {
    if (current.length > 0) result.push([...current]);
    if (current.length === maxSize) return;
    for (let i = start; i < items.length; i += 1) {
      current.push(items[i]);
      walk(i + 1, current);
      current.pop();
    }
  };
  walk(0, []);
  return result;
}

interface Assignment {
  storeIds: string[];
  assigned: Map<string, { storeId: string; offer: RankedOffer }>;
  totalMinor: number;
}

/** Assigns every item to the cheapest store IN THE COMBINATION that carries it. */
function assign(
  items: OptimizerItem[],
  storeIds: string[],
  priceMatrix: Map<string, Map<string, RankedOffer>>,
): Assignment {
  const assigned = new Map<string, { storeId: string; offer: RankedOffer }>();
  let totalMinor = 0;

  for (const item of items) {
    let bestStoreId: string | null = null;
    let bestOffer: RankedOffer | null = null;
    for (const storeId of storeIds) {
      const offer = priceMatrix.get(storeId)?.get(item.productId);
      if (!offer) continue;
      if (bestOffer === null || offer.effectiveAmountMinor < bestOffer.effectiveAmountMinor) {
        bestOffer = offer;
        bestStoreId = storeId;
      }
    }
    if (bestOffer && bestStoreId) {
      assigned.set(item.productId, { storeId: bestStoreId, offer: bestOffer });
      totalMinor += bestOffer.effectiveAmountMinor * item.quantity;
    }
  }

  return { storeIds, assigned, totalMinor };
}

function distanceOf(stores: OptimizerStore[], storeIds: string[]): number {
  return storeIds.reduce((sum, id) => {
    const store = stores.find((s) => s.id === id);
    return sum + (store?.distanceMeters ?? 0);
  }, 0);
}

/**
 * `confidence` heuristic — deliberately coarse and fully documented (README):
 *
 *   confidence = 0.55 * coverage + 0.30 * recency + 0.15 * dispersion
 *
 *   coverage   quantity-weighted share of the list an offer was found for
 *   recency    mean of `1 - age/MAX_PRICE_AGE_HOURS` over the chosen offers
 *              (an offer observed minutes ago scores ~1, one at the edge of the
 *              freshness window scores ~0)
 *   dispersion 1 - 0.1 * (storesToVisit - 1), floored at 0.7 — a plan spread over
 *              more stores is likelier to be disrupted in practice
 *
 * The result is clamped to [0, 1] and rounded to two decimals.
 */
export function computeConfidence(
  plannedStores: PlannedStore[],
  totalUnits: number,
  coveredUnits: number,
  now: Date,
  maxPriceAgeHours: number,
): number {
  // A plan that buys nothing has no confidence at all — the dispersion term must not
  // hand out credit for an empty result.
  if (totalUnits === 0 || coveredUnits === 0 || plannedStores.length === 0) return 0;
  const coverage = coveredUnits / totalUnits;

  const offers = plannedStores.flatMap((store) => store.items.map((item) => item.offer));
  const recency =
    offers.length === 0
      ? 0
      : offers.reduce((sum, offer) => {
          const ageHours = (now.getTime() - offer.observedAt.getTime()) / HOUR_MS;
          return sum + Math.min(1, Math.max(0, 1 - ageHours / maxPriceAgeHours));
        }, 0) / offers.length;

  const dispersion = Math.max(0.7, 1 - 0.1 * Math.max(0, plannedStores.length - 1));

  const raw = 0.55 * coverage + 0.3 * recency + 0.15 * dispersion;
  return Math.round(Math.min(1, Math.max(0, raw)) * 100) / 100;
}

export function optimize(input: OptimizeInput): OptimizePlan {
  const currencyCode = dominantCurrency(input.priceMatrix);

  // Restrict the matrix to the dominant currency so totals are meaningful.
  const matrix = new Map<string, Map<string, RankedOffer>>();
  for (const [storeId, byProduct] of input.priceMatrix) {
    const filtered = new Map<string, RankedOffer>();
    for (const [productId, offer] of byProduct) {
      if (currencyCode === null || offer.currencyCode.trim() === currencyCode) {
        filtered.set(productId, offer);
      }
    }
    if (filtered.size > 0) matrix.set(storeId, filtered);
  }

  const candidateStores = input.stores
    .filter((store) => matrix.has(store.id))
    .slice(0, input.maxCandidateStores);
  const candidateIds = candidateStores.map((s) => s.id);

  const maxStores = input.strategy === 'fewest_stores' ? 1 : Math.max(1, input.maxStores);

  let bestAssignment: Assignment | null = null;
  if (candidateIds.length > 0) {
    for (const combo of combinations(candidateIds, maxStores)) {
      const candidate = assign(input.items, combo, matrix);
      if (bestAssignment === null) {
        bestAssignment = candidate;
        continue;
      }
      // Coverage first (a cheaper plan that skips items is not a better plan),
      // then total, then fewer stores, then less walking.
      if (candidate.assigned.size !== bestAssignment.assigned.size) {
        if (candidate.assigned.size > bestAssignment.assigned.size) bestAssignment = candidate;
        continue;
      }
      if (candidate.totalMinor !== bestAssignment.totalMinor) {
        if (candidate.totalMinor < bestAssignment.totalMinor) bestAssignment = candidate;
        continue;
      }
      const usedCandidate = new Set([...candidate.assigned.values()].map((a) => a.storeId)).size;
      const usedBest = new Set([...bestAssignment.assigned.values()].map((a) => a.storeId)).size;
      if (usedCandidate !== usedBest) {
        if (usedCandidate < usedBest) bestAssignment = candidate;
        continue;
      }
      if (
        distanceOf(candidateStores, candidate.storeIds) <
        distanceOf(candidateStores, bestAssignment.storeIds)
      ) {
        bestAssignment = candidate;
      }
    }
  }

  const quantityByProduct = new Map(input.items.map((item) => [item.productId, item.quantity]));
  const plannedStores: PlannedStore[] = [];

  if (bestAssignment) {
    // Preserve the nearest-first store order and drop stores nothing was assigned to.
    for (const store of candidateStores) {
      const items: PlannedItem[] = [];
      let subtotalMinor = 0;
      for (const [productId, assignment] of bestAssignment.assigned) {
        if (assignment.storeId !== store.id) continue;
        const quantity = quantityByProduct.get(productId) ?? 1;
        items.push({ productId, quantity, offer: assignment.offer });
        subtotalMinor += assignment.offer.effectiveAmountMinor * quantity;
      }
      if (items.length > 0) plannedStores.push({ storeId: store.id, items, subtotalMinor });
    }
  }

  const coveredProductIds = new Set(plannedStores.flatMap((s) => s.items.map((i) => i.productId)));
  const unavailable = input.items
    .filter((item) => !coveredProductIds.has(item.productId))
    .map((item) => ({ productId: item.productId, reason: UNAVAILABLE_REASON }));

  const totalMinor = plannedStores.reduce((sum, store) => sum + store.subtotalMinor, 0);

  // Baseline = the cheapest SINGLE store that covers exactly the items this plan
  // covers. If no single store covers them all, there is nothing honest to compare
  // against, so savings are reported as zero.
  let baselineMinor: number | null = null;
  const coveredItems = input.items.filter((item) => coveredProductIds.has(item.productId));
  for (const store of candidateStores) {
    const byProduct = matrix.get(store.id);
    if (!byProduct) continue;
    let storeTotal = 0;
    let coversAll = true;
    for (const item of coveredItems) {
      const offer = byProduct.get(item.productId);
      if (!offer) {
        coversAll = false;
        break;
      }
      storeTotal += offer.effectiveAmountMinor * item.quantity;
    }
    if (coversAll && (baselineMinor === null || storeTotal < baselineMinor)) {
      baselineMinor = storeTotal;
    }
  }
  const savingsMinor = baselineMinor === null ? 0 : Math.max(0, baselineMinor - totalMinor);

  const totalUnits = input.items.reduce((sum, item) => sum + item.quantity, 0);
  const coveredUnits = coveredItems.reduce((sum, item) => sum + item.quantity, 0);

  return {
    strategy: input.strategy,
    stores: plannedStores,
    totalMinor,
    savingsMinor,
    confidence: computeConfidence(
      plannedStores,
      totalUnits,
      coveredUnits,
      input.now,
      input.maxPriceAgeHours,
    ),
    currencyCode,
    unavailable,
  };
}
