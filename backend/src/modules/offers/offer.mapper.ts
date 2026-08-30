import type { MoneyDto, OfferDto, PromotionDto } from '../../common/api/schemas';
import { toStoreDto } from '../retailers/store.mapper';
import type { PromotionInput, RankedOffer } from './price-ranking';

export function money(amountMinor: number, currencyCode: string): MoneyDto {
  return { amountMinor, currencyCode: currencyCode.trim() };
}

function toPromotionDto(promotion: PromotionInput): PromotionDto {
  return {
    id: promotion.id,
    type: promotion.type,
    percentOff: promotion.percentOff,
    amountOff:
      promotion.amountOffMinor === null
        ? null
        : money(promotion.amountOffMinor, promotion.amountOffCurrencyCode ?? ''),
    requiresLoyaltyCard: promotion.requiresLoyaltyCard,
    startsAt: promotion.startsAt ? promotion.startsAt.toISOString() : null,
    endsAt: promotion.endsAt ? promotion.endsAt.toISOString() : null,
  };
}

/**
 * Ranked offer -> wire. Everything the client sees as "intelligence" (`isBest`,
 * `freshness`, `effectivePrice`) was computed server-side before this point.
 */
export function toOfferDto(offer: RankedOffer): OfferDto {
  return {
    id: offer.id,
    productId: offer.productId,
    retailerMarketId: offer.retailerMarketId,
    storeId: offer.storeId,
    price: money(offer.priceAmountMinor, offer.currencyCode),
    unitPrice:
      offer.unitPriceAmountMinor === null
        ? null
        : money(offer.unitPriceAmountMinor, offer.currencyCode),
    unitPriceQuantityText: offer.unitPriceQuantityText,
    isBest: offer.isBest,
    freshness: offer.freshness,
    observedAt: offer.observedAt.toISOString(),
    validFrom: offer.validFrom ? offer.validFrom.toISOString() : null,
    validUntil: offer.validUntil ? offer.validUntil.toISOString() : null,
    promotion: offer.activePromotion ? toPromotionDto(offer.activePromotion) : null,
    effectivePrice: money(offer.effectiveAmountMinor, offer.currencyCode),
    store: offer.store ? toStoreDto(offer.store) : null,
    distanceMeters: offer.distanceMeters,
  };
}
