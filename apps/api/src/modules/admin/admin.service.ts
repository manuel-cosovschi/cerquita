import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  adminRoleSatisfies,
  assessRisk,
  canChangeGlobalConfiguration,
  canModerate,
  canResolveDispute,
} from '@cerquita/domain';
import { DAY_MS } from '@cerquita/utils';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '../config/config.service';
import type { AuthenticatedUser } from '../../common/current-user.decorator';

/**
 * Administration (spec §70-§79).
 *
 * Two rules shape this module:
 *
 *  1. **Every sensitive action is audited.** Writing the audit entry happens in
 *     the same transaction as the action, so an action can never exist without
 *     its record of who did it and why. `reason` is required, not optional.
 *
 *  2. **Risk scoring is advisory.** It surfaces signals for a human to act on
 *     and takes no automatic irreversible action, which is what §76 asks for.
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Platform-wide metrics (spec §71). Aggregated in SQL. */
  async dashboard(actor: AuthenticatedUser) {
    this.assertRole(actor, 'support');

    const since = new Date(Date.now() - 30 * DAY_MS);

    const [users, listings, commerce, openWork] = await Promise.all([
      this.prisma.$queryRaw<Array<{ total: bigint; recent: bigint; suspended: bigint }>>`
        SELECT COUNT(*)                                              AS total,
               COUNT(*) FILTER (WHERE "createdAt" >= ${since})       AS recent,
               COUNT(*) FILTER (WHERE "bannedAt" IS NOT NULL
                                  OR "suspendedUntil" > NOW())       AS suspended
        FROM "User"
      `,
      this.prisma.$queryRaw<Array<{ active: bigint; sold: bigint; removed: bigint }>>`
        SELECT COUNT(*) FILTER (WHERE "status" = 'active')  AS active,
               COUNT(*) FILTER (WHERE "status" = 'sold')    AS sold,
               COUNT(*) FILTER (WHERE "status" = 'removed') AS removed
        FROM "Listing"
      `,
      this.prisma.$queryRaw<
        Array<{ orders: bigint; gmv: bigint | null; fees: bigint | null }>
      >`
        SELECT COUNT(*)                       AS orders,
               COALESCE(SUM("total"), 0)      AS gmv,
               COALESCE(SUM("platformFee"),0) AS fees
        FROM "Order"
        WHERE "status" IN ('paid','preparing','ready_for_pickup','shipped','delivered','completed')
      `,
      this.prisma.$queryRaw<Array<{ reports: bigint; disputes: bigint; auctions: bigint }>>`
        SELECT (SELECT COUNT(*) FROM "Report"  WHERE "status" IN ('open','reviewing'))          AS reports,
               (SELECT COUNT(*) FROM "Dispute" WHERE "status" IN ('opened','under_review'))     AS disputes,
               (SELECT COUNT(*) FROM "Auction" WHERE "status" = 'live')                         AS auctions
      `,
    ]);

    const commerceRow = commerce[0];
    const orders = Number(commerceRow?.orders ?? 0);
    const gmv = Number(commerceRow?.gmv ?? 0);

    return {
      users: {
        total: Number(users[0]?.total ?? 0),
        newLast30Days: Number(users[0]?.recent ?? 0),
        suspended: Number(users[0]?.suspended ?? 0),
      },
      listings: {
        active: Number(listings[0]?.active ?? 0),
        sold: Number(listings[0]?.sold ?? 0),
        removed: Number(listings[0]?.removed ?? 0),
      },
      commerce: {
        orders,
        gmv: { amount: gmv, currency: 'ARS' as const },
        fees: { amount: Number(commerceRow?.fees ?? 0), currency: 'ARS' as const },
        averageTicket: {
          amount: orders > 0 ? Math.round(gmv / orders) : 0,
          currency: 'ARS' as const,
        },
      },
      queue: {
        openReports: Number(openWork[0]?.reports ?? 0),
        openDisputes: Number(openWork[0]?.disputes ?? 0),
        liveAuctions: Number(openWork[0]?.auctions ?? 0),
      },
    };
  }

  async listReports(actor: AuthenticatedUser, status = 'open') {
    this.assertModerator(actor);

    return this.prisma.report.findMany({
      where: { status: status as never },
      orderBy: { createdAt: 'asc' },
      take: 50,
      select: {
        id: true,
        targetType: true,
        targetId: true,
        category: true,
        detail: true,
        status: true,
        createdAt: true,
        reporter: { select: { id: true, username: true } },
      },
    });
  }

  /**
   * Moderation actions (spec §73).
   *
   * The action and its audit entry are one transaction: there is no path that
   * suspends a user without recording who did it and why.
   */
  async moderate(
    input: {
      action: 'remove_listing' | 'restore_listing' | 'warn_user' | 'suspend_user' | 'ban_user';
      targetId: string;
      reason: string;
      suspendUntil?: Date;
    },
    actor: AuthenticatedUser,
  ): Promise<{ ok: true }> {
    this.assertModerator(actor);

    await this.prisma.$transaction(async (tx) => {
      let before: unknown;
      let after: unknown;
      let targetType = 'listing';

      switch (input.action) {
        case 'remove_listing':
        case 'restore_listing': {
          const listing = await tx.listing.findUnique({
            where: { id: input.targetId },
            select: { status: true },
          });
          if (!listing) {
            throw new NotFoundException({ message: 'Publicación no encontrada', code: 'not_found' });
          }
          const status = input.action === 'remove_listing' ? 'removed' : 'active';
          await tx.listing.update({ where: { id: input.targetId }, data: { status } });
          before = { status: listing.status };
          after = { status };
          break;
        }

        case 'warn_user': {
          // A warning changes no state; the audit entry IS the warning.
          targetType = 'user';
          before = null;
          after = { warned: true };
          break;
        }

        case 'suspend_user': {
          targetType = 'user';
          const user = await tx.user.findUnique({
            where: { id: input.targetId },
            select: { suspendedUntil: true },
          });
          if (!user) {
            throw new NotFoundException({ message: 'Usuario no encontrado', code: 'not_found' });
          }
          const until = input.suspendUntil ?? new Date(Date.now() + 7 * DAY_MS);
          await tx.user.update({ where: { id: input.targetId }, data: { suspendedUntil: until } });
          // Suspension must take effect now, not when the token expires.
          await tx.session.updateMany({
            where: { userId: input.targetId, revokedAt: null },
            data: { revokedAt: new Date() },
          });
          before = { suspendedUntil: user.suspendedUntil };
          after = { suspendedUntil: until };
          break;
        }

        case 'ban_user': {
          targetType = 'user';
          await tx.user.update({ where: { id: input.targetId }, data: { bannedAt: new Date() } });
          await tx.session.updateMany({
            where: { userId: input.targetId, revokedAt: null },
            data: { revokedAt: new Date() },
          });
          before = { bannedAt: null };
          after = { bannedAt: new Date().toISOString() };
          break;
        }
      }

      await tx.adminAuditLog.create({
        data: {
          adminId: actor.userId,
          action: input.action,
          targetType,
          targetId: input.targetId,
          reason: input.reason,
          before: before as never,
          after: after as never,
        },
      });
    });

    return { ok: true };
  }

  async resolveReport(
    reportId: string,
    resolution: 'actioned' | 'dismissed',
    actor: AuthenticatedUser,
  ): Promise<{ ok: true }> {
    this.assertModerator(actor);

    await this.prisma.report.update({
      where: { id: reportId },
      data: { status: resolution, resolvedBy: actor.userId, resolvedAt: new Date() },
    });
    return { ok: true };
  }

  async listDisputes(actor: AuthenticatedUser) {
    this.assertRole(actor, 'support');

    return this.prisma.dispute.findMany({
      where: { status: { in: ['opened', 'under_review'] } },
      orderBy: { createdAt: 'asc' },
      take: 50,
      include: {
        order: { select: { reference: true, total: true, currency: true } },
        evidence: { select: { id: true, url: true, note: true } },
      },
    });
  }

  async resolveDispute(
    disputeId: string,
    input: {
      resolution: 'resolved_buyer' | 'resolved_seller' | 'partial' | 'closed';
      refundAmount?: { amount: number };
      reason: string;
    },
    actor: AuthenticatedUser,
  ): Promise<{ ok: true }> {
    if (!canResolveDispute({ userId: actor.userId, adminRole: actor.adminRole })) {
      throw new ForbiddenException({ message: 'No podés resolver disputas', code: 'forbidden' });
    }

    await this.prisma.$transaction(async (tx) => {
      const dispute = await tx.dispute.findUnique({
        where: { id: disputeId },
        select: { id: true, status: true, orderId: true },
      });
      if (!dispute) {
        throw new NotFoundException({ message: 'Disputa no encontrada', code: 'not_found' });
      }

      await tx.dispute.update({
        where: { id: disputeId },
        data: {
          status: input.resolution,
          resolution: input.reason,
          refundAmount: input.refundAmount?.amount,
        },
      });

      await tx.adminAuditLog.create({
        data: {
          adminId: actor.userId,
          action: `resolve_dispute:${input.resolution}`,
          targetType: 'dispute',
          targetId: disputeId,
          reason: input.reason,
          before: { status: dispute.status } as never,
          after: { status: input.resolution } as never,
        },
      });
    });

    return { ok: true };
  }

  /** Risk assessment for one user. Advisory only — it decides nothing. */
  async assessUser(userId: string, actor: AuthenticatedUser) {
    this.assertModerator(actor);

    const now = new Date();
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, createdAt: true },
    });
    if (!user) {
      throw new NotFoundException({ message: 'Usuario no encontrado', code: 'not_found' });
    }

    const [listings24h, reports30d, orders, payments] = await Promise.all([
      this.prisma.listing.count({
        where: { sellerId: userId, createdAt: { gte: new Date(now.getTime() - DAY_MS) } },
      }),
      this.prisma.report.count({
        where: {
          targetType: 'user',
          targetId: userId,
          createdAt: { gte: new Date(now.getTime() - 30 * DAY_MS) },
        },
      }),
      this.prisma.$queryRaw<Array<{ total: bigint; cancelled: bigint }>>`
        SELECT COUNT(*) AS total,
               COUNT(*) FILTER (WHERE "status" = 'cancelled') AS cancelled
        FROM "Order" WHERE "sellerId" = ${userId}::uuid OR "buyerId" = ${userId}::uuid
      `,
      this.prisma.payment.count({
        where: { status: 'failed', order: { buyerId: userId } },
      }),
    ]);

    const assessment = assessRisk({
      userId,
      accountCreatedAt: user.createdAt,
      listingsLast24h: listings24h,
      reportsLast30d: reports30d,
      cancelledOrders: Number(orders[0]?.cancelled ?? 0),
      totalOrders: Number(orders[0]?.total ?? 0),
      failedPayments: payments,
      distinctDevicesLast7d: await this.prisma.deviceToken.count({ where: { userId } }),
      now,
    });

    // Stored so the admin UI can show how a score moved over time.
    await this.prisma.riskAssessment.create({
      data: {
        userId,
        score: assessment.score,
        band: assessment.band,
        signals: assessment.signals as never,
      },
    });

    return assessment;
  }

  async auditLog(actor: AuthenticatedUser, targetId?: string) {
    this.assertRole(actor, 'support');

    return this.prisma.adminAuditLog.findMany({
      where: targetId ? { targetId } : {},
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        action: true,
        targetType: true,
        targetId: true,
        reason: true,
        createdAt: true,
        admin: { select: { username: true } },
      },
    });
  }

  /** Operator-tunable settings, so nothing critical is hardcoded (spec §78). */
  async updateGlobalConfig(
    patch: Record<string, unknown>,
    actor: AuthenticatedUser,
  ): Promise<{ ok: true }> {
    if (!canChangeGlobalConfiguration({ userId: actor.userId, adminRole: actor.adminRole })) {
      throw new ForbiddenException({ message: 'No podés cambiar la configuración', code: 'forbidden' });
    }

    // Only the known settings are forwarded; anything else in the payload is
    // dropped rather than written blindly into the config row.
    const { featureFlags, ...rest } = patch as {
      featureFlags?: Record<string, boolean>;
    } & Record<string, unknown>;
    const settings: Record<string, number> = {};

    for (const key of [
      'platformFeeBasisPoints',
      'maxSearchRadiusMeters',
      'defaultReservationMinutes',
      'maxAuctionDurationDays',
    ] as const) {
      const value = rest[key];
      if (typeof value === 'number') settings[key] = value;
    }

    await this.prisma.$transaction(async (tx) => {
      const before = await tx.globalConfig.findUnique({ where: { id: 1 } });

      await tx.globalConfig.upsert({
        where: { id: 1 },
        update: settings,
        create: { id: 1, ...settings },
      });

      for (const [key, enabled] of Object.entries(featureFlags ?? {})) {
        await tx.featureFlag.upsert({
          where: { key },
          update: { enabled },
          create: { key, enabled },
        });
      }

      await tx.adminAuditLog.create({
        data: {
          adminId: actor.userId,
          action: 'update_global_config',
          targetType: 'config',
          targetId: '1',
          reason: 'Cambio de configuración global',
          before: before as never,
          after: patch as never,
        },
      });
    });

    this.config.invalidate();
    return { ok: true };
  }

  async featureFlags(actor: AuthenticatedUser) {
    this.assertRole(actor, 'support');
    return this.config.flags();
  }

  private assertModerator(actor: AuthenticatedUser): void {
    if (!canModerate({ userId: actor.userId, adminRole: actor.adminRole })) {
      throw new ForbiddenException({ message: 'Requiere permisos de moderación', code: 'forbidden' });
    }
  }

  private assertRole(actor: AuthenticatedUser, required: 'support' | 'admin'): void {
    if (!actor.adminRole || !adminRoleSatisfies(actor.adminRole, required)) {
      throw new ForbiddenException({ message: 'Acceso restringido', code: 'forbidden' });
    }
  }
}
