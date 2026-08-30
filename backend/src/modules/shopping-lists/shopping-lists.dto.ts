import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import type {
  OptimizeRequestDto,
  ShoppingListCreateRequestDto,
  ShoppingListItemCreateRequestDto,
  ShoppingListItemUpdateRequestDto,
  ShoppingListUpdateRequestDto,
  WithOptionalDefaults,
} from '../../common/api/schemas';

export class ShoppingListCreateDto implements ShoppingListCreateRequestDto {
  @IsString()
  @Length(1, 120)
  name!: string;
}

export class ShoppingListUpdateDto implements ShoppingListUpdateRequestDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;
}

// `quantity` carries a contract default of 1.
export class ShoppingListItemCreateDto
  implements WithOptionalDefaults<ShoppingListItemCreateRequestDto, 'quantity'>
{
  @IsUUID()
  productId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity?: number;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  note?: string | null;
}

export class ShoppingListItemUpdateDto implements ShoppingListItemUpdateRequestDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity?: number;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  note?: string | null;
}

// `strategy` and `radiusMeters` carry contract defaults.
export class OptimizeDto
  implements WithOptionalDefaults<OptimizeRequestDto, 'strategy' | 'radiusMeters'>
{
  @IsOptional()
  @IsIn(['cheapest_total', 'fewest_stores', 'balanced'])
  strategy?: 'cheapest_total' | 'fewest_stores' | 'balanced';

  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50000)
  radiusMeters?: number;
}
