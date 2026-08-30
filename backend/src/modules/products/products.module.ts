import { Module } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { OpenFoodFactsProvider } from './providers/openfoodfacts/openfoodfacts.provider';
import { NullProductProvider } from './providers/null-product.provider';
import { PRODUCT_PROVIDER, ProductProvider } from './providers/product-provider.interface';

/**
 * The catalog provider is bound to a TOKEN, not to a class: a second provider (or a
 * paid price provider later) is added by extending this factory, and no caller —
 * service, controller or test — changes (constitution §22).
 */
const productProvider = {
  provide: PRODUCT_PROVIDER,
  inject: [AppConfigService],
  useFactory: (config: AppConfigService): ProductProvider =>
    config.productProvider.kind === 'openfoodfacts'
      ? new OpenFoodFactsProvider(config)
      : new NullProductProvider(),
};

@Module({
  controllers: [ProductsController],
  providers: [ProductsService, productProvider],
  exports: [ProductsService, PRODUCT_PROVIDER],
})
export class ProductsModule {}
