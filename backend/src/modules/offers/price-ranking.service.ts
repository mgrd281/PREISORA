import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { DATABASE, Database } from '../../database/database.module';
import { offers, products, promotions } from '../../database/schema';
import { AppConfigService } from '../../config/app-config.service';
import type { StoreRow } from '../retailers/store.mapper';
import { Origin, StoresService } from '../retailers/stores.service';
import { OfferCandidate, PromotionInput, RankedOffer, rankOffers } from './price-ranking';

export interface RankingScope {
  /** Stores inside the radius, distance-annotated, nearest first. */
  storesInRadius: StoreRow[];
  storeIdsInRadiusByMarket: Map<string, string[]>;
  /** Ranked offers per requested productId (products with none are absent). */
  offersByProduct: Map<string, RankedOffer[]>;
}

/**
 * Turns database rows into ranked offers. All the actual decision-making lives in
 * the pure `price-ranking.ts` module; this class only assembles its inputs.
 */
@Injectable()
export class PriceRankingService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly stores: StoresService,
    private readonly config: AppConfigService,
  ) {}

  async rankForProduct(
    productId: string,
    origin: Origin,
    radiusMeters: number,
    now: Date = new Date(),
  ): Promise<{ offers: RankedOffer[]; scope: RankingScope }> {
    const scope = await this.rankForProducts([productId], origin, radiusMeters, now);
    return { offers: scope.offersByProduct.get(productId) ?? [], scope };
  }

  async rankForProducts(
    productIds: string[],
    origin: Origin,
    radiusMeters: number,
    now: Date = new Date(),
    storeLimit = this.config.pricing.geoResultLimit,
  ): Promise<RankingScope> {
    const storesInRadius = await this.stores.findNear(origin, radiusMeters, storeLimit);

    const storeIdsInRadiusByMarket = new Map<string, string[]>();
    for (const store of storesInRadius) {
      const list = storeIdsInRadiusByMarket.get(store.retailerMarketId) ?? [];
      list.push(store.id);
      storeIdsInRadiusByMarket.set(store.retailerMarketId, list);
    }

    const empty: RankingScope = {
      storesInRadius,
      storeIdsInRadiusByMarket,
      offersByProduct: new Map(),
    };
    if (productIds.length === 0 || storesInRadius.length === 0) return empty;

    const storeIds = storesInRadius.map((s) => s.id);
    const marketIds = [...storeIdsInRadiusByMarket.keys()];
    const storesById = new Map(storesInRadius.map((s) => [s.id, s]));

    const rows = await this.db
      .select({
        id: offers.id,
        productId: offers.productId,
        retailerMarketId: offers.retailerMarketId,
        storeId: offers.storeId,
        priceAmountMinor: offers.priceAmountMinor,
        currencyCode: offers.currencyCode,
        observedAt: offers.observedAt,
        validFrom: offers.validFrom,
        validUntil: offers.validUntil,
        unitPriceDivisor: sql<string | null>`${products.unitPriceDivisor}`,
        unitPriceQuantityText: products.unitPriceQuantityText,
        promotionId: promotions.id,
        promotionType: promotions.type,
        promotionPercentOff: promotions.percentOff,
        promotionAmountOffMinor: promotions.amountOffMinor,
        promotionAmountOffCurrency: promotions.amountOffCurrencyCode,
        promotionRequiresLoyaltyCard: promotions.requiresLoyaltyCard,
        promotionStartsAt: promotions.startsAt,
        promotionEndsAt: promotions.endsAt,
      })
      .from(offers)
      .innerJoin(products, eq(products.id, offers.productId))
      .leftJoin(promotions, eq(promotions.id, offers.promotionId))
      .where(
        and(
          inArray(offers.productId, productIds),
          // Store-specific offers must be inside the radius; market-wide offers ride
          // on their market having any store in the radius at all.
          or(
            inArray(offers.storeId, storeIds),
            and(isNull(offers.storeId), inArray(offers.retailerMarketId, marketIds)),
          ),
        ),
      );

    const candidatesByProduct = new Map<string, OfferCandidate[]>();
    for (const row of rows) {
      const promotion: PromotionInput | null =
        row.promotionId && row.promotionType
          ? {
              id: row.promotionId,
              type: row.promotionType,
              percentOff: row.promotionPercentOff,
              amountOffMinor: row.promotionAmountOffMinor,
              amountOffCurrencyCode: row.promotionAmountOffCurrency,
              requiresLoyaltyCard: row.promotionRequiresLoyaltyCard ?? false,
              startsAt: row.promotionStartsAt,
              endsAt: row.promotionEndsAt,
            }
          : null;

      const candidate: OfferCandidate = {
        id: row.id,
        productId: row.productId,
        retailerMarketId: row.retailerMarketId,
        storeId: row.storeId,
        priceAmountMinor: Number(row.priceAmountMinor),
        currencyCode: row.currencyCode,
        observedAt: row.observedAt,
        validFrom: row.validFrom,
        validUntil: row.validUntil,
        promotion,
        store: row.storeId ? (storesById.get(row.storeId) ?? null) : null,
        unitPriceDivisor: row.unitPriceDivisor === null ? null : Number(row.unitPriceDivisor),
        unitPriceQuantityText: row.unitPriceQuantityText,
      };

      const list = candidatesByProduct.get(row.productId) ?? [];
      list.push(candidate);
      candidatesByProduct.set(row.productId, list);
    }

    const offersByProduct = new Map<string, RankedOffer[]>();
    for (const [productId, candidates] of candidatesByProduct) {
      offersByProduct.set(
        productId,
        rankOffers(candidates, {
          now,
          maxPriceAgeHours: this.config.pricing.maxPriceAgeHours,
          storeIdsInRadiusByMarket,
        }),
      );
    }

    return { storesInRadius, storeIdsInRadiusByMarket, offersByProduct };
  }
}
