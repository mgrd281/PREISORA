import { Controller, Get, Module, Query } from '@nestjs/common';
import type { ProductPageDto } from '../../common/api/schemas';
import { SearchService } from './search.service';

@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get('products')
  searchProducts(@Query() query: Record<string, unknown>): Promise<ProductPageDto> {
    return this.search.searchProducts(query.q, query.cursor, query.limit);
  }
}

@Module({
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
