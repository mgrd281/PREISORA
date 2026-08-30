import { Module } from '@nestjs/common';
import { RetailersController, StoresController } from './retailers.controller';
import { RetailersService } from './retailers.service';
import { StoresService } from './stores.service';

@Module({
  controllers: [RetailersController, StoresController],
  providers: [RetailersService, StoresService],
  exports: [StoresService, RetailersService],
})
export class RetailersModule {}
