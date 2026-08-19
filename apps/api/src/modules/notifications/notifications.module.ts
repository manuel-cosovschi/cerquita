import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationSubscribers } from './notification.subscribers';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationSubscribers],
  exports: [NotificationsService],
})
export class NotificationsModule {}
