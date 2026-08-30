/**
 * Matcher decisions against RECORDED Open Food Facts search payloads (offline —
 * see test/fixtures/openfoodfacts-search/README.md for provenance and licensing).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { brandMatches, decideMatch, SearchCandidate } from './matcher';

const FIXTURES = path.join(__dirname, '..', '..', 'test', 'fixtures', 'openfoodfacts-search');

function candidates(fixture: string): SearchCandidate[] {
  const payload = JSON.parse(fs.readFileSync(path.join(FIXTURES, fixture), 'utf8')) as {
    products: SearchCandidate[];
  };
  return payload.products;
}

describe('brandMatches', () => {
  it('is case-, whitespace- and punctuation-insensitive containment', () => {
    expect(brandMatches('funny-frisch', 'Funny Frisch')).toBe(true);
    expect(brandMatches('Rio d\'Oro', "Rio d'Oro, riha WeserGold")).toBe(true);
    expect(brandMatches('Farmer', 'farmer')).toBe(true);
    expect(brandMatches('Ferrero', 'Nutella, Ferrero, Nutella b-ready')).toBe(true);
  });

  it('rejects unrelated brands and empty inputs', () => {
    expect(brandMatches('Farmer', 'Lotus')).toBe(false);
    expect(brandMatches('Farmer', undefined)).toBe(false);
    expect(brandMatches('', 'Farmer')).toBe(false);
  });
});

describe('decideMatch (recorded payloads)', () => {
  it('confidently matches the single Farmer Macadamia 125 g hit', () => {
    const decision = decideMatch(
      { name: 'Farmer Macadamia gesalzen', brand: 'Farmer', quantityText: '125 g', countryCode: 'DE' },
      candidates('search-farmer-macadamia-gesalzen.json'),
    );
    expect(decision.status).toBe('matched');
    if (decision.status === 'matched') expect(decision.gtin).toBe('4061458056557');
  });

  it('refuses Ferrero B-ready 132 g — size variants exist but none is 132 g', () => {
    const decision = decideMatch(
      { name: 'Ferrero B-ready', brand: 'Ferrero', quantityText: '132 g', countryCode: 'DE' },
      candidates('search-ferrero-b-ready.json'),
    );
    expect(decision).toMatchObject({ status: 'unmatched', reason: 'quantity_mismatch' });
  });

  it('refuses Rio d\'Oro Orangennektar — two distinct GTINs pass every gate', () => {
    const decision = decideMatch(
      { name: "Rio d'Oro Orangennektar", brand: "Rio d'Oro", quantityText: '1,5 l', countryCode: 'DE' },
      candidates('search-rio-doro-orangennektar.json'),
    );
    expect(decision).toMatchObject({ status: 'unmatched', reason: 'ambiguous_gtins' });
  });

  it('reports no_result for an empty search', () => {
    const decision = decideMatch(
      { name: 'Golden Seafood Garnelen Sortiment XXL', brand: 'Golden Seafood', quantityText: '400 g', countryCode: 'DE' },
      candidates('search-golden-seafood-garnelen.json'),
    );
    expect(decision).toMatchObject({ status: 'unmatched', reason: 'no_result' });
  });

  it('refuses a brandless flyer row without searching (no_brand)', () => {
    const decision = decideMatch(
      { name: 'Gouda XXL', brand: null, quantityText: '600 g', countryCode: 'DE' },
      [],
    );
    expect(decision).toMatchObject({ status: 'unmatched', reason: 'no_brand' });
  });

  it('discards candidates whose code fails the GTIN checksum', () => {
    const decision = decideMatch(
      { name: 'Farmer Macadamia gesalzen', brand: 'Farmer', quantityText: '125 g', countryCode: 'DE' },
      [{ code: '4061458056558', brands: 'Farmer', quantity: '125 g' }],
    );
    expect(decision).toMatchObject({ status: 'unmatched', reason: 'no_result' });
  });

  it('uses the batch country only as a tiebreaker, never as a gate', () => {
    const twins: SearchCandidate[] = [
      { code: '4061458056557', brands: 'Farmer', quantity: '125 g', countries_tags: ['en:germany'] },
      { code: '4008400402222', brands: 'Farmer', quantity: '125 g', countries_tags: ['en:france'] },
    ];
    const decision = decideMatch(
      { name: 'Farmer Macadamia gesalzen', brand: 'Farmer', quantityText: '125 g', countryCode: 'DE' },
      twins,
    );
    expect(decision.status).toBe('matched');
    if (decision.status === 'matched') expect(decision.gtin).toBe('4061458056557');

    // A match with NO German candidate still succeeds when it is unambiguous.
    const foreignOnly = decideMatch(
      { name: 'Farmer Macadamia gesalzen', brand: 'Farmer', quantityText: '125 g', countryCode: 'DE' },
      [{ code: '4008400402222', brands: 'Farmer', quantity: '125 g', countries_tags: ['en:france'] }],
    );
    expect(foreignOnly.status).toBe('matched');
  });
});
