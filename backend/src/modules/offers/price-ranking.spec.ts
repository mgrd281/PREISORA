import type { StoreRow } from '../retailers/store.mapper';
import {
  OfferCandidate,
  PromotionInput,
  classifyFreshness,
  hasFreshOffer,
  rankOffers,
} from './price-ranking';

const NOW = new Date('2026-08-30T12:00:00Z');
const HOUR = 60 * 60 * 1000;
const MAX_AGE_HOURS = 72;

const MARKET_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const MARKET_B = 'bbbbbbbb-0000-4000-8000-000000000001';
const STORE_A1 = 'aaaaaaaa-1111-4000-8000-000000000001';
const STORE_A2 = 'aaaaaaaa-1111-4000-8000-000000000002';
const STORE_B1 = 'bbbbbbbb-1111-4000-8000-000000000001';
const PRODUCT = '11111111-2222-4333-8444-555555555555';

function store(id: string, marketId: string, distanceMeters: number): StoreRow {
  return {
    id,
    retailerMarketId: marketId,
    name: `Store ${id.slice(0, 4)}`,
    lat: 52.52,
    lng: 13.405,
    street: 'Teststrasse 1',
    postalCode: '10178',
    city: 'Berlin',
    countryCode: 'DE',
    openingHours: null,
    distanceMeters,
  };
}

function candidate(overrides: Partial<OfferCandidate> & { id: string }): OfferCandidate {
  return {
    productId: PRODUCT,
    retailerMarketId: MARKET_A,
    storeId: null,
    priceAmountMinor: 129,
    currencyCode: 'EUR',
    observedAt: new Date(NOW.getTime() - 2 * HOUR),
    validFrom: null,
    validUntil: null,
    promotion: null,
    store: null,
    unitPriceDivisor: 1,
    unitPriceQuantityText: '1 l',
    ...overrides,
  };
}

/** Market A has two in-radius stores, market B one. */
const STORES_IN_RADIUS = new Map<string, string[]>([
  [MARKET_A, [STORE_A1, STORE_A2]],
  [MARKET_B, [STORE_B1]],
]);

function rank(candidates: OfferCandidate[], storesInRadius = STORES_IN_RADIUS) {
  return rankOffers(candidates, {
    now: NOW,
    maxPriceAgeHours: MAX_AGE_HOURS,
    storeIdsInRadiusByMarket: storesInRadius,
  });
}

describe('classifyFreshness', () => {
  it('is fresh inside the configured window', () => {
    expect(classifyFreshness(new Date(NOW.getTime() - 71 * HOUR), NOW, MAX_AGE_HOURS)).toBe('fresh');
  });
  it('is aging up to twice the window', () => {
    expect(classifyFreshness(new Date(NOW.getTime() - 100 * HOUR), NOW, MAX_AGE_HOURS)).toBe(
      'aging',
    );
  });
  it('is stale beyond twice the window', () => {
    expect(classifyFreshness(new Date(NOW.getTime() - 200 * HOUR), NOW, MAX_AGE_HOURS)).toBe(
      'stale',
    );
  });
});

describe('rankOffers — market-wide vs store-specific override', () => {
  it('case 1: only a market-wide offer exists -> it is returned and is best', () => {
    const ranked = rank([candidate({ id: 'offer-market', storeId: null })]);

    expect(ranked).toHaveLength(1);
    expect(ranked[0].id).toBe('offer-market');
    expect(ranked[0].storeId).toBeNull();
    expect(ranked[0].distanceMeters).toBeNull();
    expect(ranked[0].isBest).toBe(true);
  });

  it('case 2: only a store-specific offer exists -> it is returned with its distance', () => {
    const ranked = rank([
      candidate({
        id: 'offer-store',
        storeId: STORE_A1,
        priceAmountMinor: 119,
        store: store(STORE_A1, MARKET_A, 420),
      }),
    ]);

    expect(ranked).toHaveLength(1);
    expect(ranked[0].id).toBe('offer-store');
    expect(ranked[0].distanceMeters).toBe(420);
    expect(ranked[0].isBest).toBe(true);
  });

  it('case 3a: both exist, but the market still has an uncovered store -> both survive', () => {
    // A store-specific price at STORE_A1 does not speak for STORE_A2, so the
    // market-wide price is still the price a shopper pays at STORE_A2.
    const ranked = rank([
      candidate({ id: 'offer-market', storeId: null, priceAmountMinor: 129 }),
      candidate({
        id: 'offer-store',
        storeId: STORE_A1,
        priceAmountMinor: 119,
        store: store(STORE_A1, MARKET_A, 420),
      }),
    ]);

    expect(ranked.map((o) => o.id)).toEqual(['offer-store', 'offer-market']);
    expect(ranked[0].isBest).toBe(true);
    expect(ranked[1].isBest).toBe(false);
  });

  it('case 3b: both exist and EVERY in-radius store is covered -> the store offers win outright', () => {
    const ranked = rank([
      candidate({ id: 'offer-market', storeId: null, priceAmountMinor: 129 }),
      candidate({
        id: 'offer-store-1',
        storeId: STORE_A1,
        priceAmountMinor: 119,
        store: store(STORE_A1, MARKET_A, 420),
      }),
      candidate({
        id: 'offer-store-2',
        storeId: STORE_A2,
        priceAmountMinor: 125,
        store: store(STORE_A2, MARKET_A, 900),
      }),
    ]);

    expect(ranked.map((o) => o.id)).toEqual(['offer-store-1', 'offer-store-2']);
    expect(ranked.some((o) => o.storeId === null)).toBe(false);
  });

  it('drops a market-wide offer whose market has no store inside the radius', () => {
    const ranked = rank(
      [candidate({ id: 'offer-market-b', retailerMarketId: MARKET_B, storeId: null })],
      new Map([[MARKET_A, [STORE_A1]]]),
    );
    expect(ranked).toHaveLength(0);
  });

  it('case 4: a stale offer is excluded entirely', () => {
    const ranked = rank([
      candidate({
        id: 'offer-stale',
        storeId: STORE_A1,
        priceAmountMinor: 1,
        observedAt: new Date(NOW.getTime() - 200 * HOUR),
        store: store(STORE_A1, MARKET_A, 100),
      }),
      candidate({ id: 'offer-market', storeId: null, priceAmountMinor: 129 }),
    ]);

    expect(ranked.map((o) => o.id)).toEqual(['offer-market']);
  });

  it('stale store-specific offers on every in-radius store do not veto a fresh market-wide price', () => {
    // Both of market A's in-radius stores carry ONLY stale store-specific offers.
    // Those rows are dropped from the response, so they must not count as "covering"
    // their stores — the fresh market-wide price is still the price a shopper pays.
    const ranked = rank([
      candidate({
        id: 'offer-stale-a1',
        storeId: STORE_A1,
        priceAmountMinor: 99,
        observedAt: new Date(NOW.getTime() - 200 * HOUR),
        store: store(STORE_A1, MARKET_A, 100),
      }),
      candidate({
        id: 'offer-stale-a2',
        storeId: STORE_A2,
        priceAmountMinor: 109,
        observedAt: new Date(NOW.getTime() - 200 * HOUR),
        store: store(STORE_A2, MARKET_A, 200),
      }),
      candidate({ id: 'offer-market-fresh', storeId: null, priceAmountMinor: 129 }),
    ]);

    expect(ranked.map((o) => o.id)).toEqual(['offer-market-fresh']);
    expect(ranked[0].isBest).toBe(true);
    expect(hasFreshOffer(ranked)).toBe(true);
  });

  it('keeps an aging offer but never lets it be best', () => {
    const ranked = rank([
      candidate({
        id: 'offer-aging-cheap',
        storeId: STORE_A1,
        priceAmountMinor: 99,
        observedAt: new Date(NOW.getTime() - 100 * HOUR),
        store: store(STORE_A1, MARKET_A, 100),
      }),
      candidate({ id: 'offer-market-fresh', storeId: null, priceAmountMinor: 129 }),
    ]);

    expect(ranked.map((o) => o.id)).toEqual(['offer-aging-cheap', 'offer-market-fresh']);
    expect(ranked[0].freshness).toBe('aging');
    expect(ranked[0].isBest).toBe(false);
    expect(ranked[1].isBest).toBe(true);
    expect(hasFreshOffer(ranked)).toBe(true);
  });

  it('case 5: an offer outside its advertised validity window is excluded', () => {
    const ranked = rank([
      candidate({
        id: 'offer-expired',
        storeId: STORE_A1,
        priceAmountMinor: 79,
        validFrom: new Date('2026-08-01T00:00:00Z'),
        validUntil: new Date('2026-08-20T23:59:59Z'),
        store: store(STORE_A1, MARKET_A, 100),
      }),
      candidate({
        id: 'offer-not-yet-valid',
        storeId: STORE_A2,
        priceAmountMinor: 69,
        validFrom: new Date('2026-09-05T00:00:00Z'),
        validUntil: null,
        store: store(STORE_A2, MARKET_A, 200),
      }),
      candidate({ id: 'offer-market', storeId: null, priceAmountMinor: 129 }),
    ]);

    expect(ranked.map((o) => o.id)).toEqual(['offer-market']);
  });

  it('case 6: an active percentage promotion lowers effectivePrice and drives ranking', () => {
    const promotion: PromotionInput = {
      id: 'promo-1',
      type: 'percentage',
      percentOff: 20,
      amountOffMinor: null,
      amountOffCurrencyCode: null,
      requiresLoyaltyCard: false,
      startsAt: new Date(NOW.getTime() - 3 * 24 * HOUR),
      endsAt: new Date(NOW.getTime() + 3 * 24 * HOUR),
    };

    const ranked = rank([
      candidate({
        id: 'offer-promoted',
        storeId: STORE_A1,
        priceAmountMinor: 159,
        promotion,
        store: store(STORE_A1, MARKET_A, 1830),
      }),
      candidate({ id: 'offer-plain', storeId: null, priceAmountMinor: 139 }),
    ]);

    const promoted = ranked.find((o) => o.id === 'offer-promoted');
    expect(promoted?.effectiveAmountMinor).toBe(127); // 159 * 0.8 = 127.2 -> 127
    expect(promoted?.activePromotion?.id).toBe('promo-1');
    // 127 beats the plain 139 even though the shelf price is higher.
    expect(ranked[0].id).toBe('offer-promoted');
    expect(ranked[0].isBest).toBe(true);
  });

  it('ignores a promotion outside its own window and reports it as null', () => {
    const expired: PromotionInput = {
      id: 'promo-expired',
      type: 'percentage',
      percentOff: 50,
      amountOffMinor: null,
      amountOffCurrencyCode: null,
      requiresLoyaltyCard: false,
      startsAt: new Date(NOW.getTime() - 30 * 24 * HOUR),
      endsAt: new Date(NOW.getTime() - 1 * 24 * HOUR),
    };
    const ranked = rank([
      candidate({ id: 'offer-market', storeId: null, priceAmountMinor: 200, promotion: expired }),
    ]);

    expect(ranked[0].effectiveAmountMinor).toBe(200);
    expect(ranked[0].activePromotion).toBeNull();
  });

  it('applies an absolute promotion only in a matching currency', () => {
    const foreign: PromotionInput = {
      id: 'promo-chf',
      type: 'absolute',
      percentOff: null,
      amountOffMinor: 50,
      amountOffCurrencyCode: 'CHF',
      requiresLoyaltyCard: false,
      startsAt: null,
      endsAt: null,
    };
    const ranked = rank([
      candidate({ id: 'offer-market', storeId: null, priceAmountMinor: 200, promotion: foreign }),
    ]);
    expect(ranked[0].effectiveAmountMinor).toBe(200);
  });

  it('surfaces but does not evaluate multibuy promotions (contract)', () => {
    const multibuy: PromotionInput = {
      id: 'promo-3for2',
      type: 'multibuy',
      percentOff: null,
      amountOffMinor: null,
      amountOffCurrencyCode: null,
      requiresLoyaltyCard: false,
      startsAt: null,
      endsAt: null,
    };
    const ranked = rank([
      candidate({ id: 'offer-market', storeId: null, priceAmountMinor: 300, promotion: multibuy }),
    ]);
    expect(ranked[0].effectiveAmountMinor).toBe(300);
    expect(ranked[0].activePromotion?.id).toBe('promo-3for2');
  });

  it('breaks equal effective prices on distance, market-wide offers last', () => {
    const ranked = rank([
      candidate({ id: 'far', storeId: STORE_A2, store: store(STORE_A2, MARKET_A, 3000) }),
      candidate({ id: 'near', storeId: STORE_A1, store: store(STORE_A1, MARKET_A, 300) }),
      candidate({ id: 'market-b', retailerMarketId: MARKET_B, storeId: null }),
    ]);
    expect(ranked.map((o) => o.id)).toEqual(['near', 'far', 'market-b']);
  });

  it('marks exactly one offer as best', () => {
    const ranked = rank([
      candidate({ id: 'a', storeId: STORE_A1, priceAmountMinor: 100, store: store(STORE_A1, MARKET_A, 1) }),
      candidate({ id: 'b', storeId: STORE_A2, priceAmountMinor: 100, store: store(STORE_A2, MARKET_A, 2) }),
      candidate({ id: 'c', retailerMarketId: MARKET_B, storeId: STORE_B1, priceAmountMinor: 100, store: store(STORE_B1, MARKET_B, 3) }),
    ]);
    expect(ranked.filter((o) => o.isBest)).toHaveLength(1);
  });

  it('reports no fresh offer when everything in radius is aging (drives NO_CURRENT_PRICES)', () => {
    const ranked = rank([
      candidate({
        id: 'offer-aging',
        storeId: STORE_A1,
        observedAt: new Date(NOW.getTime() - 100 * HOUR),
        store: store(STORE_A1, MARKET_A, 100),
      }),
    ]);
    expect(hasFreshOffer(ranked)).toBe(false);
  });

  it('computes the unit price from the listed shelf price', () => {
    const ranked = rank([
      candidate({
        id: 'offer-butter',
        storeId: null,
        priceAmountMinor: 239,
        unitPriceDivisor: 0.25,
        unitPriceQuantityText: '1 kg',
      }),
    ]);
    expect(ranked[0].unitPriceAmountMinor).toBe(956); // 239 / 0.25
  });

  it('leaves the unit price null when the pack size is unknown', () => {
    const ranked = rank([
      candidate({ id: 'offer-x', storeId: null, unitPriceDivisor: null, unitPriceQuantityText: null }),
    ]);
    expect(ranked[0].unitPriceAmountMinor).toBeNull();
  });
});
