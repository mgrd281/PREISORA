import { INestApplication } from '@nestjs/common';
import {
  API,
  AuthSession,
  BERLIN,
  MUNICH,
  SEEDED_GTIN_BUTTER,
  SEEDED_GTIN_COFFEE,
  SEEDED_GTIN_MILK,
  anonymousSession,
  createTestApp,
  expectErrorEnvelope,
  http,
  productIdByGtin,
} from './helpers';

describe('optimizer and capabilities (e2e)', () => {
  let app: INestApplication;
  let session: AuthSession;
  let listId: string;
  let milkId: string;
  let butterId: string;
  let coffeeId: string;

  beforeAll(async () => {
    app = await createTestApp();
    milkId = await productIdByGtin(app, SEEDED_GTIN_MILK);
    butterId = await productIdByGtin(app, SEEDED_GTIN_BUTTER);
    coffeeId = await productIdByGtin(app, SEEDED_GTIN_COFFEE);
  });

  beforeEach(async () => {
    session = await anonymousSession(app);
    const list = await http(app)
      .post(`${API}/shopping-lists`)
      .set('Authorization', session.auth)
      .send({ name: 'Optimizer-Testliste' })
      .expect(201);
    listId = list.body.id;

    for (const [productId, quantity] of [
      [milkId, 2],
      [butterId, 1],
      [coffeeId, 1],
    ] as Array<[string, number]>) {
      await http(app)
        .post(`${API}/shopping-lists/${listId}/items`)
        .set('Authorization', session.auth)
        .send({ productId, quantity })
        .expect(201);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('produces a real OptimizationResult for cheapest_total', async () => {
    const { body } = await http(app)
      .post(`${API}/shopping-lists/${listId}/optimize`)
      .set('Authorization', session.auth)
      .send({ strategy: 'cheapest_total', lat: BERLIN.lat, lng: BERLIN.lng, radiusMeters: 5000 })
      .expect(200);

    expect(Object.keys(body).sort()).toEqual(
      ['confidence', 'estimatedSavings', 'stores', 'strategy', 'totalPrice', 'unavailableItems'].sort(),
    );
    expect(body.strategy).toBe('cheapest_total');
    expect(body.unavailableItems).toEqual([]);
    expect(body.stores.length).toBeGreaterThan(0);
    expect(body.stores.length).toBeLessThanOrEqual(3);

    expect(body.totalPrice.currencyCode).toBe('EUR');
    expect(Number.isInteger(body.totalPrice.amountMinor)).toBe(true);
    expect(body.totalPrice.amountMinor).toBeGreaterThan(0);
    expect(body.confidence).toBeGreaterThan(0);
    expect(body.confidence).toBeLessThanOrEqual(1);

    let recomputedTotal = 0;
    const plannedProductIds: string[] = [];
    for (const store of body.stores) {
      // Every store in the plan carries a full Store with its distance.
      expect(store.store.id).toBeTruthy();
      expect(Number.isInteger(store.store.distanceMeters)).toBe(true);
      expect(store.store.distanceMeters).toBeLessThanOrEqual(5000);
      expect(store.store.address.city).toBe('Berlin');

      let subtotal = 0;
      for (const item of store.items) {
        expect(item.quantity).toBeGreaterThanOrEqual(1);
        expect(item.offer.productId).toBe(item.productId);
        expect(item.offer.freshness).toBe('fresh');
        subtotal += item.offer.effectivePrice.amountMinor * item.quantity;
        plannedProductIds.push(item.productId);
      }
      expect(store.subtotal.amountMinor).toBe(subtotal);
      recomputedTotal += subtotal;
    }

    expect(body.totalPrice.amountMinor).toBe(recomputedTotal);
    expect(plannedProductIds.sort()).toEqual([milkId, butterId, coffeeId].sort());

    // The seed's loss leaders make the true optimum a genuine SPLIT — the cheapest
    // milk/coffee and the cheapest butter are at different retailers.
    expect(body.stores.length).toBeGreaterThan(1);
    expect(body.estimatedSavings.amountMinor).toBeGreaterThan(0);
  });

  it('produces a single-store plan for fewest_stores', async () => {
    const { body } = await http(app)
      .post(`${API}/shopping-lists/${listId}/optimize`)
      .set('Authorization', session.auth)
      .send({ strategy: 'fewest_stores', lat: BERLIN.lat, lng: BERLIN.lng })
      .expect(200);

    expect(body.strategy).toBe('fewest_stores');
    expect(body.stores).toHaveLength(1);
    expect(body.stores[0].items).toHaveLength(3);
    expect(body.unavailableItems).toEqual([]);
  });

  it('cheapest_total is never more expensive than fewest_stores', async () => {
    const cheapest = await http(app)
      .post(`${API}/shopping-lists/${listId}/optimize`)
      .set('Authorization', session.auth)
      .send({ strategy: 'cheapest_total', lat: BERLIN.lat, lng: BERLIN.lng })
      .expect(200);
    const fewest = await http(app)
      .post(`${API}/shopping-lists/${listId}/optimize`)
      .set('Authorization', session.auth)
      .send({ strategy: 'fewest_stores', lat: BERLIN.lat, lng: BERLIN.lng })
      .expect(200);

    expect(cheapest.body.totalPrice.amountMinor).toBeLessThanOrEqual(
      fewest.body.totalPrice.amountMinor,
    );
  });

  it('defaults to cheapest_total when no strategy is given', async () => {
    const { body } = await http(app)
      .post(`${API}/shopping-lists/${listId}/optimize`)
      .set('Authorization', session.auth)
      .send({ lat: BERLIN.lat, lng: BERLIN.lng })
      .expect(200);
    expect(body.strategy).toBe('cheapest_total');
  });

  it('answers 501 FEATURE_NOT_AVAILABLE for the balanced strategy', async () => {
    const { body } = await http(app)
      .post(`${API}/shopping-lists/${listId}/optimize`)
      .set('Authorization', session.auth)
      .send({ strategy: 'balanced', lat: BERLIN.lat, lng: BERLIN.lng })
      .expect(501);
    expectErrorEnvelope(body, 'FEATURE_NOT_AVAILABLE');
    expect(body.retryable).toBe(false);
  });

  it('reports every item as unavailable far from any store', async () => {
    const { body } = await http(app)
      .post(`${API}/shopping-lists/${listId}/optimize`)
      .set('Authorization', session.auth)
      .send({ lat: MUNICH.lat, lng: MUNICH.lng })
      .expect(200);

    expect(body.stores).toEqual([]);
    expect(body.unavailableItems).toHaveLength(3);
    expect(body.unavailableItems[0].reason).toBe('no_fresh_offer_in_radius');
    expect(body.totalPrice).toEqual({ amountMinor: 0, currencyCode: 'EUR' });
    expect(body.confidence).toBe(0);
  });

  it('answers VALIDATION_FAILED for an empty list', async () => {
    const empty = await http(app)
      .post(`${API}/shopping-lists`)
      .set('Authorization', session.auth)
      .send({ name: 'Leer' })
      .expect(201);

    const { body } = await http(app)
      .post(`${API}/shopping-lists/${empty.body.id}/optimize`)
      .set('Authorization', session.auth)
      .send({ lat: BERLIN.lat, lng: BERLIN.lng })
      .expect(400);
    expectErrorEnvelope(body, 'VALIDATION_FAILED');
  });

  it('answers LOCATION_REQUIRED when coordinates are missing from the body', async () => {
    const { body } = await http(app)
      .post(`${API}/shopping-lists/${listId}/optimize`)
      .set('Authorization', session.auth)
      .send({ strategy: 'cheapest_total' })
      .expect(400);
    expectErrorEnvelope(body, 'LOCATION_REQUIRED');
  });

  it('answers VALIDATION_FAILED when a present coordinate is out of range', async () => {
    const { body } = await http(app)
      .post(`${API}/shopping-lists/${listId}/optimize`)
      .set('Authorization', session.auth)
      .send({ strategy: 'cheapest_total', lat: 123.45, lng: BERLIN.lng })
      .expect(400);
    expectErrorEnvelope(body, 'VALIDATION_FAILED');
  });

  it('answers RESOURCE_NOT_FOUND for an unknown list and 401 without a token', async () => {
    const missing = await http(app)
      .post(`${API}/shopping-lists/00000000-0000-4000-8000-000000000000/optimize`)
      .set('Authorization', session.auth)
      .send({ lat: BERLIN.lat, lng: BERLIN.lng })
      .expect(404);
    expectErrorEnvelope(missing.body, 'RESOURCE_NOT_FOUND');

    const anonymous = await http(app)
      .post(`${API}/shopping-lists/${listId}/optimize`)
      .send({ lat: BERLIN.lat, lng: BERLIN.lng })
      .expect(401);
    expectErrorEnvelope(anonymous.body, 'UNAUTHORIZED');
  });

  describe('GET /capabilities', () => {
    it('returns the five seeded feature booleans', async () => {
      const { body } = await http(app).get(`${API}/capabilities`).expect(200);
      expect(body).toEqual({
        features: {
          priceHistory: true,
          priceAlerts: true,
          shoppingOptimizer: true,
          receiptScanner: false,
          visualProductScan: false,
        },
      });
    });

    it('resolves a scoped flag most-specific-wins from the request headers', async () => {
      // The seed adds visualProductScan = true for DE + ios + >= 2.0.0.
      const old = await http(app)
        .get(`${API}/capabilities`)
        .set('X-App-Platform', 'ios')
        .set('X-App-Version', '1.4.0')
        .expect(200);
      expect(old.body.features.visualProductScan).toBe(false);

      const current = await http(app)
        .get(`${API}/capabilities`)
        .set('X-App-Platform', 'ios')
        .set('X-App-Version', '2.3.1')
        .expect(200);
      expect(current.body.features.visualProductScan).toBe(true);

      const android = await http(app)
        .get(`${API}/capabilities`)
        .set('X-App-Platform', 'android')
        .set('X-App-Version', '2.3.1')
        .expect(200);
      expect(android.body.features.visualProductScan).toBe(false);
    });

    it('is anonymous — no bearer token required', async () => {
      await http(app).get(`${API}/capabilities`).expect(200);
    });
  });
});
