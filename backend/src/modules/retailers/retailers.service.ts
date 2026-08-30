import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, inArray } from 'drizzle-orm';
import type { RetailerWithMarketsDto } from '../../common/api/schemas';
import { AppException } from '../../common/errors/app-exception';
import { DATABASE, Database } from '../../database/database.module';
import { retailerMarkets, retailers } from '../../database/schema';

@Injectable()
export class RetailersService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** The whole catalog with markets embedded — clients resolve `retailerMarketId`
   * on every Offer and Store without an extra round trip (CONVENTIONS.md). */
  async listAll(): Promise<RetailerWithMarketsDto[]> {
    const retailerRows = await this.db
      .select({ id: retailers.id, name: retailers.name, slug: retailers.slug })
      .from(retailers)
      .orderBy(asc(retailers.name));
    if (retailerRows.length === 0) return [];

    const marketRows = await this.db
      .select()
      .from(retailerMarkets)
      .where(
        inArray(
          retailerMarkets.retailerId,
          retailerRows.map((r) => r.id),
        ),
      )
      .orderBy(asc(retailerMarkets.countryCode));

    return retailerRows.map((retailer) => ({
      id: retailer.id,
      name: retailer.name,
      slug: retailer.slug,
      markets: marketRows
        .filter((m) => m.retailerId === retailer.id)
        .map((m) => ({
          id: m.id,
          retailerId: m.retailerId,
          countryCode: m.countryCode.trim(),
          currencyCode: m.currencyCode.trim(),
          displayName: m.displayName,
        })),
    }));
  }

  async getById(retailerId: string): Promise<RetailerWithMarketsDto> {
    const [retailer] = await this.db
      .select({ id: retailers.id, name: retailers.name, slug: retailers.slug })
      .from(retailers)
      .where(eq(retailers.id, retailerId))
      .limit(1);
    if (!retailer) throw AppException.resourceNotFound('retailer');

    const marketRows = await this.db
      .select()
      .from(retailerMarkets)
      .where(eq(retailerMarkets.retailerId, retailerId))
      .orderBy(asc(retailerMarkets.countryCode));

    return {
      id: retailer.id,
      name: retailer.name,
      slug: retailer.slug,
      markets: marketRows.map((m) => ({
        id: m.id,
        retailerId: m.retailerId,
        countryCode: m.countryCode.trim(),
        currencyCode: m.currencyCode.trim(),
        displayName: m.displayName,
      })),
    };
  }
}
