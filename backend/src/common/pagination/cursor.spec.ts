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
