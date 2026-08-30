import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PriceHistoryDto, PriceHistoryPointDto } from '../../common/api/schemas';
import { AppException } from '../../common/errors/app-exception';
import { DATABASE, Database } from '../../database/database.module';
import { priceObservations } from '../../database/schema';

export const PRICE_HISTORY_RANGES = ['7d', '30d', '90d'] as const;
export type PriceHistoryRange = (typeof PRICE_HISTORY_RANGES)[number];

const RANGE_DAYS: Record<PriceHistoryRange, number> = { '7d': 7, '30d': 30, '90d': 90 };

type AggregateRow = {
  day: string;
  currencyCode: string;
  minAmountMinor: string | number;
  avgAmountMinor: string | number;
  observations: string | number;
} & Record<string, unknown>;

@Injectable()
export class PriceHistoryService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  static parseRange(raw: unknown): PriceHistoryRange {
    if (raw === undefined || raw === null || raw === '') return '30d';
    if (typeof raw === 'string' && (PRICE_HISTORY_RANGES as readonly string[]).includes(raw)) {
      return raw as PriceHistoryRange;
    }
    throw new AppException('VALIDATION_FAILED', {
      field: 'range',
      allowed: [...PRICE_HISTORY_RANGES],
    });
  }

  /**
   * Daily min/avg over the append-only observation table, bucketed in UTC.
   * Amounts stay integer minor units end to end — never a float (§24).
   */
  async getHistory(productId: string, range: PriceHistoryRange): Promise<PriceHistoryDto> {
    const days = RANGE_DAYS[range];

    const result = await this.db.execute<AggregateRow>(sql`
      SELECT
        to_char(date_trunc('day', ${priceObservations.observedAt} AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
        ${priceObservations.currencyCode} AS "currencyCode",
        MIN(${priceObservations.priceAmountMinor}) AS "minAmountMinor",
        ROUND(AVG(${priceObservations.priceAmountMinor})) AS "avgAmountMinor",
        COUNT(*) AS observations
      FROM ${priceObservations}
      WHERE ${priceObservations.productId} = ${productId}
        AND ${priceObservations.observedAt} >= now() - (${days} || ' days')::interval
      GROUP BY 1, 2
      ORDER BY 1 ASC
    `);

    const rows = (result.rows ?? []) as AggregateRow[];

    // A product could in principle carry observations from markets with different
    // currencies; mixing them in one series would be meaningless, so the dominant
    // currency wins and the rest are omitted (single-currency in practice today).
    const observationsByCurrency = new Map<string, number>();
    for (const row of rows) {
      const currency = row.currencyCode.trim();
      observationsByCurrency.set(
        currency,
        (observationsByCurrency.get(currency) ?? 0) + Number(row.observations),
      );
    }
    let dominant: string | null = null;
    let dominantCount = -1;
    for (const [currency, count] of observationsByCurrency) {
      if (count > dominantCount) {
        dominant = currency;
        dominantCount = count;
      }
    }

    const points: PriceHistoryPointDto[] = rows
      .filter((row) => row.currencyCode.trim() === dominant)
      .map((row) => ({
        date: row.day,
        minAmountMinor: Number(row.minAmountMinor),
        avgAmountMinor: Number(row.avgAmountMinor),
        currencyCode: row.currencyCode.trim(),
      }));

    return { productId, range, points };
  }
}
