/**
 * The flyer-import file contract (`backend/data/flyer-imports/*.json`).
 *
 * Provider-neutral by construction: nothing in here knows which chain, which
 * harvester or which country produced a batch — a NL or AT flyer file imports
 * through exactly the same shape (constitution §24). The file carries FACTS from a
 * retailer's own public offer page (product, price, validity, source URL); GTINs
 * are optional because resolution is the matching stage's job, not the harvester's.
 */
import * as fs from 'node:fs';

export type FlyerOfferKind = 'weekly' | 'permanent_reduction';

export interface FlyerOfferRow {
  /** Product name as printed in the flyer. */
  name: string;
  /** Brand as printed. Absent for unbranded / own-name articles. */
  brand?: string;
  /** Pack size as printed (`"130 g"`, `"1,5 l"`, `"3000 Blatt"`). */
  quantityText?: string;
  /** Advertised price in minor units of the batch currency. */
  priceMinor: number;
  /** Crossed-out previous price, when advertised. */
  oldPriceMinor?: number;
  /** ISO date (YYYY-MM-DD). Absent for permanent reductions. */
  validFrom?: string;
  /** ISO date (YYYY-MM-DD). Absent when the flyer names no end. */
  validUntil?: string;
  /** `weekly` (default) or `permanent_reduction` (no validity window). */
  kind?: FlyerOfferKind;
  /** Optional pre-resolved GTIN — verified (checksum) before it is trusted. */
  gtin?: string;
}

export interface FlyerBatch {
  retailerName: string;
  retailerSlug: string;
  countryCode: string;
  currencyCode: string;
  /** BCP-47 locale of the batch's market; defaults to the configured locale. */
  locale?: string;
  /** The retailer's own public page the offers were transcribed from. */
  sourceUrl: string;
  /** ISO date the harvest happened. */
  harvestedAt: string;
  /** `market` = one price for the whole chain (offers.store_id NULL). */
  pricingScope: 'market';
  offers: FlyerOfferRow[];
}

export interface FlyerImportFile {
  schemaVersion: 1;
  batches: FlyerBatch[];
}

class ImportFileError extends Error {}

function fail(path: string, message: string): never {
  throw new ImportFileError(`${path}: ${message}`);
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') fail(path, 'must be a non-empty string');
  return value;
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requireString(value, path);
}

function requireInt(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    fail(path, 'must be a positive integer (minor units)');
  }
  return value;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function optionalIsoDate(value: unknown, path: string): string | undefined {
  const text = optionalString(value, path);
  if (text !== undefined && !ISO_DATE.test(text)) fail(path, 'must be an ISO date (YYYY-MM-DD)');
  return text;
}

function parseOffer(raw: unknown, path: string): FlyerOfferRow {
  if (typeof raw !== 'object' || raw === null) fail(path, 'must be an object');
  const row = raw as Record<string, unknown>;
  const kind = optionalString(row.kind, `${path}.kind`) as FlyerOfferKind | undefined;
  if (kind !== undefined && kind !== 'weekly' && kind !== 'permanent_reduction') {
    fail(`${path}.kind`, 'must be "weekly" or "permanent_reduction"');
  }
  const offer: FlyerOfferRow = {
    name: requireString(row.name, `${path}.name`),
    brand: optionalString(row.brand, `${path}.brand`),
    quantityText: optionalString(row.quantityText, `${path}.quantityText`),
    priceMinor: requireInt(row.priceMinor, `${path}.priceMinor`),
    oldPriceMinor: row.oldPriceMinor === undefined ? undefined : requireInt(row.oldPriceMinor, `${path}.oldPriceMinor`),
    validFrom: optionalIsoDate(row.validFrom, `${path}.validFrom`),
    validUntil: optionalIsoDate(row.validUntil, `${path}.validUntil`),
    kind: kind ?? 'weekly',
    gtin: optionalString(row.gtin, `${path}.gtin`),
  };
  if (offer.kind === 'weekly' && offer.validFrom === undefined) {
    fail(`${path}.validFrom`, 'weekly offers must carry a validFrom date');
  }
  return offer;
}

function parseBatch(raw: unknown, path: string): FlyerBatch {
  if (typeof raw !== 'object' || raw === null) fail(path, 'must be an object');
  const batch = raw as Record<string, unknown>;
  const pricingScope = requireString(batch.pricingScope, `${path}.pricingScope`);
  if (pricingScope !== 'market') {
    // The store-specific scope is a documented follow-up; refusing loudly beats
    // silently importing prices with the wrong reach.
    fail(`${path}.pricingScope`, 'only "market" pricing is supported by this importer');
  }
  const offers = batch.offers;
  if (!Array.isArray(offers) || offers.length === 0) {
    fail(`${path}.offers`, 'must be a non-empty array');
  }
  return {
    retailerName: requireString(batch.retailerName, `${path}.retailerName`),
    retailerSlug: requireString(batch.retailerSlug, `${path}.retailerSlug`),
    countryCode: requireString(batch.countryCode, `${path}.countryCode`).toUpperCase(),
    currencyCode: requireString(batch.currencyCode, `${path}.currencyCode`).toUpperCase(),
    locale: optionalString(batch.locale, `${path}.locale`),
    sourceUrl: requireString(batch.sourceUrl, `${path}.sourceUrl`),
    harvestedAt: requireString(batch.harvestedAt, `${path}.harvestedAt`),
    pricingScope: 'market',
    offers: offers.map((offer, index) => parseOffer(offer, `${path}.offers[${index}]`)),
  };
}

/** Parses and validates an import file. Throws with a precise path on any problem. */
export function parseFlyerImportFile(json: string, fileName = 'import file'): FlyerImportFile {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    fail(fileName, `not valid JSON (${error instanceof Error ? error.message : 'parse error'})`);
  }
  if (typeof raw !== 'object' || raw === null) fail(fileName, 'must be a JSON object');
  const file = raw as Record<string, unknown>;
  if (file.schemaVersion !== 1) fail(`${fileName}.schemaVersion`, 'must be 1');
  if (!Array.isArray(file.batches) || file.batches.length === 0) {
    fail(`${fileName}.batches`, 'must be a non-empty array');
  }
  return {
    schemaVersion: 1,
    batches: file.batches.map((batch, index) => parseBatch(batch, `${fileName}.batches[${index}]`)),
  };
}

export function readFlyerImportFile(filePath: string): FlyerImportFile {
  return parseFlyerImportFile(fs.readFileSync(filePath, 'utf8'), filePath);
}
