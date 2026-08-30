import { Injectable } from '@nestjs/common';
import type { OptimizationResultDto } from '../../common/api/schemas';
import { AppException } from '../../common/errors/app-exception';
import { AppConfigService } from '../../config/app-config.service';
import { money, toOfferDto } from '../offers/offer.mapper';
import type { RankedOffer } from '../offers/price-ranking';
import { PriceRankingService } from '../offers/price-ranking.service';
import { toStoreDto } from '../retailers/store.mapper';
import { OptimizerItem, OptimizerStrategy, optimize } from './optimize';

/** `cheapest_total` splits across at most three stores (orchestrator decision #7). */
const MAX_STORES_PER_PLAN = 3;
/** Bounds the exhaustive combination search: C(15,3) + C(15,2) + 15 = 575 plans. */
const MAX_CANDIDATE_STORES = 15;

@Injectable()
export class OptimizerService {
  constructor(
    private readonly ranking: PriceRankingService,
    private readonly config: AppConfigService,
  ) {}

  async optimizeList(
    items: OptimizerItem[],
    input: {
      strategy: OptimizerStrategy;
      lat: number;
      lng: number;
      radiusMeters: number;
      fallbackCurrencyCode: string;
    },
    now: Date = new Date(),
  ): Promise<OptimizationResultDto> {
    if (input.strategy === 'balanced') {
      // Part of the canonical wire enum, deliberately not implemented yet.
      throw AppException.notImplemented('optimizer.balanced');
    }
    if (items.length === 0) {
      throw new AppException('VALIDATION_FAILED', { reason: 'empty_shopping_list' });
    }

    const scope = await this.ranking.rankForProducts(
      items.map((item) => item.productId),
      { lat: input.lat, lng: input.lng },
      input.radiusMeters,
      now,
      MAX_CANDIDATE_STORES,
    );

    // Expand ranked offers into a store x product matrix. A store-specific offer wins;
    // otherwise the store inherits its market's market-wide price.
    const priceMatrix = new Map<string, Map<string, RankedOffer>>();
    for (const store of scope.storesInRadius) {
      const byProduct = new Map<string, RankedOffer>();
      for (const [productId, ranked] of scope.offersByProduct) {
        const fresh = ranked.filter((offer) => offer.freshness === 'fresh');
        const specific = fresh.find((offer) => offer.storeId === store.id);
        const marketWide = fresh.find(
          (offer) => offer.storeId === null && offer.retailerMarketId === store.retailerMarketId,
        );
        const chosen = specific ?? marketWide;
        if (chosen) byProduct.set(productId, chosen);
      }
      if (byProduct.size > 0) priceMatrix.set(store.id, byProduct);
    }

    const plan = optimize({
      items,
      stores: scope.storesInRadius.map((store) => ({
        id: store.id,
        distanceMeters: store.distanceMeters,
      })),
      priceMatrix,
      strategy: input.strategy,
      now,
      maxPriceAgeHours: this.config.pricing.maxPriceAgeHours,
      maxStores: MAX_STORES_PER_PLAN,
      maxCandidateStores: MAX_CANDIDATE_STORES,
    });

    const storesById = new Map(scope.storesInRadius.map((store) => [store.id, store]));
    const currencyCode = plan.currencyCode ?? input.fallbackCurrencyCode;

    return {
      strategy: plan.strategy,
      totalPrice: money(plan.totalMinor, currencyCode),
      estimatedSavings: money(plan.savingsMinor, currencyCode),
      confidence: plan.confidence,
      stores: plan.stores.map((planned) => {
        const store = storesById.get(planned.storeId);
        if (!store) throw AppException.resourceNotFound('store');
        return {
          store: toStoreDto(store),
          items: planned.items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            offer: toOfferDto(item.offer),
          })),
          subtotal: money(planned.subtotalMinor, currencyCode),
        };
      }),
      unavailableItems: plan.unavailable,
    };
  }
}
