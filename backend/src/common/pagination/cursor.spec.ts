import { AppException } from '../errors/app-exception';
import { decodeCursor, encodeCursor } from './cursor';
import { cursorPage, wholePage } from './page';

const ID = '3fa2d1b8-5c44-4a7e-9b0e-6f2a91c47d55';

describe('cursor encode/decode', () => {
  it('round-trips a (sortKey, id) pair', () => {
    const cursor = { sortKey: 'Vollmilch 3,5%', id: ID };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it('is base64url — no +, / or = in the wire value', () => {
    const encoded = encodeCursor({ sortKey: 'Nuss-Nougat-Creme ??? ÄÖÜ', id: ID });
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('is opaque: the client cannot read the sort key off it directly', () => {
    const encoded = encodeCursor({ sortKey: 'Butter', id: ID });
    expect(encoded).not.toContain('Butter');
  });

  it.each(['not-base64!!', 'YWJj', encodeCursor({ sortKey: 'x', id: 'not-a-uuid' })])(
    'rejects malformed cursor %s with VALIDATION_FAILED',
    (raw) => {
      expect.assertions(2);
      try {
        decodeCursor(raw);
      } catch (error) {
        expect(error).toBeInstanceOf(AppException);
        expect((error as AppException).code).toBe('VALIDATION_FAILED');
      }
    },
  );

  describe('sortKey: timestamp', () => {
    it('accepts a millisecond toISOString() key and a full-microsecond key', () => {
      for (const sortKey of ['2026-08-30T12:00:00.123Z', '2026-08-30T12:00:00.123456Z']) {
        const decoded = decodeCursor(encodeCursor({ sortKey, id: ID }), { sortKey: 'timestamp' });
        expect(decoded).toEqual({ sortKey, id: ID });
      }
    });

    it.each([
      // A /search cursor (sortKey = product name) replayed against a timestamp endpoint.
      'Vollmilch 3,5%',
      // Shape-valid but not a real instant — would still raise 22008 in Postgres.
      '2026-13-01T00:00:00Z',
      // `Date.parse` rolls this over to Mar 3; Postgres would reject it.
      '2026-02-31T00:00:00Z',
      // Not UTC-normalized: never minted by this API.
      '2026-08-30T12:00:00.123+02:00',
    ])('rejects non-timestamp sortKey %s with VALIDATION_FAILED', (sortKey) => {
      expect.assertions(2);
      try {
        decodeCursor(encodeCursor({ sortKey, id: ID }), { sortKey: 'timestamp' });
      } catch (error) {
        expect(error).toBeInstanceOf(AppException);
        expect((error as AppException).code).toBe('VALIDATION_FAILED');
      }
    });

    it('still accepts any string under the default text shape', () => {
      const cursor = { sortKey: 'Vollmilch 3,5%', id: ID };
      expect(decodeCursor(encodeCursor(cursor), { sortKey: 'text' })).toEqual(cursor);
    });
  });
});

describe('page envelopes', () => {
  it('wholePage always reports no next page', () => {
    expect(wholePage([1, 2, 3])).toEqual({
      data: [1, 2, 3],
      pageInfo: { nextCursor: null, hasMore: false },
    });
  });

  it('cursorPage drops the probe row and emits a next cursor', () => {
    const rows = [
      { name: 'A', id: ID },
      { name: 'B', id: ID },
      { name: 'C', id: ID },
    ];
    const page = cursorPage(rows, 2, (row) => ({ sortKey: row.name, id: row.id }));
    expect(page.data).toHaveLength(2);
    expect(page.pageInfo.hasMore).toBe(true);
    expect(decodeCursor(page.pageInfo.nextCursor as string)).toEqual({ sortKey: 'B', id: ID });
  });

  it('cursorPage ends the sequence when no probe row came back', () => {
    const rows = [{ name: 'A', id: ID }];
    const page = cursorPage(rows, 2, (row) => ({ sortKey: row.name, id: row.id }));
    expect(page.pageInfo).toEqual({ nextCursor: null, hasMore: false });
  });
});
