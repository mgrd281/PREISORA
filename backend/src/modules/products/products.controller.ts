import { Controller, Get, Param } from '@nestjs/common';
import type { ProductDto } from '../../common/api/schemas';
import { ParseSlugPipe, ParseUuidPipe } from '../../common/validation/uuid.pipe';
import { ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  // Literal-prefixed lookups are declared first; they can never collide with a UUID.
  @Get('by-gtin/:gtin')
  getByGtin(@Param('gtin') gtin: string): Promise<ProductDto> {
    return this.products.getByGtin(gtin);
  }

  @Get('by-slug/:slug')
  getBySlug(@Param('slug', ParseSlugPipe) slug: string): Promise<ProductDto> {
    return this.products.getBySlug(slug);
  }

  @Get(':productId')
  getById(@Param('productId', ParseUuidPipe) productId: string): Promise<ProductDto> {
    return this.products.getById(productId);
  }
}
