/**
 * Feature-flag scope resolution — pure, so the precedence rules are unit-testable
 * without a database (constitution §16-17).
 */

export interface FlagRow {
  flagKey: string;
  /** `null` = every country. */
  countryCode: string | null;
  /** `null` = every platform. */
  platform: string | null;
  /** `null` = every app version; otherwise a minimum, inclusive. */
  minAppVersion: string | null;
  /** `null` = every cohort. */
  cohort: string | null;
  enabled: boolean;
  createdAt?: Date | string;
}

export interface FlagContext {
  countryCode: string;
  platform: string | null;
  appVersion: string | null;
  cohort: string | null;
}

/** Dotted numeric comparison (`1.10.0` > `1.9.3`). Non-numeric parts compare as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.');
  const pb = b.split('.');
  const length = Math.max(pa.length, pb.length);
  for (let i = 0; i < length; i += 1) {
    const na = Number.parseInt(pa[i] ?? '0', 10);
    const nb = Number.parseInt(pb[i] ?? '0', 10);
    const va = Number.isFinite(na) ? na : 0;
    const vb = Number.isFinite(nb) ? nb : 0;
    if (va !== vb) return va < vb ? -1 : 1;
  }
  return 0;
}

/** A row applies only if every non-null scope column matches the request context. */
export function flagMatches(row: FlagRow, ctx: FlagContext): boolean {
  if (row.countryCode !== null && row.countryCode.trim() !== ctx.countryCode) return false;
  if (row.platform !== null && row.platform !== ctx.platform) return false;
  if (row.cohort !== null && row.cohort !== ctx.cohort) return false;
  if (row.minAppVersion !== null) {
    if (ctx.appVersion === null) return false;
    if (compareVersions(ctx.appVersion, row.minAppVersion) < 0) return false;
  }
  return true;
}

/**
 * Specificity weight. Country is the strongest scope, then platform, then a
 * minimum app version, then cohort — so a `DE`-scoped row beats a global one and a
 * `DE`+`ios` row beats both.
 */
export function specificity(row: FlagRow): number {
  return (
    (row.countryCode !== null ? 8 : 0) +
    (row.platform !== null ? 4 : 0) +
    (row.minAppVersion !== null ? 2 : 0) +
    (row.cohort !== null ? 1 : 0)
  );
}

/**
 * Most-specific-wins; ties break on the newer row. A flag with no matching row at
 * all is OFF — features are opt-in, never accidentally shipped.
 */
export function resolveFlag(rows: FlagRow[], flagKey: string, ctx: FlagContext): boolean {
  let winner: FlagRow | null = null;
  let winnerScore = -1;

  for (const row of rows) {
    if (row.flagKey !== flagKey) continue;
    if (!flagMatches(row, ctx)) continue;
    const score = specificity(row);
    if (score > winnerScore) {
      winner = row;
      winnerScore = score;
      continue;
    }
    if (score === winnerScore && winner && row.createdAt && winner.createdAt) {
      if (new Date(row.createdAt).getTime() > new Date(winner.createdAt).getTime()) {
        winner = row;
      }
    }
  }

  return winner?.enabled ?? false;
}
