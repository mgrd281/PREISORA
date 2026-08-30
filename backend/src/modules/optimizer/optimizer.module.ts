import { Module } from '@nestjs/common';
import { OffersModule } from '../offers/offers.module';
import { OptimizerService } from './optimizer.service';

@Module({
  imports: [OffersModule],
  providers: [OptimizerService],
  exports: [OptimizerService],
})
export class OptimizerModule {}
