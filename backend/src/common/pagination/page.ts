import { Cursor, encodeCursor } from './cursor';

/** The one list envelope every collection response uses (ADR-0002). */
export interface Page<T> {
  data: T[];
  pageInfo: { nextCursor: string | null; hasMore: boolean };
}

/**
 * Wraps a whole, non-cursored collection. Used by the small user-scoped lists and
 * by the capped geo lists — adding real cursors later is additive.
 */
export function wholePage<T>(data: T[]): Page<T> {
  return { data, pageInfo: { nextCursor: null, hasMore: false } };
}

/**
 * Builds a cursored page from a slice fetched with `limit + 1` rows: the extra row
 * is the existence proof for `hasMore` and is dropped from the payload.
 */
export function cursorPage<T>(
  rows: T[],
  limit: number,
  toCursor: (row: T) => Cursor,
): Page<T> {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data.length > 0 ? data[data.length - 1] : undefined;
  return {
    data,
    pageInfo: {
      nextCursor: hasMore && last !== undefined ? encodeCursor(toCursor(last)) : null,
      hasMore,
    },
  };
}
