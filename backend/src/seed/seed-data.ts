/**
 * PREISORA demo seed data.
 *
 * EVERYTHING HERE IS FICTIONAL. The retailers ("Kaufrausch", "Marktfrisch",
 * "PreisPilot") are invented brands, the products are generic German grocery staples
 * with no brand claims, and the GTINs live in the 4012345xxxxxx demo range with
 * check digits computed at seed time (`withCheckDigit`) so every barcode validates.
 * No real trademarks, no scraped prices.
 */
import { withCheckDigit } from '../common/gtin/gtin';
import type { OpeningHour } from '../database/schema';

export interface SeedRetailer {
  slug: string;
  name: string;
  /** Price index vs. the reference price: <1 discounter, >1 premium/regional. */
  priceIndex: number;
  marketDisplayName: string;
  stores: SeedStore[];
}

export interface SeedStore {
  /** Stable natural key for idempotent re-seeding. */
  externalRef: string;
  name: string;
  lat: number;
  lng: number;
  street: string;
  postalCode: string;
  city: string;
  openingHours: OpeningHour[] | null;
}

export interface SeedProduct {
  /** 12-digit payload; the check digit is appended at seed time. */
  gtinBase: string;
  slug: string;
  name: string;
  brand: string | null;
  quantityText: string;
  unitPriceDivisor: string;
  unitPriceQuantityText: string;
  /** Reference shelf price in minor units, before the retailer price index. */
  referenceAmountMinor: number;
}

const WEEKDAY_HOURS: OpeningHour[] = [
  { dayOfWeek: 1, opensAt: '08:00', closesAt: '20:00' },
  { dayOfWeek: 2, opensAt: '08:00', closesAt: '20:00' },
  { dayOfWeek: 3, opensAt: '08:00', closesAt: '20:00' },
  { dayOfWeek: 4, opensAt: '08:00', closesAt: '20:00' },
  { dayOfWeek: 5, opensAt: '08:00', closesAt: '21:00' },
  { dayOfWeek: 6, opensAt: '08:00', closesAt: '20:00' },
];

export const SEED_RETAILERS: SeedRetailer[] = [
  {
    slug: 'kaufrausch',
    name: 'Kaufrausch',
    priceIndex: 1.0,
    marketDisplayName: 'Kaufrausch Deutschland',
    stores: [
      {
        externalRef: 'kr-mitte',
        name: 'Kaufrausch Berlin-Mitte',
        lat: 52.5219,
        lng: 13.4132,
        street: 'Alexanderplatz 3',
        postalCode: '10178',
        city: 'Berlin',
        openingHours: WEEKDAY_HOURS,
      },
      {
        externalRef: 'kr-prenzlauer-berg',
        name: 'Kaufrausch Prenzlauer Berg',
        lat: 52.5391,
        lng: 13.4132,
        street: 'Schoenhauser Allee 80',
        postalCode: '10439',
        city: 'Berlin',
        openingHours: WEEKDAY_HOURS,
      },
      {
        externalRef: 'kr-kreuzberg',
        name: 'Kaufrausch Kreuzberg',
        lat: 52.5026,
        lng: 13.4197,
        street: 'Oranienstrasse 140',
        postalCode: '10969',
        city: 'Berlin',
        openingHours: WEEKDAY_HOURS,
      },
      {
        // Deliberately outside a 5 km radius around 52.52/13.405 so the radius
        // filter is visibly doing something in the demo.
        externalRef: 'kr-charlottenburg',
        name: 'Kaufrausch Charlottenburg',
        lat: 52.5058,
        lng: 13.3247,
        street: 'Kantstrasse 17',
        postalCode: '10623',
        city: 'Berlin',
        openingHours: null,
      },
    ],
  },
  {
    slug: 'marktfrisch',
    name: 'Marktfrisch',
    priceIndex: 1.08,
    marketDisplayName: 'Marktfrisch Deutschland',
    stores: [
      {
        externalRef: 'mf-friedrichshain',
        name: 'Marktfrisch Friedrichshain',
        lat: 52.5079,
        lng: 13.4494,
        street: 'Warschauer Strasse 33',
        postalCode: '10243',
        city: 'Berlin',
        openingHours: WEEKDAY_HOURS,
      },
      {
        externalRef: 'mf-mitte',
        name: 'Marktfrisch Mitte',
        lat: 52.5296,
        lng: 13.4014,
        street: 'Torstrasse 96',
        postalCode: '10119',
        city: 'Berlin',
        openingHours: WEEKDAY_HOURS,
      },
      {
        externalRef: 'mf-wedding',
        name: 'Marktfrisch Wedding',
        lat: 52.5502,
        lng: 13.3585,
        street: 'Muellerstrasse 141',
        postalCode: '13353',
        city: 'Berlin',
        openingHours: null,
      },
    ],
  },
  {
    slug: 'preispilot',
    name: 'PreisPilot',
    priceIndex: 0.85,
    marketDisplayName: 'PreisPilot Deutschland',
    stores: [
      {
        externalRef: 'pp-alexanderplatz',
        name: 'PreisPilot Alexanderplatz',
        lat: 52.5228,
        lng: 13.4133,
        street: 'Karl-Liebknecht-Strasse 13',
        postalCode: '10178',
        city: 'Berlin',
        openingHours: WEEKDAY_HOURS,
      },
      {
        externalRef: 'pp-moabit',
        name: 'PreisPilot Moabit',
        lat: 52.5265,
        lng: 13.3421,
        street: 'Turmstrasse 75',
        postalCode: '10551',
        city: 'Berlin',
        openingHours: WEEKDAY_HOURS,
      },
      {
        externalRef: 'pp-neukoelln',
        name: 'PreisPilot Neukoelln',
        lat: 52.479,
        lng: 13.4372,
        street: 'Karl-Marx-Strasse 92',
        postalCode: '12043',
        city: 'Berlin',
        openingHours: null,
      },
      {
        externalRef: 'pp-schoeneberg',
        name: 'PreisPilot Schoeneberg',
        lat: 52.4855,
        lng: 13.354,
        street: 'Hauptstrasse 40',
        postalCode: '10827',
        city: 'Berlin',
        openingHours: null,
      },
    ],
  },
];

export const SEED_PRODUCTS: SeedProduct[] = [
  {
    gtinBase: '401234500001',
    slug: 'vollmilch-3-5-1l',
    name: 'Vollmilch 3,5%',
    brand: null,
    quantityText: '1 L',
    unitPriceDivisor: '1.0000',
    unitPriceQuantityText: '1 l',
    referenceAmountMinor: 129,
  },
  {
    gtinBase: '401234500002',
    slug: 'butter-250g',
    name: 'Butter',
    brand: null,
    quantityText: '250 g',
    unitPriceDivisor: '0.2500',
    unitPriceQuantityText: '1 kg',
    referenceAmountMinor: 239,
  },
  {
    gtinBase: '401234500003',
    slug: 'nuss-nougat-creme-450g',
    name: 'Nuss-Nougat-Creme',
    brand: null,
    quantityText: '450 g',
    unitPriceDivisor: '0.4500',
    unitPriceQuantityText: '1 kg',
    referenceAmountMinor: 279,
  },
  {
    gtinBase: '401234500004',
    slug: 'weizenmehl-type-405-1kg',
    name: 'Weizenmehl Type 405',
    brand: null,
    quantityText: '1 kg',
    unitPriceDivisor: '1.0000',
    unitPriceQuantityText: '1 kg',
    referenceAmountMinor: 89,
  },
  {
    gtinBase: '401234500005',
    slug: 'eier-freilandhaltung-10-stueck',
    name: 'Eier Freilandhaltung',
    brand: null,
    quantityText: '10 Stueck',
    unitPriceDivisor: '10.0000',
    unitPriceQuantityText: '1 Stueck',
    referenceAmountMinor: 319,
  },
  {
    gtinBase: '401234500006',
    slug: 'haferflocken-kernig-500g',
    name: 'Haferflocken kernig',
    brand: null,
    quantityText: '500 g',
    unitPriceDivisor: '0.5000',
    unitPriceQuantityText: '1 kg',
    referenceAmountMinor: 149,
  },
  {
    gtinBase: '401234500007',
    slug: 'sonnenblumenoel-1l',
    name: 'Sonnenblumenoel',
    brand: null,
    quantityText: '1 L',
    unitPriceDivisor: '1.0000',
    unitPriceQuantityText: '1 l',
    referenceAmountMinor: 259,
  },
  {
    gtinBase: '401234500008',
    slug: 'kaffee-gemahlen-500g',
    name: 'Kaffee gemahlen',
    brand: null,
    quantityText: '500 g',
    unitPriceDivisor: '0.5000',
    unitPriceQuantityText: '1 kg',
    referenceAmountMinor: 549,
  },
  {
    gtinBase: '401234500009',
    slug: 'spaghetti-500g',
    name: 'Spaghetti',
    brand: null,
    quantityText: '500 g',
    unitPriceDivisor: '0.5000',
    unitPriceQuantityText: '1 kg',
    referenceAmountMinor: 119,
  },
  {
    gtinBase: '401234500010',
    slug: 'mineralwasser-classic-1-5l',
    name: 'Mineralwasser Classic',
    brand: null,
    quantityText: '1,5 L',
    unitPriceDivisor: '1.5000',
    unitPriceQuantityText: '1 l',
    referenceAmountMinor: 49,
  },
];

/** Check digits are computed, never typed — an invalid demo EAN breaks the funnel. */
export function seedGtin(product: SeedProduct): string {
  return withCheckDigit(product.gtinBase);
}

/**
 * Store-level price overrides, as (store externalRef -> product slug -> factor
 * applied on top of the retailer's price index).
 *
 * Two jobs: make the market-wide vs store-specific override visible, and give the
 * optimizer a genuine reason to split a basket. The factors below are deliberately
 * chosen as LOSS LEADERS — deep enough that a full-range store beats the discounter
 * on a few specific products, so `cheapest_total` really does route a basket across
 * two or three stores instead of collapsing to "always the discounter".
 *
 * Only some stores of a market carry overrides, so each market keeps at least one
 * uncovered in-radius store and its market-wide price stays meaningful.
 */
export const SEED_STORE_PRICE_OVERRIDES: Record<string, Record<string, number>> = {
  // Kaufrausch (index 1.00) — butter is the loss leader that beats the discounter.
  'kr-mitte': {
    'vollmilch-3-5-1l': 0.92,
    'butter-250g': 0.7,
    'nuss-nougat-creme-450g': 0.94,
  },
  'kr-kreuzberg': {
    'haferflocken-kernig-500g': 0.75,
    'sonnenblumenoel-1l': 0.8,
  },
  // Marktfrisch (index 1.08) — regional and pricier, but unbeatable on eggs/flour.
  'mf-friedrichshain': {
    'vollmilch-3-5-1l': 0.95,
    'weizenmehl-type-405-1kg': 0.75,
    'eier-freilandhaltung-10-stueck': 0.7,
  },
  // PreisPilot (index 0.85) — the discounter, cheapest on milk and coffee.
  'pp-alexanderplatz': {
    'vollmilch-3-5-1l': 0.95,
    'butter-250g': 0.96,
    'kaffee-gemahlen-500g': 0.9,
  },
};

/** The one demo promotion: 20% off the discounter's Nuss-Nougat-Creme. */
export const SEED_PROMOTION = {
  label: 'DEMO-nuss-nougat-20',
  retailerSlug: 'preispilot',
  productSlug: 'nuss-nougat-creme-450g',
  type: 'percentage' as const,
  percentOff: 20,
  startsAtDaysAgo: 3,
  endsAtDaysAhead: 4,
};

export interface SeedFeatureFlag {
  flagKey: string;
  countryCode: string | null;
  platform: string | null;
  minAppVersion: string | null;
  cohort: string | null;
  enabled: boolean;
  description: string;
}

export const SEED_FEATURE_FLAGS: SeedFeatureFlag[] = [
  {
    flagKey: 'priceHistory',
    countryCode: null,
    platform: null,
    minAppVersion: null,
    cohort: null,
    enabled: true,
    description: 'Daily min/avg price history is implemented in phase 1.',
  },
  {
    flagKey: 'priceAlerts',
    countryCode: null,
    platform: null,
    minAppVersion: null,
    cohort: null,
    enabled: true,
    description: 'Alert engine runs server-side every 15 minutes.',
  },
  {
    flagKey: 'shoppingOptimizer',
    countryCode: null,
    platform: null,
    minAppVersion: null,
    cohort: null,
    enabled: true,
    description: 'cheapest_total and fewest_stores are implemented; balanced is 501.',
  },
  {
    flagKey: 'receiptScanner',
    countryCode: null,
    platform: null,
    minAppVersion: null,
    cohort: null,
    enabled: false,
    description: 'Not built.',
  },
  {
    flagKey: 'visualProductScan',
    countryCode: null,
    platform: null,
    minAppVersion: null,
    cohort: null,
    enabled: false,
    description: 'Not built.',
  },
  {
    // Demonstrates most-specific-wins: still OFF for a caller that sends no
    // X-App-Platform / X-App-Version, ON for a DE iOS client on 2.0.0 or newer.
    flagKey: 'visualProductScan',
    countryCode: 'DE',
    platform: 'ios',
    minAppVersion: '2.0.0',
    cohort: null,
    enabled: true,
    description: 'Scoped-rollout example for the flag resolver.',
  },
];
