import { customType } from 'drizzle-orm/pg-core';

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * PostGIS `geography(Point,4326)` as a first-class Drizzle column (ADR-0001).
 *
 * Reads come back as WKT (`POINT(lng lat)`) because every SELECT in this codebase
 * projects the column through `ST_AsText`; writes go through `ST_SetSRID(ST_MakePoint(
 * lng, lat), 4326)` in `sql` fragments. The custom type exists so the schema — and
 * therefore the generated migration — carries the real column type, and so radius
 * queries can use a GIST index instead of a lat/lng bounding box.
 */
export const geographyPoint = customType<{
  data: LatLng;
  driverData: string;
  config: never;
}>({
  dataType() {
    return 'geography(Point,4326)';
  },
  toDriver(value: LatLng): string {
    return `SRID=4326;POINT(${value.lng} ${value.lat})`;
  },
  fromDriver(value: string): LatLng {
    const match = /POINT\(([-\d.eE+]+) ([-\d.eE+]+)\)/.exec(value);
    if (!match) return { lat: 0, lng: 0 };
    return { lng: Number.parseFloat(match[1]), lat: Number.parseFloat(match[2]) };
  },
});
