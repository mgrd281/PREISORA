import { Type } from 'class-transformer';
import { IsInt, IsNumber, Max, Min, validateSync } from 'class-validator';
import { AppException } from '../errors/app-exception';

/**
 * The geo query every radius-bounded endpoint takes. Units are ALWAYS integer meters
 * (CONVENTIONS.md); coordinates are the one place decimals are correct.
 */
export class GeoQueryDto {
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

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50000)
  radiusMeters!: number;
}

export interface GeoQueryLimits {
  defaultRadiusMeters: number;
  maxRadiusMeters: number;
}

function present(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

/**
 * Parses raw query params into a validated `GeoQueryDto`.
 *
 * The distinction the contract insists on: a MISSING coordinate pair is
 * `LOCATION_REQUIRED` (the client has no location yet — a different UX path), while a
 * present-but-nonsensical value is an ordinary `VALIDATION_FAILED`.
 */
export function parseGeoQuery(
  raw: Record<string, unknown>,
  limits: GeoQueryLimits,
): GeoQueryDto {
  if (!present(raw.lat) || !present(raw.lng)) {
    throw new AppException('LOCATION_REQUIRED', { required: ['lat', 'lng'] });
  }

  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  const radiusRaw = present(raw.radiusMeters) ? Number(raw.radiusMeters) : limits.defaultRadiusMeters;

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(radiusRaw)) {
    throw new AppException('VALIDATION_FAILED', {
      fields: ['lat', 'lng', 'radiusMeters'].filter((f) => !Number.isFinite(Number(raw[f] ?? 0))),
    });
  }

  const dto = new GeoQueryDto();
  dto.lat = lat;
  dto.lng = lng;
  dto.radiusMeters = radiusRaw;

  const errors = validateSync(dto, { whitelist: true });
  if (errors.length > 0) {
    throw new AppException('VALIDATION_FAILED', {
      fields: errors.map((e) => e.property),
    });
  }
  if (dto.radiusMeters > limits.maxRadiusMeters) {
    throw new AppException('VALIDATION_FAILED', {
      fields: ['radiusMeters'],
      maxRadiusMeters: limits.maxRadiusMeters,
    });
  }
  return dto;
}
