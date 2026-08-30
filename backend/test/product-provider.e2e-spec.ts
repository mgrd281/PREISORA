import { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Client } from 'pg';
import { normalizeOffProduct } from '../src/modules/products/providers/openfoodfacts/openfoodfacts.normalizer';
import type { OffProductResponse } from '../src/modules/products/providers/openfoodfacts/openfoodfacts.types';
import {
  PRODUCT_PROVIDER,
  ProductProvider,
  ProviderProduct,
} from '../src/modules/products/providers/product-provider.interface';
import { API, BERLIN, createTestApp, expectErrorEnvelope, http } from './helpers';

/** A real barcode that is deliberately NOT in the fictional seed catalogue. */
const DISCOVERABLE_GTIN = '4008400402222';
/** Valid check digit, and nothing anywhere knows it. */
const UNKNOWN_GTIN = '4099999000005';

/** Every field the frozen `Product` contract defines - and nothing else. */
const PRODUCT_FIELDS = [
  'brand',
  'countryCode',
  'createdAt',
  'gtin',
  'id',
  'images',
  'name',
  'quantityText',
  'slug',
  'updatedAt',
];

function recordedNutella(locale = 'de-DE'): ProviderProduct {
  const payload = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, 'fixtures/openfoodfacts/nutella-4008400402222.json'),
      'utf8',
    ),
  ) as OffProductResponse;
  const product = normalizeOffProduct(payload, {
    gtin: DISCOVERABLE_GTIN,
    locale,
    source: 'openfoodfacts',
  });
  if (!product) throw new Error('fixture should normalize');
  return product;
}

/**
 * Replays a RECORDED Open Food Facts payload through the real normalizer. The HTTP
 * call is the only thing stubbed, so this proves the production chain end to end
 * without a byte of third-party traffic.
 */
class RecordedProvider implements ProductProvider {
  readonly source = 'openfoodfacts' as const;
  calls: string[] = [];

  async lookupByGtin(gtin: string): Promise<ProviderProduct | null> {
    this.calls.push(gtin);
    return gtin === DISCOVERABLE_GTIN ? recordedNutella() : null;
  }
}

describe('product provider (e2e)', () => {
  describe('with the provider DISABLED (the test default)', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await createTestApp();
    });

    afterAll(async () => {
      await app.close();
    });

    it('leaves an unknown-but-valid GTIN at PRODUCT_NOT_FOUND', async () => {
      const { body } = await http(app).get(`${API}/products/by-gtin/${UNKNOWN_GTIN}`).expect(404);
      expectErrorEnvelope(body, 'PRODUCT_NOT_FOUND');
    });

    it('does not discover a real barcode either - no test touches the network', async () => {
      const { body } = await http(app)
        .get(`${API}/products/by-gtin/${DISCOVERABLE_GTIN}`)
        .expect(404);
      expectErrorEnvelope(body, 'PRODUCT_NOT_FOUND');
    });

    it('still rejects a bad check digit before anything else', async () => {
      const { body } = await http(app).get(`${API}/products/by-gtin/4008400402223`).expect(400);
      expectErrorEnvelope(body, 'INVALID_GTIN');
    });
  });

  describe('with a stubbed provider injected', () => {
    let app: INestApplication;
    let provider: RecordedProvider;

    beforeAll(async () => {
      // The block above deliberately asked for this barcode with the provider off, which
      // left a NEGATIVE cache entry behind. Clearing it is what a real deployment gets
      // for free by TTL; here it keeps the two blocks independent.
      const redis = new Redis(process.env.REDIS_URL as string);
      try {
        await redis.del(`product:gtin:miss:${DISCOVERABLE_GTIN}`);
      } finally {
        redis.disconnect();
      }

      provider = new RecordedProvider();
      app = await createTestApp((builder) =>
        builder.overrideProvider(PRODUCT_PROVIDER).useValue(provider),
      );
    });

    afterAll(async () => {
      await app.close();
    });

    it('discovers, persists and returns a product with contract-shaped images', async () => {
      const { body } = await http(app)
        .get(`${API}/products/by-gtin/${DISCOVERABLE_GTIN}`)
        .expect(200);

      // The contract is frozen: provenance stays server-side.
      expect(Object.keys(body).sort()).toEqual(PRODUCT_FIELDS);
      expect(body).toMatchObject({
        gtin: DISCOVERABLE_GTIN,
        name: 'Nutella',
        brand: 'Ferrero',
        quantityText: '500g',
        slug: 'ferrero-nutella-500g',
        countryCode: 'DE',
      });
      expect(body.id).toMatch(/^[0-9a-f-]{36}$/);

      expect(Array.isArray(body.images)).toBe(true);
      expect(body.images.length).toBeGreaterThan(0);
      for (const image of body.images) {
        expect(Object.keys(image).sort()).toEqual(['heightPx', 'url', 'widthPx']);
        expect(image.url).toMatch(/^https:\/\//);
        expect(Number.isInteger(image.widthPx)).toBe(true);
        expect(Number.isInteger(image.heightPx)).toBe(true);
      }
    });

    it('answers the SAME persisted product on a rescan, without asking again', async () => {
      const first = await http(app).get(`${API}/products/by-gtin/${DISCOVERABLE_GTIN}`).expect(200);
      const second = await http(app).get(`${API}/products/by-gtin/${DISCOVERABLE_GTIN}`).expect(200);

      expect(second.body.id).toBe(first.body.id);
      // Exactly one provider call across every request in this describe block.
      expect(provider.calls.filter((gtin) => gtin === DISCOVERABLE_GTIN)).toHaveLength(1);
    });

    it('records provenance in the database but never on the wire', async () => {
      const client = new Client({ connectionString: process.env.DATABASE_URL });
      await client.connect();
      try {
        const { rows } = await client.query(
          'SELECT source, source_ref, source_synced_at FROM products WHERE gtin = $1',
          [DISCOVERABLE_GTIN],
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].source).toBe('openfoodfacts');
        expect(rows[0].source_ref).toBe(DISCOVERABLE_GTIN);
        expect(rows[0].source_synced_at).toBeInstanceOf(Date);

        const seeded = await client.query("SELECT count(*)::int AS n FROM products WHERE source = 'seed'");
        expect(seeded.rows[0].n).toBeGreaterThan(0);
      } finally {
        await client.end();
      }
    });

    it('answers NO_CURRENT_PRICES for the discovered product - it has no offers, honestly', async () => {
      const { body: product } = await http(app)
        .get(`${API}/products/by-gtin/${DISCOVERABLE_GTIN}`)
        .expect(200);

      const { body } = await http(app)
        .get(`${API}/products/${product.id}/offers`)
        .query({ lat: BERLIN.lat, lng: BERLIN.lng, radiusMeters: 5000 })
        .expect(404);
      expectErrorEnvelope(body, 'NO_CURRENT_PRICES');
    });

    it('is still PRODUCT_NOT_FOUND when the provider has nothing', async () => {
      const { body } = await http(app).get(`${API}/products/by-gtin/${UNKNOWN_GTIN}`).expect(404);
      expectErrorEnvelope(body, 'PRODUCT_NOT_FOUND');
    });
  });

  describe('with a provider that always fails', () => {
    let app: INestApplication;

    beforeAll(async () => {
      const exploding: ProductProvider = {
        source: 'openfoodfacts',
        lookupByGtin: async () => {
          throw Object.assign(new Error('connect ETIMEDOUT'), { name: 'TimeoutError' });
        },
      };
      app = await createTestApp((builder) =>
        builder.overrideProvider(PRODUCT_PROVIDER).useValue(exploding),
      );
    });

    afterAll(async () => {
      await app.close();
    });

    it('degrades to 404, never 5xx', async () => {
      const { body } = await http(app).get(`${API}/products/by-gtin/4014400900002`).expect(404);
      expectErrorEnvelope(body, 'PRODUCT_NOT_FOUND');
    });
  });
});
