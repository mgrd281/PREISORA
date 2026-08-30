import { INestApplication } from '@nestjs/common';
import {
  API,
  BERLIN,
  MUNICH,
  SEEDED_GTIN_MILK,
  createTestApp,
  expectErrorEnvelope,
  http,
  productIdByGtin,
} from './helpers';

/**
 * The core funnel of the product: scan -> product -> geo-ranked offers -> history,
 * plus every error the funnel can produce (constitution §31 checklist).
 */
describe('scan journey (e2e)', () => {
  let app: INestApplication;
  let milkId: string;

  beforeAll(async () => {
    app = await createTestApp();
    milkId = await productIdByGtin(app, SEEDED_GTIN_MILK);
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health reports ok with a timestamp', async () => {
    const { body } = await http(app).get(`${API}/health`).expect(200);
    expect(body.status).toBe('ok');
    expect(Date.parse(body.timestamp)).not.toBeNaN();
  });

  it('resolves a scanned GTIN to a product (happy path)', async () => {
    const { body } = await http(app)
      .get(`${API}/products/by-gtin/${SEEDED_GTIN_MILK}`)
      .expect(200);

    expect(body).toMatchObject({
      gtin: SEEDED_GTIN_MILK,
      slug: 'vollmilch-3-5-1l',
      name: 'Vollmilch 3,5%',
      countryCode: 'DE',
    });
    // Contract-required fields must be present even when null.
    expect(body).toHaveProperty('brand');
    expect(body).toHaveProperty('quantityText');
    expect(body).toHaveProperty('images');
    expect(Object.keys(body).sort()).toEqual(
      [
        'brand',
        'countryCode',
        'createdAt',
        'gtin',
        'images',
        'id',
        'name',
        'quantityText',
        'slug',
        'updatedAt',
      ].sort(),
    );
  });

  it('serves the same product from the read-through cache on a second scan', async () => {
    const first = await http(app).get(`${API}/products/by-gtin/${SEEDED_GTIN_MILK}`).expect(200);
    const second = await http(app).get(`${API}/products/by-gtin/${SEEDED_GTIN_MILK}`).expect(200);
    expect(second.body).toEqual(first.body);
  });

  it('rejects a bad check digit with 400 INVALID_GTIN before any lookup', async () => {
    const { body } = await http(app).get(`${API}/products/by-gtin/4012345000017`).expect(400);
    expectErrorEnvelope(body, 'INVALID_GTIN');
    expect(body.details).toMatchObject({ reason: 'checksum' });
  });

  it('rejects a malformed GTIN with 400 INVALID_GTIN', async () => {
    const { body } = await http(app).get(`${API}/products/by-gtin/12345`).expect(400);
    expectErrorEnvelope(body, 'INVALID_GTIN');
  });

  it('answers 404 PRODUCT_NOT_FOUND for a valid but unknown GTIN', async () => {
    // 4099999000005 is a checksum-valid EAN-13 that the seed does not contain.
    const { body } = await http(app).get(`${API}/products/by-gtin/4099999000005`).expect(404);
    expectErrorEnvelope(body, 'PRODUCT_NOT_FOUND');
  });

  it('answers 404 PRODUCT_NOT_FOUND for an unknown product UUID', async () => {
    const { body } = await http(app)
      .get(`${API}/products/00000000-0000-4000-8000-000000000000`)
      .expect(404);
    expectErrorEnvelope(body, 'PRODUCT_NOT_FOUND');
  });

  it('answers 400 VALIDATION_FAILED for a malformed product id', async () => {
    const { body } = await http(app).get(`${API}/products/not-a-uuid`).expect(400);
    expectErrorEnvelope(body, 'VALIDATION_FAILED');
  });

  it('resolves a product by slug', async () => {
    const { body } = await http(app).get(`${API}/products/by-slug/vollmilch-3-5-1l`).expect(200);
    expect(body.id).toBe(milkId);
  });

  it('returns geo-ranked offers with distanceMeters and exactly one isBest', async () => {
    const { body } = await http(app)
      .get(`${API}/products/${milkId}/offers`)
      .query({ lat: BERLIN.lat, lng: BERLIN.lng, radiusMeters: 5000 })
      .expect(200);

    expect(body.pageInfo).toEqual({ nextCursor: null, hasMore: false });
    expect(body.data.length).toBeGreaterThan(1);
    expect(body.data.length).toBeLessThanOrEqual(50);

    const best = body.data.filter((offer: { isBest: boolean }) => offer.isBest);
    expect(best).toHaveLength(1);
    expect(best[0]).toBe(body.data[0]);

    // Server-computed intelligence must be present on every offer.
    for (const offer of body.data) {
      expect(offer.freshness).toBe('fresh');
      expect(offer.price.currencyCode).toBe('EUR');
      expect(Number.isInteger(offer.price.amountMinor)).toBe(true);
      expect(Number.isInteger(offer.effectivePrice.amountMinor)).toBe(true);
      expect(offer).toHaveProperty('unitPrice');
      expect(offer).toHaveProperty('promotion');
      if (offer.storeId === null) {
        expect(offer.store).toBeNull();
        expect(offer.distanceMeters).toBeNull();
      } else {
        expect(offer.store.id).toBe(offer.storeId);
        expect(Number.isInteger(offer.distanceMeters)).toBe(true);
        expect(offer.distanceMeters).toBeLessThanOrEqual(5000);
      }
    }

    // Ascending by effective price — this is the whole point of the endpoint.
    const prices = body.data.map((offer: { effectivePrice: { amountMinor: number } }) =>
      Number(offer.effectivePrice.amountMinor),
    );
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
  });

  it('applies the seeded promotion to effectivePrice', async () => {
    const nutellaId = await productIdByGtin(app, '4012345000030');
    const { body } = await http(app)
      .get(`${API}/products/${nutellaId}/offers`)
      .query({ lat: BERLIN.lat, lng: BERLIN.lng })
      .expect(200);

    const promoted = body.data.find(
      (offer: { promotion: unknown }) => offer.promotion !== null,
    );
    expect(promoted).toBeDefined();
    expect(promoted.promotion.type).toBe('percentage');
    expect(promoted.promotion.percentOff).toBe(20);
    expect(promoted.effectivePrice.amountMinor).toBe(
      Math.round((promoted.price.amountMinor * 80) / 100),
    );
    expect(promoted.effectivePrice.amountMinor).toBeLessThan(promoted.price.amountMinor);
  });

  it('answers 400 LOCATION_REQUIRED when lat/lng are missing', async () => {
    const { body } = await http(app).get(`${API}/products/${milkId}/offers`).expect(400);
    expectErrorEnvelope(body, 'LOCATION_REQUIRED');
    expect(body.details).toMatchObject({ required: ['lat', 'lng'] });
  });

  it('answers 400 VALIDATION_FAILED for an out-of-range radius', async () => {
    const { body } = await http(app)
      .get(`${API}/products/${milkId}/offers`)
      .query({ lat: BERLIN.lat, lng: BERLIN.lng, radiusMeters: 999999 })
      .expect(400);
    expectErrorEnvelope(body, 'VALIDATION_FAILED');
  });

  it('answers 404 NO_CURRENT_PRICES when no fresh offer is inside the radius', async () => {
    const { body } = await http(app)
      .get(`${API}/products/${milkId}/offers`)
      .query({ lat: MUNICH.lat, lng: MUNICH.lng, radiusMeters: 5000 })
      .expect(404);

    expectErrorEnvelope(body, 'NO_CURRENT_PRICES');
    expect(body.details).toMatchObject({
      productId: milkId,
      radiusMeters: 5000,
      freshnessWindowHours: 72,
    });
  });

  it('prefers LOCATION_REQUIRED over PRODUCT_NOT_FOUND', async () => {
    const { body } = await http(app)
      .get(`${API}/products/00000000-0000-4000-8000-000000000000/offers`)
      .expect(400);
    expectErrorEnvelope(body, 'LOCATION_REQUIRED');
  });

  it('returns daily min/avg price history in integer minor units', async () => {
    const { body } = await http(app)
      .get(`${API}/products/${milkId}/price-history`)
      .query({ range: '30d' })
      .expect(200);

    expect(body.productId).toBe(milkId);
    expect(body.range).toBe('30d');
    expect(body.points.length).toBeGreaterThan(20);

    for (const point of body.points) {
      expect(point.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isInteger(point.minAmountMinor)).toBe(true);
      expect(Number.isInteger(point.avgAmountMinor)).toBe(true);
      expect(point.minAmountMinor).toBeLessThanOrEqual(point.avgAmountMinor);
      expect(point.currencyCode).toBe('EUR');
    }

    const dates = body.points.map((p: { date: string }) => p.date);
    expect([...dates].sort()).toEqual(dates);
  });

  it('defaults the history range to 30d and honours 7d', async () => {
    const defaulted = await http(app).get(`${API}/products/${milkId}/price-history`).expect(200);
    expect(defaulted.body.range).toBe('30d');

    const week = await http(app)
      .get(`${API}/products/${milkId}/price-history`)
      .query({ range: '7d' })
      .expect(200);
    expect(week.body.range).toBe('7d');
    expect(week.body.points.length).toBeLessThan(defaulted.body.points.length);
  });

  it('rejects an unknown history range with VALIDATION_FAILED', async () => {
    const { body } = await http(app)
      .get(`${API}/products/${milkId}/price-history`)
      .query({ range: '365d' })
      .expect(400);
    expectErrorEnvelope(body, 'VALIDATION_FAILED');
  });

  it('echoes the applied locale in Content-Language', async () => {
    const response = await http(app)
      .get(`${API}/products/by-gtin/${SEEDED_GTIN_MILK}`)
      .set('Accept-Language', 'de-DE,de;q=0.9')
      .expect(200);
    expect(response.headers['content-language']).toBe('de-DE');
  });

  it('answers an unmatched route with RESOURCE_NOT_FOUND, never PRODUCT_NOT_FOUND', async () => {
    const { body } = await http(app).get(`${API}/nope`).expect(404);
    expectErrorEnvelope(body, 'RESOURCE_NOT_FOUND');
  });
});
