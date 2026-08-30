import { AppException } from '../errors/app-exception';
import {
  gtinCheckDigit,
  isValidGtinChecksum,
  normalizeGtin,
  parseGtinOrThrow,
  withCheckDigit,
} from './gtin';

describe('GTIN checksum', () => {
  it.each([
    ['4012345000016', 'EAN-13 demo range'],
    ['4006381333931', 'EAN-13'],
    ['96385074', 'EAN-8'],
    ['036000291452', 'UPC-A'],
    ['00012345600012', 'GTIN-14'],
  ])('accepts %s (%s)', (gtin) => {
    expect(isValidGtinChecksum(gtin)).toBe(true);
  });

  it.each(['4012345000017', '4006381333932', '96385075', '036000291453'])(
    'rejects %s (wrong check digit)',
    (gtin) => {
      expect(isValidGtinChecksum(gtin)).toBe(false);
    },
  );

  it.each(['', '123', '12345678901', '123456789012345', 'abcdefgh', '4012 3450 0001'])(
    'rejects %s (wrong shape)',
    (gtin) => {
      expect(isValidGtinChecksum(gtin)).toBe(false);
    },
  );

  it('preserves leading zeros — GTIN is a string, never a number', () => {
    const gtin = '00012345600012';
    expect(normalizeGtin(gtin)).toBe(gtin);
    expect(isValidGtinChecksum(gtin)).toBe(true);
  });

  it('computes the check digit the seed relies on', () => {
    expect(gtinCheckDigit('401234500001')).toBe(6);
    expect(withCheckDigit('401234500001')).toBe('4012345000016');
    // Every appended check digit must round-trip through validation.
    for (let i = 1; i <= 10; i += 1) {
      const payload = `4012345${String(i).padStart(5, '0')}`;
      expect(isValidGtinChecksum(withCheckDigit(payload))).toBe(true);
    }
  });
});

describe('parseGtinOrThrow', () => {
  it('normalizes separators a scanner may emit', () => {
    expect(parseGtinOrThrow(' 4012345-000016 ')).toBe('4012345000016');
  });

  it('throws INVALID_GTIN for a malformed value', () => {
    expect.assertions(2);
    try {
      parseGtinOrThrow('12345');
    } catch (error) {
      expect(error).toBeInstanceOf(AppException);
      expect((error as AppException).code).toBe('INVALID_GTIN');
    }
  });

  it('throws INVALID_GTIN for a well-shaped value with a bad checksum', () => {
    expect.assertions(2);
    try {
      parseGtinOrThrow('4012345000017');
    } catch (error) {
      expect((error as AppException).code).toBe('INVALID_GTIN');
      expect((error as AppException).envelope.details).toMatchObject({ reason: 'checksum' });
    }
  });
});
