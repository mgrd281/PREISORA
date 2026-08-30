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

export function encodeCursor(cursor: Cursor): string {
  const payload = JSON.stringify({ k: cursor.sortKey, i: cursor.id });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): Cursor {
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
  return { sortKey: record.k, id: record.i };
}
