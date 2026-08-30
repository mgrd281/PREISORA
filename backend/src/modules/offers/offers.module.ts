import { Module } from '@nestjs/common';
import { ProductsModule } from '../products/products.module';
import { RetailersModule } from '../retailers/retailers.module';
import { OffersController } from './offers.controller';
import { PriceHistoryService } from './price-history.service';
import { PriceRankingService } from './price-ranking.service';

@Module({
  imports: [ProductsModule, RetailersModule],
  controllers: [OffersController],
  providers: [PriceRankingService, PriceHistoryService],
  exports: [PriceRankingService, PriceHistoryService],
})
export class OffersModule {}
