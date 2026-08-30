import { Controller, Get, Param } from '@nestjs/common';
import type { ProductDto } from '../../common/api/schemas';
import { ReqContext } from '../../common/context/req-context.decorator';
import type { RequestContext } from '../../common/context/request-context';
import { ParseSlugPipe, ParseUuidPipe } from '../../common/validation/uuid.pipe';
import { ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  // Literal-prefixed lookups are declared first; they can never collide with a UUID.
  @Get('by-gtin/:gtin')
  getByGtin(
    @Param('gtin') gtin: string,
    // The scan is market- and locale-aware: the context decides which localized name
    // a discovered product is stored under, and which country it belongs to (§24).
    @ReqContext() ctx: RequestContext,
  ): Promise<ProductDto> {
    return this.products.getByGtin(gtin, ctx);
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
