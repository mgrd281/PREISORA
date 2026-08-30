import { AppException } from '../errors/app-exception';

/**
 * Opaque composite cursor (ADR-0002).
 *
 * The wire value is base64url of `{"k": <sortKey>, "i": <id>}`. Clients treat it as
 * a black box and pass it back verbatim; a malformed value is 400 VALIDATION_FAILED.
 */
export interface Cursor {
  /** The row's value in the query's primary sort column (e.g. the product name). */
  sortKey: string;
  /** The row's UUID — the tiebreaker that makes the ordering total. */
  id: string;
}

export interface DecodeCursorOptions {
  /**
   * Expected shape of the sort key. `'text'` (the default) accepts any string;
   * `'timestamp'` additionally requires an ISO-8601 UTC instant. Every call site
   * whose SQL casts or type-sensitively compares the sort key (e.g. `::timestamptz`)
   * MUST declare its shape — otherwise a cursor minted by a differently-sorted
   * endpoint raises a database error and surfaces as a 503 instead of the
   * contracted 400 VALIDATION_FAILED.
   */
  sortKey?: 'text' | 'timestamp';
}

/** `Date#toISOString()` millisecond form and the full-microsecond form both pass. */
const ISO_UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;

function isRealUtcInstant(value: string): boolean {
  if (!ISO_UTC_TIMESTAMP.test(value)) return false;
  const millis = Date.parse(value);
  if (Number.isNaN(millis)) return false;
  // `Date.parse` rolls calendar overflow over (Feb 31 -> Mar 3) where Postgres would
  // raise 22008, so the reparsed instant must render the same date and time back.
  return new Date(millis).toISOString().slice(0, 19) === value.slice(0, 19);
}

export function encodeCursor(cursor: Cursor): string {
  const payload = JSON.stringify({ k: cursor.sortKey, i: cursor.id });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

export function decodeCursor(raw: string, options: DecodeCursorOptions = {}): Cursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw new AppException('VALIDATION_FAILED', { field: 'cursor', reason: 'malformed' });
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).k !== 'string' ||
    typeof (parsed as Record<string, unknown>).i !== 'string'
  ) {
    throw new AppException('VALIDATION_FAILED', { field: 'cursor', reason: 'malformed' });
  }
  const record = parsed as { k: string; i: string };
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(record.i)) {
    throw new AppException('VALIDATION_FAILED', { field: 'cursor', reason: 'malformed' });
  }
  if (options.sortKey === 'timestamp' && !isRealUtcInstant(record.k)) {
    // e.g. a /search cursor (sortKey = product name) replayed against /favorites.
    throw new AppException('VALIDATION_FAILED', { field: 'cursor', reason: 'malformed' });
  }
  return { sortKey: record.k, id: record.i };
}
