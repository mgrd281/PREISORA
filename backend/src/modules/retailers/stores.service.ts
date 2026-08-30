import { Inject, Injectable } from '@nestjs/common';
import { SQL, eq, inArray, sql } from 'drizzle-orm';
import { AppException } from '../../common/errors/app-exception';
import { DATABASE, Database } from '../../database/database.module';
import { stores } from '../../database/schema';
import { StoreRow } from './store.mapper';

export interface Origin {
  lat: number;
  lng: number;
}

/** `ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography` — note the lng/lat order. */
function originPoint(origin: Origin): SQL {
  return sql`ST_SetSRID(ST_MakePoint(${origin.lng}, ${origin.lat}), 4326)::geography`;
}

@Injectable()
export class StoresService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  private baseColumns(distance: SQL<number> | SQL<null>) {
    return {
      id: stores.id,
      retailerMarketId: stores.retailerMarketId,
      name: stores.name,
      // Geometry cast is required: ST_X/ST_Y are geometry accessors.
      lat: sql<number>`ST_Y(${stores.location}::geometry)`,
      lng: sql<number>`ST_X(${stores.location}::geometry)`,
      street: stores.street,
      postalCode: stores.postalCode,
      city: stores.city,
      countryCode: stores.countryCode,
      openingHours: stores.openingHours,
      distanceMeters: distance,
    };
  }

  /**
   * Radius-bounded, distance-ordered store search. `ST_DWithin` on a geography
   * column with the GIST index is an index scan, not a table scan.
   */
  async findNear(origin: Origin, radiusMeters: number, limit: number): Promise<StoreRow[]> {
    const point = originPoint(origin);
    const distance = sql<number>`ST_Distance(${stores.location}, ${point})`;
    const rows = await this.db
      .select(this.baseColumns(distance))
      .from(stores)
      .where(sql`ST_DWithin(${stores.location}, ${point}, ${radiusMeters})`)
      .orderBy(sql`ST_Distance(${stores.location}, ${point}) ASC`, stores.id)
      .limit(limit);
    return rows as StoreRow[];
  }

  /** Same radius filter, restricted to one market's stores (used by the optimizer). */
  async findNearByMarkets(
    origin: Origin,
    radiusMeters: number,
    marketIds: string[],
    limit: number,
  ): Promise<StoreRow[]> {
    if (marketIds.length === 0) return [];
    const point = originPoint(origin);
    const distance = sql<number>`ST_Distance(${stores.location}, ${point})`;
    const rows = await this.db
      .select(this.baseColumns(distance))
      .from(stores)
      .where(
        sql`ST_DWithin(${stores.location}, ${point}, ${radiusMeters}) AND ${inArray(
          stores.retailerMarketId,
          marketIds,
        )}`,
      )
      .orderBy(sql`ST_Distance(${stores.location}, ${point}) ASC`, stores.id)
      .limit(limit);
    return rows as StoreRow[];
  }

  /** Single-store lookup. No query location, so `distanceMeters` is `null`. */
  async getById(storeId: string): Promise<StoreRow> {
    const [row] = await this.db
      .select(this.baseColumns(sql<null>`NULL::double precision`))
      .from(stores)
      .where(eq(stores.id, storeId))
      .limit(1);
    if (!row) throw AppException.resourceNotFound('store');
    return row as StoreRow;
  }
}
