import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { AppConfigService } from '../../config/app-config.service';
import { PriceRankingService } from '../offers/price-ranking.service';
import { NotificationDispatchService } from '../notifications/notification-dispatch.service';
import { AlertsService } from './alerts.service';

const HOUR_MS = 60 * 60 * 1000;

/**
 * The ONE alert engine (constitution §10): alerts are never evaluated client-side.
 *
 * Every 15 minutes it walks the active alerts, asks `PriceRankingService` for the
 * best FRESH offer inside each alert's own radius, and dispatches when that price is
 * at or below the target.
 *
 * Known limitation (plan "Known risks"): single-instance. Running two API instances
 * would evaluate every alert twice — a Redis lock is the prerequisite for horizontal
 * scaling. Registration is skipped entirely under NODE_ENV=test.
 */
@Injectable()
export class AlertEngineService implements OnModuleInit {
  private readonly logger = new Logger(AlertEngineService.name);
  private running = false;

  constructor(
    private readonly alerts: AlertsService,
    private readonly ranking: PriceRankingService,
    private readonly notifications: NotificationDispatchService,
    private readonly config: AppConfigService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    if (this.config.isTest) {
      this.logger.log('alert engine cron disabled (NODE_ENV=test)');
      return;
    }
    const job = new CronJob(this.config.alerts.cron, () => {
      void this.runOnce();
    });
    this.scheduler.addCronJob('alert-engine', job as never);
    job.start();
    this.logger.log(`alert engine scheduled: ${this.config.alerts.cron}`);
  }

  /** Exposed so tests and operators can trigger one pass deterministically. */
  async runOnce(now: Date = new Date()): Promise<{ evaluated: number; triggered: number }> {
    if (this.running) {
      this.logger.warn('alert engine pass still running; skipping this tick');
      return { evaluated: 0, triggered: 0 };
    }
    this.running = true;
    let evaluated = 0;
    let triggered = 0;

    try {
      const active = await this.alerts.listActive();
      const cooldownMs = this.config.alerts.retriggerCooldownHours * HOUR_MS;

      for (const alert of active) {
        evaluated += 1;
        if (
          alert.lastTriggeredAt &&
          now.getTime() - alert.lastTriggeredAt.getTime() < cooldownMs
        ) {
          continue;
        }

        const { offers } = await this.ranking.rankForProduct(
          alert.productId,
          { lat: alert.lat, lng: alert.lng },
          alert.radiusMeters,
          now,
        );
        const best = offers.find((offer) => offer.isBest);
        if (!best) continue;
        if (best.currencyCode.trim() !== alert.targetCurrencyCode.trim()) continue;
        if (best.effectiveAmountMinor > Number(alert.targetAmountMinor)) continue;

        await this.notifications.dispatchToUser(alert.userId, {
          titleKey: 'notification.price_alert.title',
          bodyKey: 'notification.price_alert.body',
          data: {
            alertId: alert.id,
            productId: alert.productId,
            offerId: best.id,
            amountMinor: best.effectiveAmountMinor,
            currencyCode: best.currencyCode.trim(),
          },
        });
        await this.alerts.markTriggered(alert.id, now);
        triggered += 1;
      }
    } catch (error) {
      this.logger.error(`alert engine pass failed: ${String(error)}`);
    } finally {
      this.running = false;
    }

    this.logger.log(`alert engine pass: evaluated=${evaluated} triggered=${triggered}`);
    return { evaluated, triggered };
  }
}
