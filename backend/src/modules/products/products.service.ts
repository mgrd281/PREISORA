import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { ProductDto } from '../../common/api/schemas';
import type { RequestContext } from '../../common/context/request-context';
import { AppException } from '../../common/errors/app-exception';
import { parseGtinOrThrow } from '../../common/gtin/gtin';
import { RedisCacheService } from '../../common/redis/redis-cache.service';
import { AppConfigService } from '../../config/app-config.service';
import { DATABASE, Database } from '../../database/database.module';
import { products } from '../../database/schema';
import { ProductRow, toProductDto } from './product.mapper';
import { buildSlugCandidates } from './product-slug';
import {
  PRODUCT_PROVIDER,
  ProductProvider,
  ProviderProduct,
} from './providers/product-provider.interface';

const PRODUCT_COLUMNS = {
  id: products.id,
  gtin: products.gtin,
  slug: products.slug,
  name: products.name,
  brand: products.brand,
  quantityText: products.quantityText,
  images: products.images,
  countryCode: products.countryCode,
  createdAt: products.createdAt,
  updatedAt: products.updatedAt,
} as const;

/** PostgreSQL `unique_violation`. */
const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown, constraint: string): boolean {
  const candidate = error as { code?: unknown; constraint?: unknown } | null;
  return candidate?.code === UNIQUE_VIOLATION && candidate?.constraint === constraint;
}

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly cache: RedisCacheService,
    private readonly config: AppConfigService,
    @Inject(PRODUCT_PROVIDER) private readonly provider: ProductProvider,
  ) {}

  async getById(productId: string): Promise<ProductDto> {
    const row = await this.findById(productId);
    if (!row) throw AppException.productNotFound({ productId });
    return toProductDto(row);
  }

  /** Used by favorites/alerts/list items to validate a referenced `productId`. */
  async findById(productId: string): Promise<ProductRow | null> {
    const [row] = await this.db
      .select(PRODUCT_COLUMNS)
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    return row ?? null;
  }

  async assertExists(productId: string): Promise<void> {
    const row = await this.findById(productId);
    if (!row) throw AppException.productNotFound({ productId });
  }

  /**
   * The barcode-scan entry point, and the whole lookup chain:
   *
   *   validate GTIN -> Redis -> local catalogue -> provider -> persist -> return
   *
   * Checksum validation happens BEFORE any I/O (contract: `INVALID_GTIN` can never be
   * a database or network round trip). Both halves of the Redis layer matter
   * (constitution §35): the positive cache absorbs a scan storm on the same barcode,
   * and the negative cache stops a repeatedly-scanned UNKNOWN barcode from hammering
   * the provider.
   *
   * A discovered product is persisted with NO offers. `GET /products/{id}/offers`
   * answering `NO_CURRENT_PRICES` for it is the honest answer, not a gap.
   */
  async getByGtin(rawGtin: string, ctx: RequestContext): Promise<ProductDto> {
    const gtin = parseGtinOrThrow(rawGtin);
    const cacheKey = `product:gtin:${gtin}`;
    const missKey = `product:gtin:miss:${gtin}`;

    const cached = await this.cache.get<ProductDto>(cacheKey);
    if (cached) return cached;

    const known = await this.findByGtin(gtin);
    if (known) return this.cacheAndReturn(cacheKey, known);

    // Checked AFTER the catalogue read on purpose: a barcode that was unknown a minute
    // ago may have just been seeded, and a negative cache entry must never hide it.
    if (await this.cache.get<number>(missKey)) throw AppException.productNotFound({ gtin });

    const discovered = await this.lookup(gtin, ctx);
    if (!discovered) {
      await this.cache.set(missKey, 1, this.config.productProvider.negativeCacheTtlSeconds);
      throw AppException.productNotFound({ gtin });
    }

    const row = await this.persistDiscovered(discovered, ctx);
    return this.cacheAndReturn(cacheKey, row);
  }

  async getBySlug(slug: string): Promise<ProductDto> {
    const [row] = await this.db
      .select(PRODUCT_COLUMNS)
      .from(products)
      .where(eq(products.slug, slug))
      .limit(1);
    if (!row) throw AppException.productNotFound({ slug });
    return toProductDto(row);
  }

  private async findByGtin(gtin: string): Promise<ProductRow | null> {
    const [row] = await this.db
      .select(PRODUCT_COLUMNS)
      .from(products)
      .where(eq(products.gtin, gtin))
      .limit(1);
    return row ?? null;
  }

  private async cacheAndReturn(cacheKey: string, row: ProductRow): Promise<ProductDto> {
    const dto = toProductDto(row);
    await this.cache.set(cacheKey, dto, this.config.pricing.gtinCacheTtlSeconds);
    return dto;
  }

  /**
   * Belt AND braces around the provider seam. The interface already forbids throwing,
   * but a provider is third-party-shaped code on the scan funnel: whatever it does —
   * throw, reject, time out — the answer here is "no product", never a 5xx.
   */
  private async lookup(gtin: string, ctx: RequestContext): Promise<ProviderProduct | null> {
    try {
      const result = await this.provider.lookupByGtin(gtin, ctx);
      return result && result.name.trim() !== '' ? result : null;
    } catch (error) {
      this.logger.warn(
        `product provider lookup failed for ${gtin}: ${
          error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error'
        }`,
      );
      return null;
    }
  }

  /**
   * Inserts a discovered product, walking the deterministic slug candidates until one
   * is free. `countryCode` comes from the request context, never from a literal (§24).
   *
   * Two races are handled rather than surfaced: another request inserting the same
   * GTIN first (we re-read and return its row), and an unrelated product already
   * owning the preferred slug (we try the next candidate).
   */
  private async persistDiscovered(
    discovered: ProviderProduct,
    ctx: RequestContext,
  ): Promise<ProductRow> {
    const candidates = buildSlugCandidates({
      brand: discovered.brand,
      name: discovered.name,
      quantityText: discovered.quantityText,
      gtin: discovered.gtin,
    });

    for (const slug of candidates) {
      try {
        const [row] = await this.db
          .insert(products)
          .values({
            gtin: discovered.gtin,
            slug,
            name: discovered.name,
            brand: discovered.brand,
            quantityText: discovered.quantityText,
            images: discovered.images,
            countryCode: ctx.countryCode,
            source: discovered.source,
            sourceRef: discovered.sourceRef,
            sourceSyncedAt: new Date(),
          })
          .onConflictDoNothing({ target: products.gtin })
          .returning(PRODUCT_COLUMNS);

        // No row back => the GTIN already existed (concurrent scan of the same barcode).
        if (row) return row;
        const existing = await this.findByGtin(discovered.gtin);
        if (existing) return existing;
      } catch (error) {
        if (!isUniqueViolation(error, 'products_slug_key')) throw error;
        // Another product owns this slug; fall through to the next candidate. The last
        // candidate embeds the full GTIN, so the loop always terminates on a free slug.
      }
    }

    // Unreachable unless the GTIN-suffixed candidate collided, which a UNIQUE gtin
    // makes impossible; failing loudly here beats returning a fabricated row.
    throw new Error(`could not allocate a slug for gtin ${discovered.gtin}`);
  }
}
