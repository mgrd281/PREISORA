import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { ProductDto } from '../../common/api/schemas';
import { AppException } from '../../common/errors/app-exception';
import { parseGtinOrThrow } from '../../common/gtin/gtin';
import { RedisCacheService } from '../../common/redis/redis-cache.service';
import { AppConfigService } from '../../config/app-config.service';
import { DATABASE, Database } from '../../database/database.module';
import { products } from '../../database/schema';
import { ProductRow, toProductDto } from './product.mapper';

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

@Injectable()
export class ProductsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly cache: RedisCacheService,
    private readonly config: AppConfigService,
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
   * The barcode-scan entry point. Checksum validation happens BEFORE any database
   * access (contract), and the lookup is Redis read-through cached with a short TTL
   * (constitution §35) because a scan storm hits the same few GTINs.
   */
  async getByGtin(rawGtin: string): Promise<ProductDto> {
    const gtin = parseGtinOrThrow(rawGtin);
    const cacheKey = `product:gtin:${gtin}`;

    const cached = await this.cache.get<ProductDto>(cacheKey);
    if (cached) return cached;

    const [row] = await this.db
      .select(PRODUCT_COLUMNS)
      .from(products)
      .where(eq(products.gtin, gtin))
      .limit(1);

    if (!row) throw AppException.productNotFound({ gtin });

    const dto = toProductDto(row);
    await this.cache.set(cacheKey, dto, this.config.pricing.gtinCacheTtlSeconds);
    return dto;
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
}
