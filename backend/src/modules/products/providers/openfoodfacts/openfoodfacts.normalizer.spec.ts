import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildSlugCandidates, slugify } from '../../product-slug';
import {
  languageOf,
  normalizeOffProduct,
  pickBrand,
  pickImages,
  pickName,
} from './openfoodfacts.normalizer';
import type { OffProduct, OffProductResponse } from './openfoodfacts.types';

const FIXTURES = path.join(__dirname, '../../../../../test/fixtures/openfoodfacts');

function fixture(name: string): OffProductResponse {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8'));
}

const NUTELLA = 'nutella-4008400402222';
const RITTER = 'ritter-sport-4000417025005';
const BOUNTY = 'bounty-40111216';

function normalize(name: string, gtin: string, locale = 'de-DE') {
  return normalizeOffProduct(fixture(name), { gtin, locale, source: 'openfoodfacts' });
}

describe('open food facts normalizer', () => {
  describe('name selection', () => {
    it('prefers the requested locale language over the generic name', () => {
      // lang: en, product_name: "Ritter Sport Marzapane chocolate", product_name_de: "Marzipan"
      expect(normalize(RITTER, '4000417025005', 'de-DE')?.name).toBe('Marzipan');
    });

    it('serves the same product in English when the request asks for English', () => {
      expect(normalize(RITTER, '4000417025005', 'en-GB')?.name).toBe(
        'Ritter Sport Marzapane chocolate',
      );
    });

    it('never hardcodes German: an unknown locale falls back to the generic name', () => {
      // No product_name_it exists, so the generic name wins - not the German one.
      expect(normalize(RITTER, '4000417025005', 'it-IT')?.name).toBe(
        'Ritter Sport Marzapane chocolate',
      );
    });

    it('treats a blank localized name as absent', () => {
      // Nutella's product_name_fr is "" in the recorded payload.
      expect(normalize(NUTELLA, '4008400402222', 'fr-FR')?.name).toBe('Nutella');
    });

    it("falls back to the product's own language when nothing else is usable", () => {
      const product: OffProduct = { lang: 'sv', product_name_sv: 'Kanelbulle' };
      expect(pickName(product, 'de')).toBe('Kanelbulle');
    });

    it('returns NOT FOUND rather than persisting a nameless product', () => {
      expect(normalize('malformed-partial', '4006381333931')).toBeNull();
    });
  });

  describe('brand parsing', () => {
    it('takes the single brand as-is', () => {
      expect(normalize(NUTELLA, '4008400402222')?.brand).toBe('Ferrero');
    });

    it('takes the FIRST entry of a comma-separated list, trimmed', () => {
      expect(pickBrand({ brands: ' Ritter Sport , Alfred Ritter GmbH ' })).toBe('Ritter Sport');
    });

    it('skips leading empty entries', () => {
      expect(pickBrand({ brands: '   ,  Acme Foods , Acme Deutschland  ' })).toBe('Acme Foods');
    });

    it('is null when absent or blank', () => {
      expect(pickBrand({})).toBeNull();
      expect(pickBrand({ brands: '  ' })).toBeNull();
      expect(pickBrand({ brands: 42 })).toBeNull();
    });
  });

  it('carries the pack size through as quantityText', () => {
    expect(normalize(NUTELLA, '4008400402222')?.quantityText).toBe('500g');
    expect(normalize(RITTER, '4000417025005')?.quantityText).toBe('100g');
  });

  describe('image assets', () => {
    it('builds every rendition with its EXACT recorded dimensions', () => {
      const images = normalize(NUTELLA, '4008400402222')?.images;
      expect(images).toEqual([
        {
          url: 'https://images.openfoodfacts.org/images/products/400/840/040/2222/front_de.253.100.jpg',
          widthPx: 67,
          heightPx: 100,
        },
        {
          url: 'https://images.openfoodfacts.org/images/products/400/840/040/2222/front_de.253.200.jpg',
          widthPx: 134,
          heightPx: 200,
        },
        {
          url: 'https://images.openfoodfacts.org/images/products/400/840/040/2222/front_de.253.400.jpg',
          widthPx: 269,
          heightPx: 400,
        },
        {
          url: 'https://images.openfoodfacts.org/images/products/400/840/040/2222/front_de.253.full.jpg',
          widthPx: 2061,
          heightPx: 3069,
        },
      ]);
    });

    it('serves the localized packaging shot when the locale changes', () => {
      const images = normalize(NUTELLA, '4008400402222', 'en-GB')?.images ?? [];
      expect(images.every((image) => image.url.includes('front_en'))).toBe(true);
      // front_en has genuinely different dimensions from front_de - proof they are read.
      expect(images[0]).toEqual({
        url: 'https://images.openfoodfacts.org/images/products/400/840/040/2222/front_en.161.100.jpg',
        widthPx: 100,
        heightPx: 92,
      });
    });

    it('falls back to another language when the locale has no front image', () => {
      // Bounty HAS a German name but NO front_de image; lang is en.
      const product = normalize(BOUNTY, '40111216', 'de-DE');
      expect(product?.name).toBe('Bounty');
      expect(product?.images?.length).toBeGreaterThan(0);
      expect(product?.images?.[0].url).toContain('front_en');
    });

    it('falls back again when neither the locale nor the product language has one', () => {
      // Bounty has no front_ja and no front_pt; pretending its own language is pt too
      // exhausts both preferred candidates.
      const product = { ...(fixture(BOUNTY).product as OffProduct), lang: 'pt' };
      const images = pickImages(product, 'ja');
      // The alphabetically first available front language wins - deterministically, so
      // two identical requests never disagree about which picture a product has.
      expect(images?.[0].url).toContain('front_cs');
    });

    it('is null - never [] - when no rendition is fully describable', () => {
      expect(pickImages({}, 'de')).toBeNull();
      expect(pickImages({ images: { front_de: { sizes: null } } }, 'de')).toBeNull();
    });

    it('drops renditions whose URL or dimensions are unknown', () => {
      // malformed-partial: 100 has no w, 200's w is not a number and its URL is null,
      // 400 is complete, and thumb has no URL at all. Only 400 survives.
      const images = pickImages(fixture('malformed-partial').product as OffProduct, 'de');
      expect(images).toEqual([
        {
          url: 'https://images.openfoodfacts.org/images/products/400/638/133/3931/front_de.7.400.jpg',
          widthPx: 300,
          heightPx: 400,
        },
      ]);
    });

    it('never emits a partial ImageAsset', () => {
      const images = normalize(RITTER, '4000417025005')?.images ?? [];
      expect(images.length).toBeGreaterThan(0);
      for (const image of images) {
        expect(typeof image.url).toBe('string');
        expect(Number.isInteger(image.widthPx)).toBe(true);
        expect(Number.isInteger(image.heightPx)).toBe(true);
        expect(image.widthPx).toBeGreaterThan(0);
        expect(image.heightPx).toBeGreaterThan(0);
      }
    });
  });

  describe('not found', () => {
    it('maps status 0 to null', () => {
      expect(normalize('not-found-4012345000016', '4012345000016')).toBeNull();
    });

    it('maps a missing or unparseable payload to null', () => {
      const gtin = '4008400402222';
      const input = { gtin, locale: 'de-DE', source: 'openfoodfacts' } as const;
      expect(normalizeOffProduct(null, input)).toBeNull();
      expect(normalizeOffProduct(undefined, input)).toBeNull();
      expect(normalizeOffProduct({ status: 1 }, input)).toBeNull();
      expect(normalizeOffProduct({ status: 1, product: null }, input)).toBeNull();
      expect(normalizeOffProduct({}, input)).toBeNull();
    });
  });

  it('records provenance without leaking OFF vocabulary', () => {
    const product = normalize(NUTELLA, '4008400402222');
    expect(product).toMatchObject({
      gtin: '4008400402222',
      source: 'openfoodfacts',
      sourceRef: '4008400402222',
    });
    expect(Object.keys(product ?? {}).sort()).toEqual([
      'brand',
      'gtin',
      'images',
      'name',
      'quantityText',
      'source',
      'sourceRef',
    ]);
  });

  it('reads only the language subtag of a locale', () => {
    expect(languageOf('de-DE')).toBe('de');
    expect(languageOf('en')).toBe('en');
    expect(languageOf('')).toBe('');
  });
});

describe('product slug derivation', () => {
  it('builds a URL-safe slug from brand + name + quantity', () => {
    expect(slugify('Ferrero Nutella 500g')).toBe('ferrero-nutella-500g');
  });

  it('transliterates rather than dropping German characters', () => {
    expect(slugify('Müllermilch Erdnuß 0,5 l')).toBe('muellermilch-erdnuss-0-5-l');
  });

  it('strips diacritics of other Latin markets (§24)', () => {
    expect(slugify('Crème Brûlée Ø')).toBe('creme-brulee-oe');
  });

  it('offers deterministic collision fallbacks, most desirable first', () => {
    expect(
      buildSlugCandidates({
        brand: 'Ferrero',
        name: 'Nutella',
        quantityText: '500g',
        gtin: '4008400402222',
      }),
    ).toEqual([
      'ferrero-nutella-500g',
      'ferrero-nutella-500g-402222',
      'ferrero-nutella-500g-4008400402222',
      'product-4008400402222',
    ]);
  });

  it('is stable: the same input always yields the same candidates', () => {
    const input = { brand: null, name: 'Bounty', quantityText: null, gtin: '40111216' };
    expect(buildSlugCandidates(input)).toEqual(buildSlugCandidates(input));
    expect(buildSlugCandidates(input)[0]).toBe('bounty');
  });

  it('always ends with a GTIN-unique candidate, even for an unsluggable name', () => {
    const candidates = buildSlugCandidates({
      brand: null,
      name: '。。。',
      quantityText: null,
      gtin: '40111216',
    });
    expect(candidates).toEqual(['product-40111216']);
  });
});
