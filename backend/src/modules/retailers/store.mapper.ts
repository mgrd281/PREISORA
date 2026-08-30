import type { StoreDto } from '../../common/api/schemas';
import type { OpeningHour } from '../../database/schema';

/** A store row as every geo query in this codebase projects it. */
export interface StoreRow {
  id: string;
  retailerMarketId: string;
  name: string;
  lat: number;
  lng: number;
  street: string;
  postalCode: string;
  city: string;
  countryCode: string;
  openingHours: OpeningHour[] | null;
  /** Populated only when the query carried an origin; `null` otherwise. */
  distanceMeters: number | null;
}

export function toStoreDto(row: StoreRow): StoreDto {
  return {
    id: row.id,
    retailerMarketId: row.retailerMarketId,
    name: row.name,
    lat: row.lat,
    lng: row.lng,
    address: {
      street: row.street,
      postalCode: row.postalCode,
      city: row.city,
      countryCode: row.countryCode.trim(),
    },
    distanceMeters: row.distanceMeters === null ? null : Math.round(row.distanceMeters),
    openingHours:
      row.openingHours === null || row.openingHours === undefined
        ? null
        : row.openingHours.map((entry) => ({
            dayOfWeek: entry.dayOfWeek,
            opensAt: entry.opensAt,
            closesAt: entry.closesAt,
          })),
  };
}
