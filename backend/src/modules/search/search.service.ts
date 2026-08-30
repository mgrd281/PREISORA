import { Inject, Injectable } from '@nestjs/common';
import { asc, sql } from 'drizzle-orm';
import type { ProductPageDto } from '../../common/api/schemas';
import { AppException } from '../../common/errors/app-exception';
import { decodeCursor } from '../../common/pagination/cursor';
import { cursorPage } from '../../common/pagination/page';
import { DATABASE, Database } from '../../database/database.module';
import { products } from '../../database/schema';
import { ProductRow, toProductDto } from '../products/product.mapper';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

@Injectable()
export class SearchService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Trigram/ILIKE search with a REAL `(name, id)` composite cursor from day 1
   * (ADR-0002). The engine is deliberately unremarkable — the contract is
   * engine-agnostic and swapping in a real search backend stays additive.
   */
  async searchProducts(
    rawQuery: unknown,
    rawCursor: unknown,
    rawLimit: unknown,
  ): Promise<ProductPageDto> {
    const q = typeof rawQuery === 'string' ? rawQuery.trim() : '';
    if (q.length < 1 || q.length > 200) {
      throw new AppException('VALIDATION_FAILED', { field: 'q' });
    }

    let limit = DEFAULT_LIMIT;
    if (rawLimit !== undefined && rawLimit !== null && String(rawLimit).trim() !== '') {
      const parsed = Number(rawLimit);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
        throw new AppException('VALIDATION_FAILED', { field: 'limit', min: 1, max: MAX_LIMIT });
      }
      limit = parsed;
    }

    const cursor =
      typeof rawCursor === 'string' && rawCursor.trim() !== '' ? decodeCursor(rawCursor) : null;

    const pattern = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const matches = sql`(${products.name} ILIKE ${pattern} OR ${products.brand} ILIKE ${pattern})`;
    // Keyset predicate: strictly after (name, id) of the last row of the previous page.
    const afterCursor = cursor
      ? sql` AND (${products.name}, ${products.id}) > (${cursor.sortKey}, ${cursor.id}::uuid)`
      : sql``;

    const rows = (await this.db
      .select({
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
      })
      .from(products)
      .where(sql`${matches}${afterCursor}`)
      .orderBy(asc(products.name), asc(products.id))
      .limit(limit + 1)) as ProductRow[];

    const page = cursorPage(rows, limit, (row) => ({ sortKey: row.name, id: row.id }));
    return { data: page.data.map(toProductDto), pageInfo: page.pageInfo };
  }
}
