import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Module,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { and, desc, eq, sql } from 'drizzle-orm';
import { Response } from 'express';
import type { FavoriteCreateRequestDto, FavoriteDto, FavoritePageDto } from '../../common/api/schemas';
import { decodeCursor } from '../../common/pagination/cursor';
import { AppException } from '../../common/errors/app-exception';
import { cursorPage } from '../../common/pagination/page';
import { ParseUuidPipe } from '../../common/validation/uuid.pipe';
import { DATABASE, Database } from '../../database/database.module';
import { favorites, products } from '../../database/schema';
import { CurrentUserId } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProductRow, toProductDto } from '../products/product.mapper';
import { ProductsModule } from '../products/products.module';
import { ProductsService } from '../products/products.service';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export class FavoriteCreateDto implements FavoriteCreateRequestDto {
  @IsUUID()
  productId!: string;
}

interface FavoriteRow extends ProductRow {
  favoriteId: string;
  favoriteCreatedAt: Date;
  /** Full-microsecond ISO text of `favoriteCreatedAt` — the keyset cursor key. */
  favoriteCreatedAtCursor: string;
}

function toFavoriteDto(row: FavoriteRow): FavoriteDto {
  return {
    id: row.favoriteId,
    productId: row.id,
    product: toProductDto(row),
    createdAt: row.favoriteCreatedAt.toISOString(),
  };
}

@Injectable()
export class FavoritesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly productsService: ProductsService,
  ) {}

  private columns() {
    return {
      favoriteId: favorites.id,
      favoriteCreatedAt: favorites.createdAt,
      // The cursor key needs the FULL microsecond precision of the column: a JS
      // `Date` truncates to milliseconds, and a truncated key in the `<` predicate
      // would skip rows sharing the boundary millisecond across pages.
      favoriteCreatedAtCursor: sql<string>`to_char(${favorites.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
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
    };
  }

  /**
   * Newest first. The contract accepts cursor/limit here; the cursor is a
   * `(createdAt, id)` keyset so paging stays stable while new favorites arrive.
   */
  async list(userId: string, rawCursor: unknown, rawLimit: unknown): Promise<FavoritePageDto> {
    let limit = DEFAULT_LIMIT;
    if (rawLimit !== undefined && rawLimit !== null && String(rawLimit).trim() !== '') {
      const parsed = Number(rawLimit);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
        throw new AppException('VALIDATION_FAILED', { field: 'limit', min: 1, max: MAX_LIMIT });
      }
      limit = parsed;
    }
    const cursor =
      typeof rawCursor === 'string' && rawCursor.trim() !== ''
        ? // The sort key is cast `::timestamptz` below, so its shape must be
          // validated here — a foreign cursor must fail as 400, not as a SQL error.
          decodeCursor(rawCursor, { sortKey: 'timestamp' })
        : null;

    const after = cursor
      ? sql` AND (${favorites.createdAt}, ${favorites.id}) < (${cursor.sortKey}::timestamptz, ${cursor.id}::uuid)`
      : sql``;

    const rows = (await this.db
      .select(this.columns())
      .from(favorites)
      .innerJoin(products, eq(products.id, favorites.productId))
      .where(sql`${eq(favorites.userId, userId)}${after}`)
      .orderBy(desc(favorites.createdAt), desc(favorites.id))
      .limit(limit + 1)) as FavoriteRow[];

    const page = cursorPage(rows, limit, (row) => ({
      sortKey: row.favoriteCreatedAtCursor,
      id: row.favoriteId,
    }));
    return { data: page.data.map(toFavoriteDto), pageInfo: page.pageInfo };
  }

  /**
   * Natural-key idempotent (unique per user+product): re-favoriting answers 200 with
   * the EXISTING row — never an error, never a duplicate (CONVENTIONS.md).
   */
  async add(userId: string, productId: string): Promise<{ favorite: FavoriteDto; created: boolean }> {
    await this.productsService.assertExists(productId);

    const [existing] = (await this.db
      .select(this.columns())
      .from(favorites)
      .innerJoin(products, eq(products.id, favorites.productId))
      .where(and(eq(favorites.userId, userId), eq(favorites.productId, productId)))
      .limit(1)) as FavoriteRow[];

    if (existing) return { favorite: toFavoriteDto(existing), created: false };

    await this.db.insert(favorites).values({ userId, productId });

    const [created] = (await this.db
      .select(this.columns())
      .from(favorites)
      .innerJoin(products, eq(products.id, favorites.productId))
      .where(and(eq(favorites.userId, userId), eq(favorites.productId, productId)))
      .limit(1)) as FavoriteRow[];

    return { favorite: toFavoriteDto(created), created: true };
  }

  async remove(userId: string, productId: string): Promise<void> {
    await this.db
      .delete(favorites)
      .where(and(eq(favorites.userId, userId), eq(favorites.productId, productId)));
  }
}

@Controller('favorites')
@UseGuards(JwtAuthGuard)
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Get()
  listFavorites(
    @CurrentUserId() userId: string,
    @Query() query: Record<string, unknown>,
  ): Promise<FavoritePageDto> {
    return this.favoritesService.list(userId, query.cursor, query.limit);
  }

  @Post()
  async addFavorite(
    @CurrentUserId() userId: string,
    @Body() body: FavoriteCreateDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<FavoriteDto> {
    const { favorite, created } = await this.favoritesService.add(userId, body.productId);
    res.status(created ? 201 : 200);
    return favorite;
  }

  @Delete(':productId')
  @HttpCode(204)
  removeFavorite(
    @CurrentUserId() userId: string,
    @Param('productId', ParseUuidPipe) productId: string,
  ): Promise<void> {
    return this.favoritesService.remove(userId, productId);
  }
}

@Module({
  imports: [ProductsModule],
  controllers: [FavoritesController],
  providers: [FavoritesService],
})
export class FavoritesModule {}
