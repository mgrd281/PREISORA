import type { ImageAssetDto, ProductDto } from '../../common/api/schemas';
import type { ProductImage } from '../../database/schema';

/** The subset of the `products` row a Product response is built from. */
export interface ProductRow {
  id: string;
  gtin: string;
  slug: string;
  name: string;
  brand: string | null;
  quantityText: string | null;
  images: ProductImage[] | null;
  countryCode: string;
  createdAt: Date;
  updatedAt: Date;
}

function toImageAssets(images: ProductImage[] | null): ImageAssetDto[] | null {
  if (images === null || images === undefined) return null;
  return images.map((image) => ({
    url: image.url,
    widthPx: image.widthPx,
    heightPx: image.heightPx,
  }));
}

/**
 * Row -> wire. Internal columns (`unit_price_divisor`, ...) never leave the API;
 * the return type is the contract-generated `Product`, so a drift is a build error.
 */
export function toProductDto(row: ProductRow): ProductDto {
  return {
    id: row.id,
    gtin: row.gtin,
    slug: row.slug,
    name: row.name,
    brand: row.brand,
    quantityText: row.quantityText,
    images: toImageAssets(row.images),
    countryCode: row.countryCode.trim(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
