import type { RequestContext } from '../../common/context/request-context';
import { AppException } from '../../common/errors/app-exception';
import { RedisCacheService } from '../../common/redis/redis-cache.service';
import { AppConfigService } from '../../config/app-config.service';
import { buildConfig } from '../../config/configuration';
import type { Database } from '../../database/database.module';
import type { ProductRow } from './product.mapper';
import { ProductsService } from './products.service';
import type { ProductProvider, ProviderProduct } from './providers/product-provider.interface';

const CTX: RequestContext = {
  countryCode: 'DE',
  currencyCode: 'EUR',
  locale: 'de-DE',
  timezone: 'Europe/Berlin',
  platform: 'ios',
  appVersion: '1.0.0',
  userId: null,
  cohort: null,
};

const GTIN = '4008400402222';

function row(overrides: Partial<ProductRow> = {}): ProductRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    gtin: GTIN,
    slug: 'ferrero-nutella-500g',
    name: 'Nutella',
    brand: 'Ferrero',
    quantityText: '500g',
    images: [{ url: 'https://images.example/front.400.jpg', widthPx: 269, heightPx: 400 }],
    countryCode: 'DE',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

const DISCOVERED: ProviderProduct = {
  gtin: GTIN,
  name: 'Nutella',
  brand: 'Ferrero',
  quantityText: '500g',
  images: [{ url: 'https://images.example/front.400.jpg', widthPx: 269, heightPx: 400 }],
  source: 'openfoodfacts',
  sourceRef: GTIN,
};

/**
 * A drizzle stand-in that answers each `select(...)` from a queue and records every
 * `insert(...)`. Deliberately hand-rolled: the point of these tests is the CHAIN
 * (cache -> catalogue -> provider -> persist), not drizzle's SQL generation, which the
 * e2e suite exercises against a real PostgreSQL.
 */
function fakeDb(options: { selects: ProductRow[][]; inserted?: ProductRow[] }) {
  const selects = [...options.selects];
  const insertedRows = [...(options.inserted ?? [])];
  const values: Record<string, unknown>[] = [];

  const db = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => selects.shift() ?? [] }),
      }),
    }),
    insert: () => ({
      values: (value: Record<string, unknown>) => {
        values.push(value);
        return {
          onConflictDoNothing: () => ({
            returning: async () => {
              const next = insertedRows.shift();
              return next ? [next] : [];
            },
          }),
        };
      },
    }),
  } as unknown as Database;

  return { db, values, remainingSelects: () => selects.length };
}

function fakeCache(initial: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(initial));
  const service = {
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
    del: jest.fn(async (key: string) => {
      store.delete(key);
    }),
  } as unknown as RedisCacheService;
  return { cache: service, store };
}

function config(): AppConfigService {
  const built = buildConfig({ NODE_ENV: 'development' } as NodeJS.ProcessEnv);
  return new AppConfigService({ get: () => built } as never);
}

function stubProvider(
  lookup: ProductProvider['lookupByGtin'],
): ProductProvider & { lookupByGtin: jest.Mock } {
  return { source: 'openfoodfacts', lookupByGtin: jest.fn(lookup) } as never;
}

const NEVER_CALLED = stubProvider(async () => {
  throw new Error('the provider must not be consulted');
});

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof AppException ? error.code : `unexpected: ${String(error)}`;
  }
  return 'no error thrown';
}

describe('ProductsService.getByGtin lookup chain', () => {
  it('rejects an invalid GTIN before ANY cache, database or provider access', async () => {
    const { db } = fakeDb({ selects: [] });
    const { cache } = fakeCache();
    const service = new ProductsService(db, cache, config(), NEVER_CALLED);

    // 4008400402223 has a wrong check digit.
    expect(await codeOf(service.getByGtin('4008400402223', CTX))).toBe('INVALID_GTIN');
    expect(cache.get).not.toHaveBeenCalled();
    expect(NEVER_CALLED.lookupByGtin).not.toHaveBeenCalled();
  });

  it('serves a cache HIT without touching the database or the provider', async () => {
    const { db } = fakeDb({ selects: [] });
    const cached = { id: 'cached', gtin: GTIN };
    const { cache } = fakeCache({ [`product:gtin:${GTIN}`]: cached });
    const service = new ProductsService(db, cache, config(), NEVER_CALLED);

    expect(await service.getByGtin(GTIN, CTX)).toEqual(cached);
    expect(NEVER_CALLED.lookupByGtin).not.toHaveBeenCalled();
  });

  it('serves a local catalogue HIT and caches it, without consulting the provider', async () => {
    const { db } = fakeDb({ selects: [[row()]] });
    const { cache, store } = fakeCache();
    const service = new ProductsService(db, cache, config(), NEVER_CALLED);

    const dto = await service.getByGtin(GTIN, CTX);
    expect(dto.name).toBe('Nutella');
    expect(dto.images).toHaveLength(1);
    expect(store.get(`product:gtin:${GTIN}`)).toEqual(dto);
    expect(NEVER_CALLED.lookupByGtin).not.toHaveBeenCalled();
  });

  describe('provider HIT', () => {
    it('persists the discovered product with provenance and market context', async () => {
      const persisted = row({ id: '22222222-2222-4222-8222-222222222222' });
      const { db, values } = fakeDb({ selects: [[]], inserted: [persisted] });
      const { cache, store } = fakeCache();
      const provider = stubProvider(async () => DISCOVERED);
      const service = new ProductsService(db, cache, config(), provider);

      const dto = await service.getByGtin(GTIN, CTX);

      expect(dto.id).toBe(persisted.id);
      expect(dto.images).toEqual([
        { url: 'https://images.example/front.400.jpg', widthPx: 269, heightPx: 400 },
      ]);
      expect(values).toHaveLength(1);
      expect(values[0]).toMatchObject({
        gtin: GTIN,
        slug: 'ferrero-nutella-500g',
        name: 'Nutella',
        brand: 'Ferrero',
        quantityText: '500g',
        // From the request context, never a literal (§24).
        countryCode: CTX.countryCode,
        source: 'openfoodfacts',
        sourceRef: GTIN,
      });
      expect(values[0].sourceSyncedAt).toBeInstanceOf(Date);
      // The next scan of this barcode is a cache hit, not another provider call.
      expect(store.get(`product:gtin:${GTIN}`)).toEqual(dto);
      expect(provider.lookupByGtin).toHaveBeenCalledWith(GTIN, CTX);
    });

    it('walks to the next slug candidate when the preferred one is taken', async () => {
      const persisted = row({ slug: 'ferrero-nutella-500g-402222' });
      let attempt = 0;
      const { db } = fakeDb({ selects: [[]] });
      const slugs: string[] = [];
      (db as unknown as { insert: unknown }).insert = () => ({
        values: (value: Record<string, unknown>) => {
          slugs.push(value.slug as string);
          return {
            onConflictDoNothing: () => ({
              returning: async () => {
                attempt += 1;
                if (attempt === 1) {
                  throw Object.assign(new Error('duplicate key'), {
                    code: '23505',
                    constraint: 'products_slug_key',
                  });
                }
                return [persisted];
              },
            }),
          };
        },
      });
      const { cache } = fakeCache();
      const service = new ProductsService(db, cache, config(), stubProvider(async () => DISCOVERED));

      const dto = await service.getByGtin(GTIN, CTX);
      expect(dto.slug).toBe('ferrero-nutella-500g-402222');
      expect(slugs).toEqual(['ferrero-nutella-500g', 'ferrero-nutella-500g-402222']);
    });

    it('returns the winner when a concurrent scan inserted the same GTIN first', async () => {
      const winner = row({ id: '33333333-3333-4333-8333-333333333333' });
      // First select: catalogue miss. Second select: the re-read after the no-op insert.
      const { db } = fakeDb({ selects: [[], [winner]], inserted: [] });
      const { cache } = fakeCache();
      const service = new ProductsService(db, cache, config(), stubProvider(async () => DISCOVERED));

      expect((await service.getByGtin(GTIN, CTX)).id).toBe(winner.id);
    });

    it('ignores a provider result with a blank name', async () => {
      const { db } = fakeDb({ selects: [[]] });
      const { cache } = fakeCache();
      const provider = stubProvider(async () => ({ ...DISCOVERED, name: '   ' }));
      const service = new ProductsService(db, cache, config(), provider);

      expect(await codeOf(service.getByGtin(GTIN, CTX))).toBe('PRODUCT_NOT_FOUND');
    });
  });

  describe('provider FAILURE is never a 5xx', () => {
    it('maps a timeout to PRODUCT_NOT_FOUND', async () => {
      const { db } = fakeDb({ selects: [[]] });
      const { cache } = fakeCache();
      const provider = stubProvider(async () => {
        throw Object.assign(new Error('The operation was aborted due to timeout'), {
          name: 'TimeoutError',
        });
      });
      const service = new ProductsService(db, cache, config(), provider);

      expect(await codeOf(service.getByGtin(GTIN, CTX))).toBe('PRODUCT_NOT_FOUND');
    });

    it('maps a thrown upstream failure to PRODUCT_NOT_FOUND and leaks nothing', async () => {
      const { db } = fakeDb({ selects: [[]] });
      const { cache } = fakeCache();
      const provider = stubProvider(async () => {
        throw new Error('502 Bad Gateway <html>upstream detail</html>');
      });
      const service = new ProductsService(db, cache, config(), provider);

      try {
        await service.getByGtin(GTIN, CTX);
        throw new Error('expected PRODUCT_NOT_FOUND');
      } catch (error) {
        const exception = error as AppException;
        expect(exception).toBeInstanceOf(AppException);
        expect(exception.code).toBe('PRODUCT_NOT_FOUND');
        expect(exception.httpStatus).toBe(404);
        expect(JSON.stringify(exception.envelope)).not.toContain('upstream detail');
      }
    });

    it('caches the MISS so a rescanned unknown barcode does not hit the provider again', async () => {
      const { db } = fakeDb({ selects: [[], []] });
      const { cache, store } = fakeCache();
      const provider = stubProvider(async () => null);
      const service = new ProductsService(db, cache, config(), provider);

      expect(await codeOf(service.getByGtin(GTIN, CTX))).toBe('PRODUCT_NOT_FOUND');
      expect(store.get(`product:gtin:miss:${GTIN}`)).toBe(1);

      expect(await codeOf(service.getByGtin(GTIN, CTX))).toBe('PRODUCT_NOT_FOUND');
      expect(provider.lookupByGtin).toHaveBeenCalledTimes(1);
    });
  });
});
