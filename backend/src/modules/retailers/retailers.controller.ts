import { Controller, Get, Param, Query } from '@nestjs/common';
import type { RetailerPageDto, StoreDto, StorePageDto } from '../../common/api/schemas';
import { parseGeoQuery } from '../../common/geo/geo-query.dto';
import { wholePage } from '../../common/pagination/page';
import { ParseUuidPipe } from '../../common/validation/uuid.pipe';
import { AppConfigService } from '../../config/app-config.service';
import { RetailersService } from './retailers.service';
import { toStoreDto } from './store.mapper';
import { StoresService } from './stores.service';

@Controller('retailers')
export class RetailersController {
  constructor(private readonly retailers: RetailersService) {}

  @Get()
  async listRetailers(): Promise<RetailerPageDto> {
    return wholePage(await this.retailers.listAll());
  }

  @Get(':retailerId')
  getRetailerById(@Param('retailerId', ParseUuidPipe) retailerId: string) {
    return this.retailers.getById(retailerId);
  }
}

@Controller('stores')
export class StoresController {
  constructor(
    private readonly stores: StoresService,
    private readonly config: AppConfigService,
  ) {}

  @Get()
  async listStores(@Query() query: Record<string, unknown>): Promise<StorePageDto> {
    const geo = parseGeoQuery(query, this.config.pricing);
    const rows = await this.stores.findNear(
      { lat: geo.lat, lng: geo.lng },
      geo.radiusMeters,
      this.config.pricing.geoResultLimit,
    );
    // Geo lists are capped and non-cursored in v1 (ADR-0002) — the envelope is the
    // same, so adding a (distance, id) cursor later is additive.
    return wholePage(rows.map(toStoreDto));
  }

  @Get(':storeId')
  async getStoreById(@Param('storeId', ParseUuidPipe) storeId: string): Promise<StoreDto> {
    return toStoreDto(await this.stores.getById(storeId));
  }
}
