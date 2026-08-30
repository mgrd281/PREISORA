import { Controller, Get, Param, Query } from '@nestjs/common';
import type { OfferPageDto, PriceHistoryDto } from '../../common/api/schemas';
import { AppException } from '../../common/errors/app-exception';
import { parseGeoQuery } from '../../common/geo/geo-query.dto';
import { wholePage } from '../../common/pagination/page';
import { ParseUuidPipe } from '../../common/validation/uuid.pipe';
import { AppConfigService } from '../../config/app-config.service';
import { ProductsService } from '../products/products.service';
import { toOfferDto } from './offer.mapper';
import { PriceHistoryService } from './price-history.service';
import { hasFreshOffer } from './price-ranking';
import { PriceRankingService } from './price-ranking.service';

/** Price intelligence hangs off the product resource (orchestrator decision #4). */
@Controller('products/:productId')
export class OffersController {
  constructor(
    private readonly ranking: PriceRankingService,
    private readonly history: PriceHistoryService,
    private readonly productsService: ProductsService,
    private readonly config: AppConfigService,
  ) {}

  @Get('offers')
  async listProductOffers(
    @Param('productId', ParseUuidPipe) productId: string,
    @Query() query: Record<string, unknown>,
  ): Promise<OfferPageDto> {
    // LOCATION_REQUIRED must win over PRODUCT_NOT_FOUND: the client cannot act on a
    // 404 it caused by not sending a location.
    const geo = parseGeoQuery(query, this.config.pricing);
    await this.productsService.assertExists(productId);

    const { offers } = await this.ranking.rankForProduct(
      productId,
      { lat: geo.lat, lng: geo.lng },
      geo.radiusMeters,
    );

    if (!hasFreshOffer(offers)) {
      // Deliberate 404 (CONVENTIONS.md "NO_CURRENT_PRICES as 404").
      throw new AppException('NO_CURRENT_PRICES', {
        productId,
        radiusMeters: geo.radiusMeters,
        freshnessWindowHours: this.config.pricing.maxPriceAgeHours,
      });
    }

    const capped = offers.slice(0, this.config.pricing.geoResultLimit);
    return wholePage(capped.map(toOfferDto));
  }

  @Get('price-history')
  async getProductPriceHistory(
    @Param('productId', ParseUuidPipe) productId: string,
    @Query('range') range: string | undefined,
  ): Promise<PriceHistoryDto> {
    const parsedRange = PriceHistoryService.parseRange(range);
    await this.productsService.assertExists(productId);
    return this.history.getHistory(productId, parsedRange);
  }
}
