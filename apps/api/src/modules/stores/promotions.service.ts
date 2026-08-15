import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import type { Promotion } from '@cerquita/types';
import type { CreatePromotionInput } from '@cerquita/validation';
import { canManageStore } from '@cerquita/domain';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/current-user.decorator';

/**
 * Store promotions (spec §55).
 *
 * The pricing engine already knows how to apply these — `resolvePrice` reads
 * them and decides whether they stack with a social discount. What was missing
 * was any way for a store to create one, which made the whole mechanism
 * unreachable from the product.
 *
 * Two rules are enforced here rather than left to the caller:
 *
 * 1. A promotion belongs to a store, and only that store's managers may touch
 *    it. Membership is read from the actor's resolved roles, never from a
 *    storeId in the body.
 * 2. Listings attached to a promotion must belong to the same store. Without
 *    that check a store could discount somebody else's listing.
 */
@Injectable()
export class PromotionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The store's LIVE promotions.
   *
   * Ended ones are excluded: "terminar" has to mean the row leaves the screen,
   * and a manager's list of things they can still change should not fill up
   * with things they cannot. The rows stay in the database — orders reference
   * the price they were charged.
   */
  async listForStore(storeId: string, actor: AuthenticatedUser): Promise<Promotion[]> {
    this.assertCanManage(actor, storeId);

    const rows = await this.prisma.promotion.findMany({
      where: {
        storeId,
        active: true,
        // A promotion whose end date has passed is over, whatever the flag says.
        OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return rows.map((row) => this.toPromotion(row));
  }

  async create(
    storeId: string,
    input: CreatePromotionInput,
    actor: AuthenticatedUser,
  ): Promise<Promotion> {
    this.assertCanManage(actor, storeId);

    const listingIds = input.listingIds ?? [];
    if (listingIds.length > 0) {
      // A promotion may only cover this store's own listings.
      const owned = await this.prisma.listing.count({
        where: { id: { in: listingIds }, storeId },
      });
      if (owned !== listingIds.length) {
        throw new BadRequestException({
          message: 'Alguna publicación no es de esta tienda',
          code: 'listing_not_in_store',
        });
      }
    }

    if (input.couponCode) {
      const taken = await this.prisma.promotion.findUnique({
        where: { couponCode: input.couponCode },
        select: { id: true },
      });
      if (taken) {
        throw new BadRequestException({
          message: 'Ese código de cupón ya está en uso',
          code: 'coupon_taken',
        });
      }
    }

    const created = await this.prisma.promotion.create({
      data: {
        storeId,
        kind: input.kind,
        label: input.label,
        basisPoints: input.basisPoints ?? null,
        fixedPriceAmount: input.fixedPrice?.amount ?? null,
        currency: input.fixedPrice?.currency ?? 'ARS',
        couponCode: input.couponCode ?? null,
        minimumQuantity: input.minimumQuantity ?? null,
        requiredTier: input.requiredTier,
        stacksWithSocialDiscount: input.stacksWithSocialDiscount,
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
        // Attached in the same statement, so a promotion is never briefly live
        // with no listings and then suddenly covering the catalogue.
        listings:
          listingIds.length > 0
            ? { create: listingIds.map((listingId) => ({ listingId })) }
            : undefined,
      },
    });

    return this.toPromotion(created);
  }

  /**
   * Ends a promotion rather than deleting it.
   *
   * Orders reference the price they were charged, and the audit trail of why a
   * buyer paid what they paid is worth keeping. `active: false` takes it out of
   * pricing immediately, which is what "delete" means to the person clicking.
   */
  async deactivate(
    storeId: string,
    promotionId: string,
    actor: AuthenticatedUser,
  ): Promise<{ ok: true }> {
    this.assertCanManage(actor, storeId);

    // Scoped by storeId so one store cannot end another's promotion by id.
    await this.prisma.promotion.updateMany({
      where: { id: promotionId, storeId },
      data: { active: false },
    });

    return { ok: true };
  }

  private assertCanManage(actor: AuthenticatedUser, storeId: string): void {
    if (!canManageStore({ userId: actor.userId, storeRoles: actor.storeRoles }, storeId)) {
      throw new ForbiddenException({
        message: 'No tenés permisos en esta tienda',
        code: 'forbidden',
      });
    }
  }

  private toPromotion(row: {
    id: string;
    kind: string;
    label: string;
    basisPoints: number | null;
    fixedPriceAmount: number | null;
    currency: string;
    couponCode: string | null;
    minimumQuantity: number | null;
    startsAt: Date | null;
    endsAt: Date | null;
  }): Promotion {
    return {
      id: row.id,
      kind: row.kind as Promotion['kind'],
      label: row.label,
      basisPoints: row.basisPoints ?? undefined,
      fixedPrice:
        row.fixedPriceAmount !== null
          ? { amount: row.fixedPriceAmount, currency: row.currency as 'ARS' }
          : undefined,
      couponCode: row.couponCode ?? undefined,
      minimumQuantity: row.minimumQuantity ?? undefined,
      startsAt: row.startsAt?.toISOString(),
      endsAt: row.endsAt?.toISOString(),
    };
  }
}
