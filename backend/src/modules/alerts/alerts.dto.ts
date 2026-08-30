import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import type {
  AlertCreateRequestDto,
  AlertUpdateRequestDto,
  LocationDto,
  MoneyDto,
  WithOptionalDefaults,
} from '../../common/api/schemas';

export class MoneyInputDto implements MoneyDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  amountMinor!: number;

  @Matches(/^[A-Z]{3}$/)
  currencyCode!: string;
}

/** The client's generic Location model (constitution §8). */
export class LocationInputDto implements LocationDto {
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
  @IsNumber()
  @Min(0)
  accuracy?: number;

  @IsOptional()
  postalCode?: string;

  @IsOptional()
  city?: string;

  @IsOptional()
  @Matches(/^[A-Z]{2}$/)
  countryCode?: string;
}

// `radiusMeters` and `isActive` carry contract defaults, so the caller may omit them.
export class AlertCreateDto
  implements WithOptionalDefaults<AlertCreateRequestDto, 'radiusMeters' | 'isActive'>
{
  @IsUUID()
  productId!: string;

  @ValidateNested()
  @Type(() => MoneyInputDto)
  targetPrice!: MoneyInputDto;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50000)
  radiusMeters?: number;

  @ValidateNested()
  @Type(() => LocationInputDto)
  location!: LocationInputDto;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class AlertUpdateDto implements AlertUpdateRequestDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => MoneyInputDto)
  targetPrice?: MoneyInputDto;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50000)
  radiusMeters?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => LocationInputDto)
  location?: LocationInputDto;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
