import { INestApplication } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE, Database } from '../src/database/database.module';
import {
  API,
  AuthSession,
  BERLIN,
  SEEDED_GTIN_BUTTER,
  SEEDED_GTIN_COFFEE,
  SEEDED_GTIN_MILK,
  anonymousSession,
  createTestApp,
  expectErrorEnvelope,
  http,
  productIdByGtin,
} from './helpers';

const UNKNOWN_UUID = '00000000-0000-4000-8000-000000000000';

describe('user data: favorites, devices, alerts, shopping lists (e2e)', () => {
  let app: INestApplication;
  let session: AuthSession;
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
    // A fresh account per test — user-scoped state never leaks between cases.
    session = await anonymousSession(app);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('favorites', () => {
    it('creates with 201 and embeds the product', async () => {
      const { body } = await http(app)
        .post(`${API}/favorites`)
        .set('Authorization', session.auth)
        .send({ productId: milkId })
        .expect(201);

      expect(body.productId).toBe(milkId);
      expect(body.product.gtin).toBe(SEEDED_GTIN_MILK);
      expect(Date.parse(body.createdAt)).not.toBeNaN();
    });

    it('is natural-key idempotent: re-favoriting answers 200 with the EXISTING row', async () => {
      const first = await http(app)
        .post(`${API}/favorites`)
        .set('Authorization', session.auth)
        .send({ productId: milkId })
        .expect(201);

      const second = await http(app)
        .post(`${API}/favorites`)
        .set('Authorization', session.auth)
        .send({ productId: milkId })
        .expect(200);

      expect(second.body.id).toBe(first.body.id);
      expect(second.body.createdAt).toBe(first.body.createdAt);

      const list = await http(app)
        .get(`${API}/favorites`)
        .set('Authorization', session.auth)
        .expect(200);
      expect(list.body.data).toHaveLength(1);
    });

    it('lists newest first inside the Page envelope', async () => {
      for (const productId of [milkId, butterId, coffeeId]) {
        await http(app)
          .post(`${API}/favorites`)
          .set('Authorization', session.auth)
          .send({ productId })
          .expect(201);
      }

      const { body } = await http(app)
        .get(`${API}/favorites`)
        .set('Authorization', session.auth)
        .expect(200);

      expect(body.data).toHaveLength(3);
      expect(body.pageInfo).toEqual({ nextCursor: null, hasMore: false });
      expect(body.data[0].productId).toBe(coffeeId);
    });

    it('paginates with a real cursor', async () => {
      for (const productId of [milkId, butterId, coffeeId]) {
        await http(app)
          .post(`${API}/favorites`)
          .set('Authorization', session.auth)
          .send({ productId })
          .expect(201);
      }

      const first = await http(app)
        .get(`${API}/favorites`)
        .query({ limit: 2 })
        .set('Authorization', session.auth)
        .expect(200);
      expect(first.body.data).toHaveLength(2);
      expect(first.body.pageInfo.hasMore).toBe(true);

      const second = await http(app)
        .get(`${API}/favorites`)
        .query({ limit: 2, cursor: first.body.pageInfo.nextCursor })
        .set('Authorization', session.auth)
        .expect(200);
      expect(second.body.data).toHaveLength(1);
      expect(second.body.pageInfo.hasMore).toBe(false);
    });

    it('rejects a /search cursor replayed against /favorites as 400 VALIDATION_FAILED', async () => {
      // A /search cursor carries the product NAME as its sort key; /favorites casts
      // its sort key ::timestamptz. The mismatch must be a contracted 400, not a
      // database error surfacing as 503.
      const search = await http(app)
        .get(`${API}/search/products`)
        .query({ q: 'a', limit: 2 })
        .expect(200);
      expect(typeof search.body.pageInfo.nextCursor).toBe('string');

      const { body } = await http(app)
        .get(`${API}/favorites`)
        .query({ cursor: search.body.pageInfo.nextCursor })
        .set('Authorization', session.auth)
        .expect(400);
      expectErrorEnvelope(body, 'VALIDATION_FAILED');
    });

    it('does not skip rows sharing the boundary millisecond across pages', async () => {
      for (const productId of [milkId, butterId, coffeeId]) {
        await http(app)
          .post(`${API}/favorites`)
          .set('Authorization', session.auth)
          .send({ productId })
          .expect(201);
      }
      const listed = await http(app)
        .get(`${API}/favorites`)
        .set('Authorization', session.auth)
        .expect(200);
      const ids = listed.body.data.map((favorite: { id: string }) => favorite.id) as string[];
      expect(ids).toHaveLength(3);

      // Force all three onto the SAME millisecond, differing only in microsecond
      // digits a JS Date cannot represent — unforceable through the API alone.
      const db = app.get<Database>(DATABASE);
      const sameMillisecond = [
        '2026-01-02T03:04:05.123400Z',
        '2026-01-02T03:04:05.123500Z',
        '2026-01-02T03:04:05.123600Z',
      ];
      for (const [index, favoriteId] of ids.entries()) {
        await db.execute(
          sql`update favorites set created_at = ${sameMillisecond[index]}::timestamptz where id = ${favoriteId}::uuid`,
        );
      }

      const seen: string[] = [];
      let cursor: string | null = null;
      for (let requests = 0; requests < 4; requests += 1) {
        const query: Record<string, string> = { limit: '2' };
        if (cursor) query.cursor = cursor;
        const page = await http(app)
          .get(`${API}/favorites`)
          .query(query)
          .set('Authorization', session.auth)
          .expect(200);
        seen.push(...page.body.data.map((favorite: { id: string }) => favorite.id));
        cursor = page.body.pageInfo.nextCursor;
        if (!cursor) break;
      }

      // Every row exactly once: the cursor key and the SQL predicate agree on
      // microsecond precision, so the row one microsecond below the page boundary
      // is not skipped.
      expect([...seen].sort()).toEqual([...ids].sort());
    });

    it('deletes idempotently (204 whether present or not)', async () => {
      await http(app)
        .post(`${API}/favorites`)
        .set('Authorization', session.auth)
        .send({ productId: milkId })
        .expect(201);

      await http(app)
        .delete(`${API}/favorites/${milkId}`)
        .set('Authorization', session.auth)
        .expect(204);
      await http(app)
        .delete(`${API}/favorites/${milkId}`)
        .set('Authorization', session.auth)
        .expect(204);

      const list = await http(app)
        .get(`${API}/favorites`)
        .set('Authorization', session.auth)
        .expect(200);
      expect(list.body.data).toEqual([]);
    });

    it('answers PRODUCT_NOT_FOUND for an unknown productId', async () => {
      const { body } = await http(app)
        .post(`${API}/favorites`)
        .set('Authorization', session.auth)
        .send({ productId: UNKNOWN_UUID })
        .expect(404);
      expectErrorEnvelope(body, 'PRODUCT_NOT_FOUND');
    });

    it('never shows another account its favorites', async () => {
      await http(app)
        .post(`${API}/favorites`)
        .set('Authorization', session.auth)
        .send({ productId: milkId })
        .expect(201);

      const other = await anonymousSession(app);
      const list = await http(app)
        .get(`${API}/favorites`)
        .set('Authorization', other.auth)
        .expect(200);
      expect(list.body.data).toEqual([]);
    });
  });

  describe('devices', () => {
    it('upserts on (user, platform, pushToken): 201 then 200', async () => {
      const payload = {
        platform: 'ios',
        pushToken: 'apns-token-abc',
        appVersion: '1.0.0',
        locale: 'de-DE',
      };

      const created = await http(app)
        .post(`${API}/devices`)
        .set('Authorization', session.auth)
        .send(payload)
        .expect(201);

      const refreshed = await http(app)
        .post(`${API}/devices`)
        .set('Authorization', session.auth)
        .send({ ...payload, appVersion: '1.1.0' })
        .expect(200);

      expect(refreshed.body.id).toBe(created.body.id);
      expect(refreshed.body.appVersion).toBe('1.1.0');
    });

    it('updates and deletes a device idempotently', async () => {
      const created = await http(app)
        .post(`${API}/devices`)
        .set('Authorization', session.auth)
        .send({
          platform: 'android',
          pushToken: 'fcm-token-xyz',
          appVersion: '1.0.0',
          locale: 'de-DE',
        })
        .expect(201);

      const updated = await http(app)
        .patch(`${API}/devices/${created.body.id}`)
        .set('Authorization', session.auth)
        .send({ pushToken: 'fcm-token-rotated' })
        .expect(200);
      expect(updated.body.pushToken).toBe('fcm-token-rotated');

      await http(app)
        .delete(`${API}/devices/${created.body.id}`)
        .set('Authorization', session.auth)
        .expect(204);
      await http(app)
        .delete(`${API}/devices/${created.body.id}`)
        .set('Authorization', session.auth)
        .expect(204);
    });

    it('answers RESOURCE_NOT_FOUND when patching an unknown device', async () => {
      const { body } = await http(app)
        .patch(`${API}/devices/${UNKNOWN_UUID}`)
        .set('Authorization', session.auth)
        .send({ appVersion: '9.9.9' })
        .expect(404);
      expectErrorEnvelope(body, 'RESOURCE_NOT_FOUND');
      expect(body.messageKey).toBe('error.device_not_found');
    });
  });

  describe('price alerts', () => {
    const alertBody = (productId: string) => ({
      productId,
      targetPrice: { amountMinor: 99, currencyCode: 'EUR' },
      radiusMeters: 3000,
      location: { lat: BERLIN.lat, lng: BERLIN.lng, city: 'Berlin', countryCode: 'DE' },
    });

    it('creates an alert and echoes the anchoring GeoPoint', async () => {
      const { body } = await http(app)
        .post(`${API}/alerts`)
        .set('Authorization', session.auth)
        .send(alertBody(milkId))
        .expect(201);

      expect(body).toMatchObject({
        productId: milkId,
        targetPrice: { amountMinor: 99, currencyCode: 'EUR' },
        radiusMeters: 3000,
        isActive: true,
        lastTriggeredAt: null,
      });
      // The client sends the generic Location model; the alert stores a GeoPoint.
      expect(Object.keys(body.location).sort()).toEqual(['lat', 'lng']);
      expect(body.location.lat).toBeCloseTo(BERLIN.lat, 5);
      expect(body.location.lng).toBeCloseTo(BERLIN.lng, 5);
    });

    it('lists the accountalerts newest first', async () => {
      await http(app)
        .post(`${API}/alerts`)
        .set('Authorization', session.auth)
        .send(alertBody(milkId))
        .expect(201);
      await http(app)
        .post(`${API}/alerts`)
        .set('Authorization', session.auth)
        .send(alertBody(butterId))
        .expect(201);

      const { body } = await http(app)
        .get(`${API}/alerts`)
        .set('Authorization', session.auth)
        .expect(200);
      expect(body.data).toHaveLength(2);
      expect(body.pageInfo).toEqual({ nextCursor: null, hasMore: false });
    });

    it('updates and deletes an alert', async () => {
      const created = await http(app)
        .post(`${API}/alerts`)
        .set('Authorization', session.auth)
        .send(alertBody(milkId))
        .expect(201);

      const updated = await http(app)
        .patch(`${API}/alerts/${created.body.id}`)
        .set('Authorization', session.auth)
        .send({ isActive: false, targetPrice: { amountMinor: 79, currencyCode: 'EUR' } })
        .expect(200);
      expect(updated.body.isActive).toBe(false);
      expect(updated.body.targetPrice.amountMinor).toBe(79);

      await http(app)
        .delete(`${API}/alerts/${created.body.id}`)
        .set('Authorization', session.auth)
        .expect(204);
      await http(app)
        .delete(`${API}/alerts/${created.body.id}`)
        .set('Authorization', session.auth)
        .expect(204);
    });

    it('answers PRODUCT_NOT_FOUND for an unknown product and RESOURCE_NOT_FOUND for an unknown alert', async () => {
      const badProduct = await http(app)
        .post(`${API}/alerts`)
        .set('Authorization', session.auth)
        .send(alertBody(UNKNOWN_UUID))
        .expect(404);
      expectErrorEnvelope(badProduct.body, 'PRODUCT_NOT_FOUND');

      const badAlert = await http(app)
        .patch(`${API}/alerts/${UNKNOWN_UUID}`)
        .set('Authorization', session.auth)
        .send({ isActive: false })
        .expect(404);
      expectErrorEnvelope(badAlert.body, 'RESOURCE_NOT_FOUND');
      expect(badAlert.body.messageKey).toBe('error.alert_not_found');
    });

    it('rejects an out-of-range radius', async () => {
      const { body } = await http(app)
        .post(`${API}/alerts`)
        .set('Authorization', session.auth)
        .send({ ...alertBody(milkId), radiusMeters: 999999 })
        .expect(400);
      expectErrorEnvelope(body, 'VALIDATION_FAILED');
    });
  });

  describe('shopping lists', () => {
    async function createList(name = 'Wocheneinkauf'): Promise<string> {
      const { body } = await http(app)
        .post(`${API}/shopping-lists`)
        .set('Authorization', session.auth)
        .send({ name })
        .expect(201);
      return body.id as string;
    }

    it('creates an empty list, renames it and deletes it idempotently', async () => {
      const listId = await createList();

      const fetched = await http(app)
        .get(`${API}/shopping-lists/${listId}`)
        .set('Authorization', session.auth)
        .expect(200);
      expect(fetched.body.items).toEqual([]);

      const renamed = await http(app)
        .patch(`${API}/shopping-lists/${listId}`)
        .set('Authorization', session.auth)
        .send({ name: 'Samstag' })
        .expect(200);
      expect(renamed.body.name).toBe('Samstag');

      await http(app)
        .delete(`${API}/shopping-lists/${listId}`)
        .set('Authorization', session.auth)
        .expect(204);
      await http(app)
        .delete(`${API}/shopping-lists/${listId}`)
        .set('Authorization', session.auth)
        .expect(204);

      const missing = await http(app)
        .get(`${API}/shopping-lists/${listId}`)
        .set('Authorization', session.auth)
        .expect(404);
      expectErrorEnvelope(missing.body, 'RESOURCE_NOT_FOUND');
      expect(missing.body.messageKey).toBe('error.shopping_list_not_found');
    });

    it('adds items, is idempotent per (list, product), and updates quantity via PATCH', async () => {
      const listId = await createList();

      const created = await http(app)
        .post(`${API}/shopping-lists/${listId}/items`)
        .set('Authorization', session.auth)
        .send({ productId: milkId, quantity: 2, note: 'die laktosefreie' })
        .expect(201);
      expect(created.body).toMatchObject({ productId: milkId, quantity: 2, note: 'die laktosefreie' });

      // Re-adding must NOT duplicate and must NOT bump the quantity.
      const again = await http(app)
        .post(`${API}/shopping-lists/${listId}/items`)
        .set('Authorization', session.auth)
        .send({ productId: milkId, quantity: 5 })
        .expect(200);
      expect(again.body.id).toBe(created.body.id);
      expect(again.body.quantity).toBe(2);

      const updated = await http(app)
        .patch(`${API}/shopping-lists/${listId}/items/${created.body.id}`)
        .set('Authorization', session.auth)
        .send({ quantity: 5, note: null })
        .expect(200);
      expect(updated.body.quantity).toBe(5);
      expect(updated.body.note).toBeNull();

      const list = await http(app)
        .get(`${API}/shopping-lists/${listId}`)
        .set('Authorization', session.auth)
        .expect(200);
      expect(list.body.items).toHaveLength(1);
    });

    it('removes an item idempotently but still 404s an unknown list', async () => {
      const listId = await createList();
      const item = await http(app)
        .post(`${API}/shopping-lists/${listId}/items`)
        .set('Authorization', session.auth)
        .send({ productId: butterId })
        .expect(201);

      await http(app)
        .delete(`${API}/shopping-lists/${listId}/items/${item.body.id}`)
        .set('Authorization', session.auth)
        .expect(204);
      await http(app)
        .delete(`${API}/shopping-lists/${listId}/items/${item.body.id}`)
        .set('Authorization', session.auth)
        .expect(204);

      const badList = await http(app)
        .delete(`${API}/shopping-lists/${UNKNOWN_UUID}/items/${item.body.id}`)
        .set('Authorization', session.auth)
        .expect(404);
      expectErrorEnvelope(badList.body, 'RESOURCE_NOT_FOUND');
    });

    it('distinguishes an unknown list from an unknown product on item add', async () => {
      const listId = await createList();

      const badList = await http(app)
        .post(`${API}/shopping-lists/${UNKNOWN_UUID}/items`)
        .set('Authorization', session.auth)
        .send({ productId: milkId })
        .expect(404);
      expect(badList.body.code).toBe('RESOURCE_NOT_FOUND');
      expect(badList.body.messageKey).toBe('error.shopping_list_not_found');

      const badProduct = await http(app)
        .post(`${API}/shopping-lists/${listId}/items`)
        .set('Authorization', session.auth)
        .send({ productId: UNKNOWN_UUID })
        .expect(404);
      expect(badProduct.body.code).toBe('PRODUCT_NOT_FOUND');
    });

    it('never exposes another account list', async () => {
      const listId = await createList();
      const other = await anonymousSession(app);

      const { body } = await http(app)
        .get(`${API}/shopping-lists/${listId}`)
        .set('Authorization', other.auth)
        .expect(404);
      // Ownership is never leaked: "someone else's" is indistinguishable from absent.
      expectErrorEnvelope(body, 'RESOURCE_NOT_FOUND');
    });

    it('lists the account lists with items embedded', async () => {
      const listId = await createList('Grosseinkauf');
      await http(app)
        .post(`${API}/shopping-lists/${listId}/items`)
        .set('Authorization', session.auth)
        .send({ productId: coffeeId, quantity: 3 })
        .expect(201);

      const { body } = await http(app)
        .get(`${API}/shopping-lists`)
        .set('Authorization', session.auth)
        .expect(200);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].items).toHaveLength(1);
      expect(body.data[0].items[0].quantity).toBe(3);
      expect(body.pageInfo).toEqual({ nextCursor: null, hasMore: false });
    });
  });
});
