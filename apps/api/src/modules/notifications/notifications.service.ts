import { Inject, Injectable, Logger } from '@nestjs/common';
import type { NotificationItem, NotificationType, Paginated } from '@cerquita/types';
import { PrismaService } from '../../prisma/prisma.service';
import { PUSH_PROVIDER, type PushProvider } from '../../providers/push/push-provider';

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  imageUrl?: string;
  deepLink?: string;
  data?: Record<string, unknown>;
}

/**
 * Notifications (spec §56, §57).
 *
 * The in-app record is always written; push delivery is best-effort on top. That
 * ordering matters — if the push provider is down or unconfigured, the user must
 * still see the notification when they open the app.
 *
 * Per-type preferences are honoured, defaulting to on for in-app and push. A
 * user who has never touched settings should still hear about a sale.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PUSH_PROVIDER) private readonly push: PushProvider,
  ) {}

  async create(input: CreateNotificationInput): Promise<void> {
    const preference = await this.prisma.notificationPreference.findUnique({
      where: { userId_type: { userId: input.userId, type: input.type } },
    });

    const wantsInApp = preference?.inApp ?? true;
    const wantsPush = preference?.push ?? true;

    if (wantsInApp) {
      await this.prisma.notification.create({
        data: {
          userId: input.userId,
          type: input.type,
          title: input.title,
          body: input.body,
          imageUrl: input.imageUrl,
          deepLink: input.deepLink,
          data: (input.data ?? undefined) as never,
        },
      });
    }

    if (!wantsPush) return;

    const devices = await this.prisma.deviceToken.findMany({
      where: { userId: input.userId },
      select: { token: true },
    });
    if (devices.length === 0) return;

    try {
      const result = await this.push.send({
        tokens: devices.map((device) => device.token),
        type: input.type,
        title: input.title,
        body: input.body,
        deepLink: input.deepLink,
      });

      // Providers report tokens that will never work again; keeping them would
      // mean retrying dead devices forever.
      if (result.invalidTokens.length > 0) {
        await this.prisma.deviceToken.deleteMany({
          where: { token: { in: result.invalidTokens } },
        });
      }
    } catch (error) {
      // A push failure must never fail the action that triggered it.
      this.logger.warn(
        `Push delivery failed for ${input.userId}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  /** Fans a notification out to several recipients, skipping the actor. */
  async createMany(
    userIds: readonly string[],
    build: (userId: string) => CreateNotificationInput,
  ): Promise<void> {
    for (const userId of new Set(userIds)) {
      await this.create(build(userId));
    }
  }

  async list(userId: string, cursor?: string, limit = 30): Promise<Paginated<NotificationItem>> {
    const rows = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return {
      items: page.map((row) => ({
        id: row.id,
        type: row.type,
        title: row.title,
        body: row.body ?? undefined,
        imageUrl: row.imageUrl ?? undefined,
        deepLink: row.deepLink ?? undefined,
        readAt: row.readAt?.toISOString(),
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  async unreadCount(userId: string): Promise<{ count: number }> {
    return { count: await this.prisma.notification.count({ where: { userId, readAt: null } }) };
  }

  async markRead(userId: string, notificationId: string): Promise<{ ok: true }> {
    // Scoped by userId so one user cannot mark another's notifications read.
    await this.prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }

  async markAllRead(userId: string): Promise<{ ok: true }> {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }

  async registerDevice(userId: string, token: string, platform: string): Promise<{ ok: true }> {
    // A device can change hands; the token belongs to whoever registered it last.
    await this.prisma.deviceToken.upsert({
      where: { token },
      update: { userId, platform },
      create: { userId, token, platform },
    });
    return { ok: true };
  }

  async setPreference(
    userId: string,
    type: NotificationType,
    preference: { push?: boolean; email?: boolean; inApp?: boolean },
  ): Promise<{ ok: true }> {
    await this.prisma.notificationPreference.upsert({
      where: { userId_type: { userId, type } },
      update: preference,
      create: { userId, type, ...preference },
    });
    return { ok: true };
  }
}
