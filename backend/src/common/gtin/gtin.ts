import { AppException } from '../errors/app-exception';

/** Lengths the contract accepts: EAN-8, UPC-A, EAN-13, GTIN-14. */
const VALID_LENGTHS = new Set([8, 12, 13, 14]);

/**
 * GTIN check-digit validation (GS1 modulo-10).
 *
 * Weights alternate 3/1 from the RIGHT of the payload, which is what makes the same
 * routine correct for GTIN-8, 12, 13 and 14 without per-length special cases.
 */
export function isValidGtinChecksum(gtin: string): boolean {
  if (!/^\d+$/.test(gtin) || !VALID_LENGTHS.has(gtin.length)) return false;
  const digits = [...gtin].map((d) => Number.parseInt(d, 10));
  const check = digits.pop() as number;
  let sum = 0;
  // digits now holds the payload; weight the rightmost payload digit with 3.
  for (let i = digits.length - 1, weight = 3; i >= 0; i -= 1, weight = weight === 3 ? 1 : 3) {
    sum += digits[i] * weight;
  }
  return (10 - (sum % 10)) % 10 === check;
}

/** Computes the check digit for a payload WITHOUT its check digit (7/11/12/13 digits). */
export function gtinCheckDigit(payload: string): number {
  if (!/^\d+$/.test(payload)) {
    throw new Error(`gtinCheckDigit: non-numeric payload "${payload}"`);
  }
  const digits = [...payload].map((d) => Number.parseInt(d, 10));
  let sum = 0;
  for (let i = digits.length - 1, weight = 3; i >= 0; i -= 1, weight = weight === 3 ? 1 : 3) {
    sum += digits[i] * weight;
  }
  return (10 - (sum % 10)) % 10;
}

/** Appends the correct check digit to a payload. Used by the seed to emit valid demo EANs. */
export function withCheckDigit(payload: string): string {
  return `${payload}${gtinCheckDigit(payload)}`;
}

/**
 * Trims surrounding whitespace and drops separators a scanner may emit. Leading
 * zeros are ALWAYS preserved — GTIN is a string, never a number (CONVENTIONS.md).
 */
export function normalizeGtin(raw: string): string {
  return raw.trim().replace(/[\s-]/g, '');
}

/**
 * The one entry point every GTIN-taking endpoint uses. Throws `INVALID_GTIN`
 * BEFORE any database access, per the contract.
 */
export function parseGtinOrThrow(raw: string): string {
  const normalized = normalizeGtin(raw ?? '');
  if (!VALID_LENGTHS.has(normalized.length) || !/^\d+$/.test(normalized)) {
    throw new AppException('INVALID_GTIN', { gtin: raw, reason: 'malformed' });
  }
  if (!isValidGtinChecksum(normalized)) {
    throw new AppException('INVALID_GTIN', { gtin: raw, reason: 'checksum' });
  }
  return normalized;
}
