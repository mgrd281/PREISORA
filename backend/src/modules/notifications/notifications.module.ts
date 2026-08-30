import { Module } from '@nestjs/common';
import { DevicesModule } from '../devices/devices.module';
import { ApnsProviderStub, FcmProviderStub } from './notification-delivery.provider';
import { NotificationDispatchService } from './notification-dispatch.service';

@Module({
  imports: [DevicesModule],
  providers: [ApnsProviderStub, FcmProviderStub, NotificationDispatchService],
  exports: [NotificationDispatchService],
})
export class NotificationsModule {}
