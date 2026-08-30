import { Injectable, Logger } from '@nestjs/common';
import type { DevicePlatform } from '../../database/schema';
import { DevicesService } from '../devices/devices.module';
import {
  ApnsProviderStub,
  FcmProviderStub,
  NotificationDeliveryProvider,
  NotificationPayload,
} from './notification-delivery.provider';

/**
 * Routes a notification to every registered device of an account, choosing the
 * provider by `device.platform`. One dispatcher, N platform providers — adding
 * Android costs nothing above this line (constitution §10).
 */
@Injectable()
export class NotificationDispatchService {
  private readonly logger = new Logger(NotificationDispatchService.name);
  private readonly providers: Map<DevicePlatform, NotificationDeliveryProvider>;

  constructor(
    private readonly devices: DevicesService,
    apns: ApnsProviderStub,
    fcm: FcmProviderStub,
  ) {
    this.providers = new Map<DevicePlatform, NotificationDeliveryProvider>([
      ['ios', apns],
      ['android', fcm],
    ]);
  }

  async dispatchToUser(userId: string, payload: NotificationPayload): Promise<number> {
    const targets = await this.devices.listForUser(userId);
    let delivered = 0;

    for (const device of targets) {
      const provider = this.providers.get(device.platform);
      if (!provider) {
        this.logger.warn(`no delivery provider for platform ${device.platform}`);
        continue;
      }
      try {
        await provider.send(
          {
            deviceId: device.id,
            platform: device.platform,
            pushToken: device.pushToken,
            locale: device.locale,
          },
          payload,
        );
        delivered += 1;
      } catch (error) {
        // A single bad token must never abort the whole dispatch run.
        this.logger.warn(`delivery failed for device ${device.id}: ${String(error)}`);
      }
    }

    return delivered;
  }
}
