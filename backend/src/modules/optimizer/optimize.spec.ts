import type { RankedOffer } from '../offers/price-ranking';
import type { StoreRow } from '../retailers/store.mapper';
import { OptimizeInput, UNAVAILABLE_REASON, computeConfidence, optimize } from './optimize';

const NOW = new Date('2026-08-30T12:00:00Z');
const HOUR = 60 * 60 * 1000;
const MAX_AGE_HOURS = 72;

const MILK = '11111111-0000-4000-8000-000000000001';
const BUTTER = '11111111-0000-4000-8000-000000000002';
const COFFEE = '11111111-0000-4000-8000-000000000003';
const CAVIAR = '11111111-0000-4000-8000-000000000004';

const CHEAP_STORE = 'aaaa1111-0000-4000-8000-000000000001';
const NEAR_STORE = 'aaaa1111-0000-4000-8000-000000000002';
const FAR_STORE = 'aaaa1111-0000-4000-8000-000000000003';

function storeRow(id: string, distanceMeters: number): StoreRow {
  return {
    id,
    retailerMarketId: 'market',
    name: id,
    lat: 52.52,
    lng: 13.405,
    street: 's',
    postalCode: '10178',
    city: 'Berlin',
    countryCode: 'DE',
    openingHours: null,
    distanceMeters,
  };
}

function offer(
  productId: string,
  storeId: string,
  amount: number,
  ageHours = 1,
): RankedOffer {
  return {
    id: `${productId}@${storeId}`,
    productId,
    retailerMarketId: 'market',
    storeId,
    priceAmountMinor: amount,
    currencyCode: 'EUR',
    observedAt: new Date(NOW.getTime() - ageHours * HOUR),
    validFrom: null,
    validUntil: null,
    promotion: null,
    store: storeRow(storeId, 100),
    unitPriceDivisor: null,
    unitPriceQuantityText: null,
    freshness: 'fresh',
    effectiveAmountMinor: amount,
    activePromotion: null,
    unitPriceAmountMinor: null,
    distanceMeters: 100,
    isBest: false,
  };
}

function matrix(
  entries: Array<[string, Array<[string, number]>]>,
): Map<string, Map<string, RankedOffer>> {
  const result = new Map<string, Map<string, RankedOffer>>();
  for (const [storeId, products] of entries) {
    const byProduct = new Map<string, RankedOffer>();
    for (const [productId, amount] of products) {
      byProduct.set(productId, offer(productId, storeId, amount));
    }
    result.set(storeId, byProduct);
  }
  return result;
}

function baseInput(overrides: Partial<OptimizeInput>): OptimizeInput {
  return {
    items: [
      { productId: MILK, quantity: 2 },
      { productId: BUTTER, quantity: 1 },
      { productId: COFFEE, quantity: 1 },
    ],
    stores: [
      { id: NEAR_STORE, distanceMeters: 300 },
      { id: CHEAP_STORE, distanceMeters: 1200 },
      { id: FAR_STORE, distanceMeters: 4000 },
    ],
    priceMatrix: matrix([
      // NEAR: mediocre everywhere.
      [
        NEAR_STORE,
        [
          [MILK, 129],
          [BUTTER, 239],
          [COFFEE, 549],
        ],
      ],
      // CHEAP: best milk and butter, terrible coffee.
      [
        CHEAP_STORE,
        [
          [MILK, 99],
          [BUTTER, 199],
          [COFFEE, 799],
        ],
      ],
      // FAR: best coffee only.
      [
        FAR_STORE,
        [
          [MILK, 149],
          [BUTTER, 299],
          [COFFEE, 399],
        ],
      ],
    ]),
    strategy: 'cheapest_total',
    now: NOW,
    maxPriceAgeHours: MAX_AGE_HOURS,
    maxStores: 3,
    maxCandidateStores: 15,
    ...overrides,
  };
}

describe('optimize — cheapest_total', () => {
  it('splits the basket to reach the true minimum total', () => {
    const plan = optimize(baseInput({ strategy: 'cheapest_total' }));

    // milk 2x99 + butter 199 at CHEAP, coffee 399 at FAR = 796.
    expect(plan.totalMinor).toBe(2 * 99 + 199 + 399);
    expect(plan.stores.map((s) => s.storeId).sort()).toEqual([CHEAP_STORE, FAR_STORE].sort());
    expect(plan.unavailable).toEqual([]);
  });

  it('never visits more than the configured maximum number of stores', () => {
    const plan = optimize(baseInput({ strategy: 'cheapest_total', maxStores: 1 }));
    expect(plan.stores).toHaveLength(1);
  });

  it('reports savings against the best single-store baseline', () => {
    const plan = optimize(baseInput({ strategy: 'cheapest_total' }));
    // Single-store baselines: NEAR 2*129+239+549 = 1046, CHEAP 2*99+199+799 = 1196,
    // FAR 2*149+299+399 = 996. The cheapest complete single store is FAR.
    expect(plan.savingsMinor).toBe(996 - plan.totalMinor);
    expect(plan.savingsMinor).toBe(200);
  });

  it('assigns each item to the cheapest store among the chosen ones', () => {
    const plan = optimize(baseInput({ strategy: 'cheapest_total' }));
    const byProduct = new Map(
      plan.stores.flatMap((store) => store.items.map((item) => [item.productId, store.storeId])),
    );
    expect(byProduct.get(MILK)).toBe(CHEAP_STORE);
    expect(byProduct.get(BUTTER)).toBe(CHEAP_STORE);
    expect(byProduct.get(COFFEE)).toBe(FAR_STORE);
  });

  it('quantity-weights the subtotals', () => {
    const plan = optimize(baseInput({ strategy: 'cheapest_total' }));
    const cheap = plan.stores.find((s) => s.storeId === CHEAP_STORE);
    expect(cheap?.subtotalMinor).toBe(2 * 99 + 199);
  });
});

describe('optimize — fewest_stores', () => {
  it('picks exactly one store', () => {
    const plan = optimize(baseInput({ strategy: 'fewest_stores' }));
    expect(plan.stores).toHaveLength(1);
  });

  it('picks the cheapest store that still covers the whole list', () => {
    const plan = optimize(baseInput({ strategy: 'fewest_stores' }));
    // NEAR 1046 vs CHEAP 2*99+199+799 = 1196 vs FAR 2*149+299+399 = 996.
    expect(plan.stores[0].storeId).toBe(FAR_STORE);
    expect(plan.totalMinor).toBe(996);
    expect(plan.savingsMinor).toBe(0); // it IS the single-store baseline
  });

  it('prefers coverage over price', () => {
    const input = baseInput({
      strategy: 'fewest_stores',
      priceMatrix: matrix([
        // A store that is cheap but only sells milk must not win over a complete one.
        [CHEAP_STORE, [[MILK, 1]]],
        [
          NEAR_STORE,
          [
            [MILK, 129],
            [BUTTER, 239],
            [COFFEE, 549],
          ],
        ],
      ]),
      stores: [
        { id: CHEAP_STORE, distanceMeters: 100 },
        { id: NEAR_STORE, distanceMeters: 300 },
      ],
    });
    const plan = optimize(input);
    expect(plan.stores[0].storeId).toBe(NEAR_STORE);
    expect(plan.unavailable).toEqual([]);
  });
});

describe('optimize — unavailable items and confidence', () => {
  it('reports items no store in radius can satisfy', () => {
    const plan = optimize(
      baseInput({
        items: [
          { productId: MILK, quantity: 1 },
          { productId: CAVIAR, quantity: 1 },
        ],
      }),
    );
    expect(plan.unavailable).toEqual([{ productId: CAVIAR, reason: UNAVAILABLE_REASON }]);
    expect(plan.stores.flatMap((s) => s.items).map((i) => i.productId)).toEqual([MILK]);
  });

  it('returns an empty plan when nothing is available at all', () => {
    const plan = optimize(baseInput({ priceMatrix: new Map(), stores: [] }));
    expect(plan.stores).toEqual([]);
    expect(plan.totalMinor).toBe(0);
    expect(plan.savingsMinor).toBe(0);
    expect(plan.unavailable).toHaveLength(3);
    expect(plan.confidence).toBe(0);
  });

  it('confidence stays inside [0,1] and drops as coverage drops', () => {
    const full = optimize(baseInput({}));
    const partial = optimize(
      baseInput({
        items: [
          { productId: MILK, quantity: 1 },
          { productId: CAVIAR, quantity: 1 },
        ],
      }),
    );
    expect(full.confidence).toBeGreaterThan(partial.confidence);
    for (const value of [full.confidence, partial.confidence]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('confidence penalises older observations', () => {
    const fresh = computeConfidence(
      [{ storeId: NEAR_STORE, items: [{ productId: MILK, quantity: 1, offer: offer(MILK, NEAR_STORE, 100, 1) }], subtotalMinor: 100 }],
      1,
      1,
      NOW,
      MAX_AGE_HOURS,
    );
    const stale = computeConfidence(
      [{ storeId: NEAR_STORE, items: [{ productId: MILK, quantity: 1, offer: offer(MILK, NEAR_STORE, 100, 70) }], subtotalMinor: 100 }],
      1,
      1,
      NOW,
      MAX_AGE_HOURS,
    );
    expect(fresh).toBeGreaterThan(stale);
  });

  it('ignores offers in a non-dominant currency', () => {
    const input = baseInput({ items: [{ productId: MILK, quantity: 1 }] });
    const chf = offer(MILK, FAR_STORE, 1);
    input.priceMatrix.set(FAR_STORE, new Map([[MILK, { ...chf, currencyCode: 'CHF' }]]));
    const plan = optimize(input);
    expect(plan.currencyCode).toBe('EUR');
    expect(plan.stores.every((s) => s.storeId !== FAR_STORE)).toBe(true);
  });
});
