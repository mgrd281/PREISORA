import { Injectable, Logger } from '@nestjs/common';
import type { DevicePlatform } from '../../database/schema';

/** Platform-neutral push payload — never an APNs/FCM-shaped object (§10). */
export interface NotificationPayload {
  /** Dot-namespaced key the CLIENT localizes; the backend never sends copy (§33). */
  titleKey: string;
  bodyKey: string;
  /** Machine-readable data for the client's deep-link routing. */
  data: Record<string, string | number>;
}

export interface DeliveryTarget {
  deviceId: string;
  platform: DevicePlatform;
  pushToken: string;
  locale: string;
}

/**
 * The seam for real push delivery. Swapping a stub for a real APNs/FCM client is a
 * provider change only — nothing above this interface knows the difference.
 */
export interface NotificationDeliveryProvider {
  readonly platform: DevicePlatform;
  send(target: DeliveryTarget, payload: NotificationPayload): Promise<void>;
}

/** STUB: structured log only. Real APNs needs a p8 key + team/bundle identifiers. */
@Injectable()
export class ApnsProviderStub implements NotificationDeliveryProvider {
  readonly platform = 'ios' as const;
  private readonly logger = new Logger('ApnsProviderStub');

  async send(target: DeliveryTarget, payload: NotificationPayload): Promise<void> {
    this.logger.log(
      JSON.stringify({
        provider: 'apns-stub',
        deviceId: target.deviceId,
        locale: target.locale,
        titleKey: payload.titleKey,
        bodyKey: payload.bodyKey,
        data: payload.data,
      }),
    );
  }
}

/** STUB: structured log only. Real FCM needs a service account + project id. */
@Injectable()
export class FcmProviderStub implements NotificationDeliveryProvider {
  readonly platform = 'android' as const;
  private readonly logger = new Logger('FcmProviderStub');

  async send(target: DeliveryTarget, payload: NotificationPayload): Promise<void> {
    this.logger.log(
      JSON.stringify({
        provider: 'fcm-stub',
        deviceId: target.deviceId,
        locale: target.locale,
        titleKey: payload.titleKey,
        bodyKey: payload.bodyKey,
        data: payload.data,
      }),
    );
  }
}
