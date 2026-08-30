import { Module } from '@nestjs/common';
import { OptimizerModule } from '../optimizer/optimizer.module';
import { ProductsModule } from '../products/products.module';
import { ShoppingListsController } from './shopping-lists.controller';
import { ShoppingListsService } from './shopping-lists.service';

@Module({
  imports: [ProductsModule, OptimizerModule],
  controllers: [ShoppingListsController],
  providers: [ShoppingListsService],
})
export class ShoppingListsModule {}
