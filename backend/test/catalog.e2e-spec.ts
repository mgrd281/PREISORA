import { INestApplication } from '@nestjs/common';
import { API, BERLIN, MUNICH, createTestApp, expectErrorEnvelope, http } from './helpers';

describe('catalog: stores, retailers, search (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /stores', () => {
    it('returns nearest-first stores inside the radius with distanceMeters', async () => {
      const { body } = await http(app)
        .get(`${API}/stores`)
        .query({ lat: BERLIN.lat, lng: BERLIN.lng, radiusMeters: 5000 })
        .expect(200);

      expect(body.pageInfo).toEqual({ nextCursor: null, hasMore: false });
      expect(body.data.length).toBeGreaterThan(3);
      expect(body.data.length).toBeLessThanOrEqual(50);

      const distances = body.data.map((store: { distanceMeters: number }) => store.distanceMeters);
      expect([...distances].sort((a, b) => a - b)).toEqual(distances);
      expect(Math.max(...distances)).toBeLessThanOrEqual(5000);

      for (const store of body.data) {
        expect(store.address).toMatchObject({ city: 'Berlin', countryCode: 'DE' });
        expect(typeof store.lat).toBe('number');
        expect(typeof store.lng).toBe('number');
        expect(Number.isInteger(store.distanceMeters)).toBe(true);
        expect(store).toHaveProperty('openingHours');
      }
    });

    it('honours the radius: a smaller radius returns fewer stores', async () => {
      const wide = await http(app)
        .get(`${API}/stores`)
        .query({ lat: BERLIN.lat, lng: BERLIN.lng, radiusMeters: 8000 })
        .expect(200);
      const narrow = await http(app)
        .get(`${API}/stores`)
        .query({ lat: BERLIN.lat, lng: BERLIN.lng, radiusMeters: 1000 })
        .expect(200);
      expect(narrow.body.data.length).toBeLessThan(wide.body.data.length);
    });

    it('returns an empty page far from every store', async () => {
      const { body } = await http(app)
        .get(`${API}/stores`)
        .query({ lat: MUNICH.lat, lng: MUNICH.lng })
        .expect(200);
      expect(body.data).toEqual([]);
      expect(body.pageInfo).toEqual({ nextCursor: null, hasMore: false });
    });

    it('answers LOCATION_REQUIRED without coordinates', async () => {
      const { body } = await http(app).get(`${API}/stores`).expect(400);
      expectErrorEnvelope(body, 'LOCATION_REQUIRED');
    });

    it('serves a single store with distanceMeters null (no query location)', async () => {
      const list = await http(app)
        .get(`${API}/stores`)
        .query({ lat: BERLIN.lat, lng: BERLIN.lng })
        .expect(200);
      const storeId = list.body.data[0].id;

      const { body } = await http(app).get(`${API}/stores/${storeId}`).expect(200);
      expect(body.id).toBe(storeId);
      expect(body.distanceMeters).toBeNull();
    });

    it('answers RESOURCE_NOT_FOUND (not PRODUCT_NOT_FOUND) for an unknown store', async () => {
      const { body } = await http(app)
        .get(`${API}/stores/00000000-0000-4000-8000-000000000000`)
        .expect(404);
      expectErrorEnvelope(body, 'RESOURCE_NOT_FOUND');
      expect(body.messageKey).toBe('error.store_not_found');
      expect(body.details).toEqual({ resource: 'store' });
    });
  });

  describe('GET /retailers', () => {
    it('returns the three demo retailers with their DE markets embedded', async () => {
      const { body } = await http(app).get(`${API}/retailers`).expect(200);
      expect(body.data).toHaveLength(3);
      expect(body.data.map((r: { name: string }) => r.name)).toEqual([
        'Kaufrausch',
        'Marktfrisch',
        'PreisPilot',
      ]);
      for (const retailer of body.data) {
        expect(retailer.markets).toHaveLength(1);
        expect(retailer.markets[0]).toMatchObject({
          retailerId: retailer.id,
          countryCode: 'DE',
          currencyCode: 'EUR',
        });
      }
    });

    it('serves one retailer by id and 404s an unknown one', async () => {
      const list = await http(app).get(`${API}/retailers`).expect(200);
      const retailerId = list.body.data[0].id;

      const { body } = await http(app).get(`${API}/retailers/${retailerId}`).expect(200);
      expect(body.id).toBe(retailerId);
      expect(body.markets.length).toBeGreaterThan(0);

      const missing = await http(app)
        .get(`${API}/retailers/00000000-0000-4000-8000-000000000000`)
        .expect(404);
      expectErrorEnvelope(missing.body, 'RESOURCE_NOT_FOUND');
      expect(missing.body.messageKey).toBe('error.retailer_not_found');
    });
  });

  describe('GET /search/products (real cursor pagination)', () => {
    it('walks two pages with a real (name, id) cursor and no overlap', async () => {
      const first = await http(app)
        .get(`${API}/search/products`)
        .query({ q: 'a', limit: 2 })
        .expect(200);

      expect(first.body.data).toHaveLength(2);
      expect(first.body.pageInfo.hasMore).toBe(true);
      expect(typeof first.body.pageInfo.nextCursor).toBe('string');

      const second = await http(app)
        .get(`${API}/search/products`)
        .query({ q: 'a', limit: 2, cursor: first.body.pageInfo.nextCursor })
        .expect(200);

      expect(second.body.data.length).toBeGreaterThan(0);

      const firstIds = first.body.data.map((p: { id: string }) => p.id);
      const secondIds = second.body.data.map((p: { id: string }) => p.id);
      expect(firstIds.filter((id: string) => secondIds.includes(id))).toEqual([]);

      // The cursor is a keyset, so page 2 continues strictly after page 1.
      const lastOfFirst = first.body.data[first.body.data.length - 1].name;
      expect(second.body.data[0].name >= lastOfFirst).toBe(true);
    });

    it('reaches the end of the sequence with nextCursor null', async () => {
      let cursor: string | null = null;
      const seen = new Set<string>();
      for (let page = 0; page < 20; page += 1) {
        const query: Record<string, unknown> = { q: 'a', limit: 2 };
        if (cursor) query.cursor = cursor;
        const response = await http(app).get(`${API}/search/products`).query(query).expect(200);
        for (const product of response.body.data) seen.add(product.id);
        cursor = response.body.pageInfo.nextCursor;
        if (!cursor) {
          expect(response.body.pageInfo.hasMore).toBe(false);
          break;
        }
      }
      expect(cursor).toBeNull();
      expect(seen.size).toBeGreaterThanOrEqual(4);
    });

    it('matches on brand as well as name', async () => {
      const { body } = await http(app)
        .get(`${API}/search/products`)
        .query({ q: 'vollmilch' })
        .expect(200);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].slug).toBe('vollmilch-3-5-1l');
    });

    it('returns an empty page for a query nothing matches', async () => {
      const { body } = await http(app)
        .get(`${API}/search/products`)
        .query({ q: 'zzzzzzzzzz' })
        .expect(200);
      expect(body.data).toEqual([]);
      expect(body.pageInfo).toEqual({ nextCursor: null, hasMore: false });
    });

    const badQueries: Array<[string, Record<string, unknown>]> = [
      ['missing q', {}],
      ['empty q', { q: '' }],
      ['limit too small', { q: 'a', limit: 0 }],
      ['limit too large', { q: 'a', limit: 500 }],
      ['malformed cursor', { q: 'a', cursor: 'not-a-cursor' }],
    ];

    it.each(badQueries)('answers VALIDATION_FAILED for %s', async (_label, query) => {
      const { body } = await http(app).get(`${API}/search/products`).query(query).expect(400);
      expectErrorEnvelope(body, 'VALIDATION_FAILED');
    });
  });
});
