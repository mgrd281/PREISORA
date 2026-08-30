import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { PriceAlertDto } from '../../common/api/schemas';
import { AppException } from '../../common/errors/app-exception';
import { AppConfigService } from '../../config/app-config.service';
import { DATABASE, Database } from '../../database/database.module';
import { priceAlerts } from '../../database/schema';
import { ProductsService } from '../products/products.service';
import { AlertCreateDto, AlertUpdateDto } from './alerts.dto';

export interface AlertRow {
  id: string;
  userId: string;
  productId: string;
  targetAmountMinor: number;
  targetCurrencyCode: string;
  radiusMeters: number;
  lat: number;
  lng: number;
  isActive: boolean;
  lastTriggeredAt: Date | null;
  createdAt: Date;
}

export function toAlertDto(row: AlertRow): PriceAlertDto {
  return {
    id: row.id,
    productId: row.productId,
    targetPrice: {
      amountMinor: Number(row.targetAmountMinor),
      currencyCode: row.targetCurrencyCode.trim(),
    },
    radiusMeters: row.radiusMeters,
    location: { lat: row.lat, lng: row.lng },
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    lastTriggeredAt: row.lastTriggeredAt ? row.lastTriggeredAt.toISOString() : null,
  };
}

function point(lat: number, lng: number) {
  return sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography`;
}

@Injectable()
export class AlertsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly products: ProductsService,
    private readonly config: AppConfigService,
  ) {}

  private columns() {
    return {
      id: priceAlerts.id,
      userId: priceAlerts.userId,
      productId: priceAlerts.productId,
      targetAmountMinor: priceAlerts.targetAmountMinor,
      targetCurrencyCode: priceAlerts.targetCurrencyCode,
      radiusMeters: priceAlerts.radiusMeters,
      lat: sql<number>`ST_Y(${priceAlerts.location}::geometry)`,
      lng: sql<number>`ST_X(${priceAlerts.location}::geometry)`,
      isActive: priceAlerts.isActive,
      lastTriggeredAt: priceAlerts.lastTriggeredAt,
      createdAt: priceAlerts.createdAt,
    };
  }

  async listForUser(userId: string): Promise<PriceAlertDto[]> {
    const rows = (await this.db
      .select(this.columns())
      .from(priceAlerts)
      .where(eq(priceAlerts.userId, userId))
      .orderBy(desc(priceAlerts.createdAt))) as AlertRow[];
    return rows.map(toAlertDto);
  }

  async create(userId: string, input: AlertCreateDto): Promise<PriceAlertDto> {
    await this.products.assertExists(input.productId);

    const [inserted] = await this.db
      .insert(priceAlerts)
      .values({
        userId,
        productId: input.productId,
        targetAmountMinor: input.targetPrice.amountMinor,
        targetCurrencyCode: input.targetPrice.currencyCode,
        radiusMeters: input.radiusMeters ?? this.config.pricing.defaultRadiusMeters,
        location: sql`${point(input.location.lat, input.location.lng)}` as never,
        isActive: input.isActive ?? true,
      })
      .returning({ id: priceAlerts.id });

    return this.getOwned(userId, inserted.id);
  }

  async update(userId: string, alertId: string, patch: AlertUpdateDto): Promise<PriceAlertDto> {
    await this.getOwned(userId, alertId);

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.targetPrice !== undefined) {
      update.targetAmountMinor = patch.targetPrice.amountMinor;
      update.targetCurrencyCode = patch.targetPrice.currencyCode;
    }
    if (patch.radiusMeters !== undefined) update.radiusMeters = patch.radiusMeters;
    if (patch.isActive !== undefined) update.isActive = patch.isActive;
    if (patch.location !== undefined) {
      update.location = point(patch.location.lat, patch.location.lng);
    }

    await this.db
      .update(priceAlerts)
      .set(update)
      .where(and(eq(priceAlerts.id, alertId), eq(priceAlerts.userId, userId)));

    return this.getOwned(userId, alertId);
  }

  async remove(userId: string, alertId: string): Promise<void> {
    await this.db
      .delete(priceAlerts)
      .where(and(eq(priceAlerts.id, alertId), eq(priceAlerts.userId, userId)));
  }

  private async getOwned(userId: string, alertId: string): Promise<PriceAlertDto> {
    const [row] = (await this.db
      .select(this.columns())
      .from(priceAlerts)
      .where(and(eq(priceAlerts.id, alertId), eq(priceAlerts.userId, userId)))
      .limit(1)) as AlertRow[];
    if (!row) throw AppException.resourceNotFound('alert');
    return toAlertDto(row);
  }

  /** Every active alert — the alert engine's input. */
  async listActive(): Promise<AlertRow[]> {
    return (await this.db
      .select(this.columns())
      .from(priceAlerts)
      .where(eq(priceAlerts.isActive, true))) as AlertRow[];
  }

  async markTriggered(alertId: string, at: Date): Promise<void> {
    await this.db
      .update(priceAlerts)
      .set({ lastTriggeredAt: at, updatedAt: at })
      .where(eq(priceAlerts.id, alertId));
  }
}
