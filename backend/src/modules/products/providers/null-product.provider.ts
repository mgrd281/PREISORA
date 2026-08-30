import { Injectable } from '@nestjs/common';
import type { RequestContext } from '../../../common/context/request-context';
import type { ProductSource } from '../../../database/schema';
import type { ProductProvider, ProviderProduct } from './product-provider.interface';

/**
 * The provider used when `PRODUCT_PROVIDER=none` (and always under `NODE_ENV=test`).
 *
 * Every lookup is a miss, so `GET /products/by-gtin/{gtin}` degrades to exactly the
 * pre-provider behaviour: the local catalogue, then `PRODUCT_NOT_FOUND`. It exists so
 * the service never has to branch on "is a provider configured".
 */
@Injectable()
export class NullProductProvider implements ProductProvider {
  /** Nothing is ever persisted from this provider; the value only satisfies the seam. */
  readonly source: ProductSource = 'manual';

  async lookupByGtin(_gtin: string, _ctx: RequestContext): Promise<ProviderProduct | null> {
    return null;
  }
}
