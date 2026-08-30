/**
 * Pack-size normalization for flyer↔catalog matching.
 *
 * `"130 g"`, `"130g"`, `"0,13 kg"` must all compare equal, and `"1,5 l"` must equal
 * `"1500 ml"`. Everything is reduced to a (dimension, base-unit value) pair; two
 * quantities are equal only when BOTH the dimension and the value agree exactly.
 * Anything unparseable compares equal to nothing — an unknown pack size can never
 * "accidentally" satisfy the quantity gate of the matcher.
 */

export type QuantityDimension = 'mass' | 'volume' | 'count';

export interface NormalizedQuantity {
  dimension: QuantityDimension;
  /** Mass in grams, volume in millilitres, count in pieces/sheets. */
  value: number;
}

/** Unit vocabulary → (dimension, factor to the base unit). Case-insensitive. */
const UNITS: Record<string, { dimension: QuantityDimension; factor: number }> = {
  mg: { dimension: 'mass', factor: 0.001 },
  g: { dimension: 'mass', factor: 1 },
  gramm: { dimension: 'mass', factor: 1 },
  kg: { dimension: 'mass', factor: 1000 },
  ml: { dimension: 'volume', factor: 1 },
  cl: { dimension: 'volume', factor: 10 },
  l: { dimension: 'volume', factor: 1000 },
  liter: { dimension: 'volume', factor: 1000 },
  litre: { dimension: 'volume', factor: 1000 },
  // Count-like units seen on German flyers (toilet paper sheets, multipacks).
  blatt: { dimension: 'count', factor: 1 },
  sheets: { dimension: 'count', factor: 1 },
  sheet: { dimension: 'count', factor: 1 },
  stk: { dimension: 'count', factor: 1 },
  'stück': { dimension: 'count', factor: 1 },
  'stueck': { dimension: 'count', factor: 1 },
  x: { dimension: 'count', factor: 1 },
};

/** `"1,5"` / `"1.5"` → 1.5. */
function parseDecimal(text: string): number | null {
  const value = Number.parseFloat(text.replace(',', '.'));
  return Number.isFinite(value) && value > 0 ? value : null;
}

const QUANTITY_PATTERN = /(\d+(?:[.,]\d+)?)\s*([a-zA-Zäöüß]+)/u;
/** `"6 x 1,5 l"` / `"6x1.5l"` — a multipack; total = count × per-pack. */
const MULTIPACK_PATTERN = /(\d+)\s*(?:x|×)\s*(\d+(?:[.,]\d+)?)\s*([a-zA-Zäöüß]+)/u;
/** `"32er-Pack"` — a German count-pack with no per-piece size. */
const ER_PACK_PATTERN = /(\d+)\s*er[\s-]?pack/iu;

/**
 * Parses a printed pack size. `null` for anything it does not FULLY understand —
 * the matcher treats that as "cannot verify", never as a wildcard.
 */
export function parseQuantity(raw: string | null | undefined): NormalizedQuantity | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim().toLowerCase();
  if (text === '') return null;

  const multipack = text.match(MULTIPACK_PATTERN);
  if (multipack) {
    const count = Number.parseInt(multipack[1], 10);
    const per = parseDecimal(multipack[2]);
    const unit = UNITS[multipack[3]];
    if (count > 0 && per !== null && unit) {
      return { dimension: unit.dimension, value: round(count * per * unit.factor) };
    }
    return null;
  }

  const erPack = text.match(ER_PACK_PATTERN);
  if (erPack) {
    const count = Number.parseInt(erPack[1], 10);
    return count > 0 ? { dimension: 'count', value: count } : null;
  }

  const simple = text.match(QUANTITY_PATTERN);
  if (simple) {
    const value = parseDecimal(simple[1]);
    const unit = UNITS[simple[2]];
    if (value !== null && unit) {
      return { dimension: unit.dimension, value: round(value * unit.factor) };
    }
  }
  return null;
}

/** 3 decimals in base units — enough to make 1,5 l === 1500 ml float-safe. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * The quantity gate: equal dimension AND equal base-unit value. Either side
 * unparseable → NOT equal (matching may only ever be confident, never hopeful).
 */
export function quantitiesEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = parseQuantity(a);
  const right = parseQuantity(b);
  if (left === null || right === null) return false;
  return left.dimension === right.dimension && left.value === right.value;
}
