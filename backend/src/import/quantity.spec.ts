import { parseQuantity, quantitiesEqual } from './quantity';

describe('parseQuantity', () => {
  it('parses grams with and without a space', () => {
    expect(parseQuantity('130 g')).toEqual({ dimension: 'mass', value: 130 });
    expect(parseQuantity('130g')).toEqual({ dimension: 'mass', value: 130 });
  });

  it('converts kg to grams with a German decimal comma', () => {
    expect(parseQuantity('2,72 kg')).toEqual({ dimension: 'mass', value: 2720 });
  });

  it('converts litres to millilitres', () => {
    expect(parseQuantity('1,5 l')).toEqual({ dimension: 'volume', value: 1500 });
    expect(parseQuantity('1.5 L')).toEqual({ dimension: 'volume', value: 1500 });
    expect(parseQuantity('1500 ml')).toEqual({ dimension: 'volume', value: 1500 });
  });

  it('parses count units (Blatt) and er-Packs', () => {
    expect(parseQuantity('3000 Blatt')).toEqual({ dimension: 'count', value: 3000 });
    expect(parseQuantity('32er-Pack')).toEqual({ dimension: 'count', value: 32 });
  });

  it('computes multipack totals', () => {
    expect(parseQuantity('6 x 1,5 l')).toEqual({ dimension: 'volume', value: 9000 });
  });

  it('returns null for unparseable text, blanks and unknown units', () => {
    expect(parseQuantity('')).toBeNull();
    expect(parseQuantity(undefined)).toBeNull();
    expect(parseQuantity('XXL')).toBeNull();
    expect(parseQuantity('36 x 0.7 oz')).toBeNull();
  });
});

describe('quantitiesEqual', () => {
  it('treats formatting variants as equal', () => {
    expect(quantitiesEqual('130 g', '130g')).toBe(true);
    expect(quantitiesEqual('1,5 l', '1.5 l')).toBe(true);
    expect(quantitiesEqual('1,5 l', '1500 ml')).toBe(true);
    expect(quantitiesEqual('0,13 kg', '130 g')).toBe(true);
  });

  it('rejects different values and different dimensions', () => {
    expect(quantitiesEqual('132 g', '220 g')).toBe(false);
    expect(quantitiesEqual('500 g', '500 ml')).toBe(false);
  });

  it('NEVER treats an unparseable side as a wildcard (the safety rule)', () => {
    expect(quantitiesEqual('130 g', undefined)).toBe(false);
    expect(quantitiesEqual(undefined, undefined)).toBe(false);
    expect(quantitiesEqual('XXL', 'XXL')).toBe(false);
  });
});
