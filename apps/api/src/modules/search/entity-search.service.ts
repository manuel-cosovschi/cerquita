import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UserSerializer, USER_SUMMARY_SELECT } from '../users/user.serializer';
import { SocialProofService } from '../social/social-proof.service';

/**
 * Searching people and stores, not just things — direction 1c.
 *
 * "buscás personas igual que objetos" is the point: in a hyperlocal marketplace
 * you often remember the seller, not the listing. Results carry social proof so
 * a stranger and a friend-of-a-friend do not look the same.
 */
@Injectable()
export class EntitySearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserSerializer,
    private readonly socialProof: SocialProofService,
  ) {}

  async searchPeople(query: string, viewerId?: string, limit = 20) {
    const term = query.trim();
    if (term.length < 2) return [];

    const people = await this.prisma.user.findMany({
      where: {
        bannedAt: null,
        ...(viewerId ? { id: { not: viewerId } } : {}),
        OR: [
          { username: { contains: term, mode: 'insensitive' } },
          { displayName: { contains: term, mode: 'insensitive' } },
        ],
      },
      take: limit,
      select: { ...USER_SUMMARY_SELECT, area: true, salesCount: true },
    });

    return Promise.all(
      people.map(async (person) => ({
        ...this.users.toSummary(person),
        area: person.area ?? undefined,
        salesCount: person.salesCount,
        // The reason to trust them, resolved per viewer.
        socialProof: (await this.socialProof.forSeller(person.id, viewerId)).label,
      })),
    );
  }

  async searchStores(query: string, viewerId?: string, limit = 20) {
    const term = query.trim();
    if (term.length < 2) return [];

    const stores = await this.prisma.store.findMany({
      where: {
        OR: [
          { name: { contains: term, mode: 'insensitive' } },
          { handle: { contains: term, mode: 'insensitive' } },
          { categories: { has: term } },
        ],
      },
      take: limit,
      select: {
        id: true,
        handle: true,
        name: true,
        logoUrl: true,
        verified: true,
        ratingSum: true,
        reviewCount: true,
        address: true,
        hasPhysicalLocation: true,
        _count: { select: { followers: true, listings: true } },
      },
    });

    const followed = viewerId
      ? new Set(
          (
            await this.prisma.storeFollow.findMany({
              where: { userId: viewerId, storeId: { in: stores.map((store) => store.id) } },
              select: { storeId: true },
            })
          ).map((row) => row.storeId),
        )
      : new Set<string>();

    return stores.map((store) => ({
      id: store.id,
      handle: store.handle,
      name: store.name,
      logoUrl: store.logoUrl ?? undefined,
      verified: store.verified,
      rating: store.reviewCount > 0 ? store.ratingSum / store.reviewCount : undefined,
      followerCount: store._count.followers,
      activeListingCount: store._count.listings,
      address: store.hasPhysicalLocation ? (store.address ?? undefined) : undefined,
      isFollowedByViewer: followed.has(store.id),
    }));
  }

  /**
   * The 1c banner: "2 personas que seguís tienen una PS5 publicada".
   *
   * It turns the social graph into a result rather than decoration — and it is
   * the cheapest possible query, because the alternative (ranking every listing
   * by social distance) is not worth the cost at this size.
   */
  async socialHint(query: string, viewerId?: string) {
    const term = query.trim();
    if (!viewerId || term.length < 2) return null;

    const rows = await this.prisma.$queryRaw<Array<{ id: string; displayName: string }>>`
      SELECT DISTINCT u."id", u."displayName"
      FROM "Listing" l
      JOIN "User" u ON u."id" = l."sellerId"
      WHERE l."status" = 'active'
        AND l."searchVector" @@ plainto_tsquery('spanish', ${term})
        AND (
          EXISTS (
            SELECT 1 FROM "Follow" f
            WHERE f."followerId" = ${viewerId}::uuid AND f."followeeId" = l."sellerId"
          )
          OR EXISTS (
            SELECT 1 FROM "Friendship" fr
            WHERE fr."status" = 'accepted'
              AND (
                (fr."userAId" = ${viewerId}::uuid AND fr."userBId" = l."sellerId")
                OR (fr."userBId" = ${viewerId}::uuid AND fr."userAId" = l."sellerId")
              )
          )
        )
      LIMIT 5
    `;

    if (rows.length === 0) return null;

    return {
      count: rows.length,
      people: rows.map((row) => ({ id: row.id, displayName: row.displayName })),
      label:
        rows.length === 1
          ? `${rows[0]!.displayName} tiene algo publicado`
          : `${rows.length} personas que seguís tienen algo publicado`,
    };
  }
}
