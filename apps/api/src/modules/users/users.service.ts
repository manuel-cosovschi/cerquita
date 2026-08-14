import { Injectable, NotFoundException } from '@nestjs/common';
import type { ListingSummary, RelationshipState, UserProfile } from '@cerquita/types';
import { resolveAudienceTier } from '@cerquita/domain';
import { PrismaService } from '../../prisma/prisma.service';
import { UserSerializer } from './user.serializer';
import { ListingsService } from '../listings/listings.service';
import { SocialProofService } from '../social/social-proof.service';
import type { ListingRow } from '../listings/listing.serializer';

/** What the owner of an account can see and change about it. */
export interface UserSettings {
  readonly discounts: { followerBasisPoints: number; friendBasisPoints: number };
  readonly privacy: {
    showSoldListings: boolean;
    showFavorites: boolean;
    showActivity: boolean;
    showPurchases: boolean;
  };
}

/**
 * Public profiles (spec §7, §34).
 *
 * Privacy preferences are applied here rather than in the client: a tab the user
 * chose to hide must not be reachable by calling the endpoint directly.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly serializer: UserSerializer,
    private readonly listings: ListingsService,
    private readonly socialProof: SocialProofService,
  ) {}

  async profileByUsername(username: string, viewerId?: string): Promise<UserProfile> {
    const user = await this.prisma.user.findUnique({
      where: { username },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        verified: true,
        bio: true,
        area: true,
        createdAt: true,
        ratingSum: true,
        reviewCount: true,
        salesCount: true,
        purchasesCount: true,
        plan: true,
        bannedAt: true,
        stores: {
          select: {
            store: {
              select: {
                id: true,
                handle: true,
                name: true,
                logoUrl: true,
                verified: true,
                ratingSum: true,
                reviewCount: true,
              },
            },
          },
        },
      },
    });

    if (!user || user.bannedAt) {
      throw new NotFoundException({ message: 'Perfil no encontrado', code: 'not_found' });
    }

    const [followerCount, followingCount, friendCount, relationship, proof] = await Promise.all([
      this.prisma.follow.count({ where: { followeeId: user.id } }),
      this.prisma.follow.count({ where: { followerId: user.id } }),
      this.prisma.friendship.count({
        where: { status: 'accepted', OR: [{ userAId: user.id }, { userBId: user.id }] },
      }),
      this.relationship(user.id, viewerId),
      // "Amiga de Nacho" — the sentence that decides whether a stranger trusts
      // this profile. It belongs on the profile itself, not only in search.
      this.socialProof.forSeller(user.id, viewerId),
    ]);

    return {
      ...this.serializer.toSummary(user),
      relationship,
      socialProof: proof.label,
      bio: user.bio ?? undefined,
      area: user.area ?? undefined,
      joinedAt: user.createdAt.toISOString(),
      salesCount: user.salesCount,
      purchasesCount: user.purchasesCount,
      followerCount,
      followingCount,
      friendCount,
      plan: user.plan,
      stores: user.stores.map((membership) => ({
        id: membership.store.id,
        handle: membership.store.handle,
        name: membership.store.name,
        logoUrl: membership.store.logoUrl ?? undefined,
        verified: membership.store.verified,
        rating:
          membership.store.reviewCount > 0
            ? membership.store.ratingSum / membership.store.reviewCount
            : undefined,
        followerCount: 0,
        activeListingCount: 0,
      })),
    };
  }

  /**
   * The viewer's relationship to a user, including the resolved pricing tier.
   * Computed server-side — this is what the pricing rules key off.
   */
  async relationship(userId: string, viewerId?: string): Promise<RelationshipState | undefined> {
    if (!viewerId || viewerId === userId) return undefined;

    const [following, followedBy, friendship, block] = await Promise.all([
      this.prisma.follow.findUnique({
        where: { followerId_followeeId: { followerId: viewerId, followeeId: userId } },
        select: { followerId: true },
      }),
      this.prisma.follow.findUnique({
        where: { followerId_followeeId: { followerId: userId, followeeId: viewerId } },
        select: { followerId: true },
      }),
      this.prisma.friendship.findFirst({
        where: {
          OR: [
            { userAId: viewerId, userBId: userId },
            { userAId: userId, userBId: viewerId },
          ],
        },
        select: { status: true },
      }),
      this.prisma.block.findFirst({
        where: {
          OR: [
            { blockerId: viewerId, blockedId: userId },
            { blockerId: userId, blockedId: viewerId },
          ],
        },
        select: { blockerId: true },
      }),
    ]);

    const state = {
      isFollowing: following !== null,
      isFollowedBy: followedBy !== null,
      friendship: friendship?.status ?? null,
      isBlocked: block !== null,
    };

    return { ...state, tier: resolveAudienceTier(state) };
  }

  /**
   * A profile tab's listings.
   *
   * `sold` is gated on the owner's privacy preference (spec §34) — hidden means
   * hidden, including from a direct API call.
   */
  async listingsForProfile(
    username: string,
    tab: 'selling' | 'wanted' | 'auctions' | 'sold',
    viewerId?: string,
  ): Promise<ListingSummary[]> {
    const user = await this.prisma.user.findUnique({
      where: { username },
      select: { id: true, showSoldListings: true },
    });

    if (!user) {
      throw new NotFoundException({ message: 'Perfil no encontrado', code: 'not_found' });
    }

    const isOwner = viewerId === user.id;
    if (tab === 'sold' && !user.showSoldListings && !isOwner) return [];

    const statusFilter =
      tab === 'sold' ? `l."status" = 'sold'` : `l."status" IN ('active', 'reserved')`;
    const kindFilter =
      tab === 'wanted'
        ? `AND l."kind" = 'wanted'`
        : tab === 'auctions'
          ? `AND l."kind" = 'auction'`
          : tab === 'selling'
            ? `AND l."kind" = 'sale'`
            : '';

    const rows = await this.prisma.$queryRawUnsafe<ListingRow[]>(
      `SELECT
         l."id", l."kind"::text AS "kind", l."status"::text AS "status",
         l."title", l."description", l."tags", l."categoryId",
         l."condition"::text AS "condition",
         l."priceAmount", l."priceCurrency", l."maxBudgetAmount", l."wantedRadiusMeters",
         l."quantity", l."reserved", l."sold",
         ARRAY(SELECT unnest(l."deliveryMethods")::text) AS "deliveryMethods",
         l."acceptsOffers", l."followerDiscountBps", l."friendDiscountBps",
         ST_Y(l."publicLocation"::geometry) AS "publicLat",
         ST_X(l."publicLocation"::geometry) AS "publicLng",
         l."neighborhood", l."city", l."region", l."country",
         l."viewCount", l."favoriteCount", l."commentCount", l."promotedUntil",
         l."publishedAt", l."createdAt", l."updatedAt",
         l."sellerId", l."storeId"
       FROM "Listing" l
       WHERE l."sellerId" = $1::uuid AND ${statusFilter} ${kindFilter}
       ORDER BY l."publishedAt" DESC NULLS LAST
       LIMIT 60`,
      user.id,
    );

    return this.listings.toSummaries(rows, viewerId);
  }

  async updateProfile(
    userId: string,
    patch: { displayName?: string; bio?: string; area?: string; avatarUrl?: string },
  ) {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: patch,
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        verified: true,
        ratingSum: true,
        reviewCount: true,
      },
    });
    return this.serializer.toSummary(updated);
  }

  /** Seller-wide social discount defaults, inherited by new listings (spec §24). */
  /**
   * Everything the settings screen needs, in one call.
   *
   * Discounts are stored in basis points and travel that way: a percentage
   * rounded for display and sent back would silently move the seller's own
   * pricing policy every time the screen is opened.
   */
  async settings(userId: string): Promise<UserSettings> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        followerDiscountBps: true,
        friendDiscountBps: true,
        showSoldListings: true,
        showFavorites: true,
        showActivity: true,
        showPurchases: true,
      },
    });

    if (!user) {
      throw new NotFoundException({ message: 'Perfil no encontrado', code: 'not_found' });
    }

    return {
      discounts: {
        followerBasisPoints: user.followerDiscountBps,
        friendBasisPoints: user.friendDiscountBps,
      },
      privacy: {
        showSoldListings: user.showSoldListings,
        showFavorites: user.showFavorites,
        showActivity: user.showActivity,
        showPurchases: user.showPurchases,
      },
    };
  }

  async updateDiscountPolicy(
    userId: string,
    policy: { followerBasisPoints: number; friendBasisPoints: number },
  ): Promise<{ ok: true }> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        followerDiscountBps: policy.followerBasisPoints,
        friendDiscountBps: policy.friendBasisPoints,
      },
    });
    return { ok: true };
  }

  async updatePrivacy(
    userId: string,
    preferences: {
      showSoldListings: boolean;
      showFavorites: boolean;
      showActivity: boolean;
      showPurchases: boolean;
    },
  ): Promise<{ ok: true }> {
    await this.prisma.user.update({ where: { id: userId }, data: preferences });
    return { ok: true };
  }
}
