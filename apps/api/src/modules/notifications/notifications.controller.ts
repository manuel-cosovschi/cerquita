import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { NOTIFICATION_TYPES, type NotificationItem, type Paginated } from '@cerquita/types';
import { NotificationsService } from './notifications.service';
import { zodBody } from '../../common/zod-validation.pipe';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';

const registerDeviceSchema = z.object({
  token: z.string().min(8).max(500),
  platform: z.enum(['ios', 'android', 'web']),
});

const preferenceSchema = z.object({
  type: z.enum(NOTIFICATION_TYPES),
  push: z.boolean().optional(),
  email: z.boolean().optional(),
  inApp: z.boolean().optional(),
});

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('cursor') cursor?: string,
  ): Promise<Paginated<NotificationItem>> {
    return this.notifications.list(user.userId, cursor);
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: AuthenticatedUser): Promise<{ count: number }> {
    return this.notifications.unreadCount(user.userId);
  }

  @Post(':id/read')
  markRead(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ ok: true }> {
    return this.notifications.markRead(user.userId, id);
  }

  @Post('read-all')
  markAllRead(@CurrentUser() user: AuthenticatedUser): Promise<{ ok: true }> {
    return this.notifications.markAllRead(user.userId);
  }

  @Post('devices')
  registerDevice(
    @Body(zodBody(registerDeviceSchema)) body: { token: string; platform: string },
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ ok: true }> {
    return this.notifications.registerDevice(user.userId, body.token, body.platform);
  }

  @Post('preferences')
  setPreference(
    @Body(zodBody(preferenceSchema))
    body: {
      type: (typeof NOTIFICATION_TYPES)[number];
      push?: boolean;
      email?: boolean;
      inApp?: boolean;
    },
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ ok: true }> {
    const { type, ...preference } = body;
    return this.notifications.setPreference(user.userId, type, preference);
  }
}
