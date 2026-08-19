import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Social proof — direction 1c's core mechanism.
 *
 * The board puts it better than we could: *"el grafo social es el mecanismo:
 * 'amiga de Nacho' pesa más que cualquier badge de verificado"*. A mutual
 * connection is a real reference; a verified tick is a claim about an identity,
 * not about trustworthiness.
 *
 * This resolves "how do I know this person" into a sentence, without exposing
 * the viewer's graph to the seller or vice versa: only the NAMES of mutuals the
 * viewer already knows are returned, which the viewer could see anyway.
 */
export interface SocialProof {
  /** Direct relationship, if any. Beats any mutual connection. */
  readonly direct: 'friend' | 'following' | null;
  /** Friends the viewer and the seller have in common. */
  readonly mutualFriends: Array<{ id: string; displayName: string }>;
  readonly mutualCount: number;
  /** Ready-to-render sentence, e.g. "amiga de Nacho". Null when there is none. */
  readonly label: string | null;
}

@Injectable()
export class SocialProofService {
  constructor(private readonly prisma: PrismaService) {}

  async forSeller(sellerId: string, viewerId?: string): Promise<SocialProof> {
    const empty: SocialProof = {
      direct: null,
      mutualFriends: [],
      mutualCount: 0,
      label: null,
    };

    if (!viewerId || viewerId === sellerId) return empty;

    const [friendship, follow] = await Promise.all([
      this.prisma.friendship.findFirst({
        where: {
          status: 'accepted',
          OR: [
            { userAId: viewerId, userBId: sellerId },
            { userAId: sellerId, userBId: viewerId },
          ],
        },
        select: { id: true },
      }),
      this.prisma.follow.findUnique({
        where: { followerId_followeeId: { followerId: viewerId, followeeId: sellerId } },
        select: { followerId: true },
      }),
    ]);

    if (friendship) {
      return { direct: 'friend', mutualFriends: [], mutualCount: 0, label: 'Tu amigo' };
    }

    const mutuals = await this.mutualFriends(viewerId, sellerId);

    if (mutuals.length === 0) {
      return follow
        ? { direct: 'following', mutualFriends: [], mutualCount: 0, label: 'Lo seguís' }
        : empty;
    }

    return {
      direct: follow ? 'following' : null,
      mutualFriends: mutuals.slice(0, 3),
      mutualCount: mutuals.length,
      label: buildLabel(mutuals),
    };
  }

  /**
   * Friends in common, resolved in one query.
   *
   * Friendships are stored under a canonical (userA < userB) ordering, so
   * "the other person" is whichever column is not the one being matched — hence
   * the CASE. Intersecting the two sets in SQL avoids pulling both graphs into
   * the process.
   */
  private async mutualFriends(
    viewerId: string,
    sellerId: string,
  ): Promise<Array<{ id: string; displayName: string }>> {
    // `$queryRawUnsafe` with positional parameters, not the tagged template:
    // both ids are referenced several times, and repeating them as template
    // interpolations would bind the same value as six separate parameters.
    // The values are still bound, never concatenated.
    return this.prisma.$queryRawUnsafe<Array<{ id: string; displayName: string }>>(
      `
      WITH friends_of AS (
        SELECT
          CASE WHEN f."userAId" = $1::uuid THEN f."userBId" ELSE f."userAId" END AS friend_id,
          $1::uuid AS owner_id
        FROM "Friendship" f
        WHERE f."status" = 'accepted'
          AND ($1::uuid IN (f."userAId", f."userBId"))
        UNION ALL
        SELECT
          CASE WHEN f."userAId" = $2::uuid THEN f."userBId" ELSE f."userAId" END AS friend_id,
          $2::uuid AS owner_id
        FROM "Friendship" f
        WHERE f."status" = 'accepted'
          AND ($2::uuid IN (f."userAId", f."userBId"))
      )
      SELECT u."id", u."displayName"
      FROM friends_of
      JOIN "User" u ON u."id" = friends_of.friend_id
      WHERE friends_of.friend_id NOT IN ($1::uuid, $2::uuid)
      GROUP BY u."id", u."displayName"
      HAVING COUNT(DISTINCT friends_of.owner_id) = 2
      ORDER BY u."displayName"
      LIMIT 10
      `,
      viewerId,
      sellerId,
    );
  }
}

/**
 * "amigo de Nacho" · "amigo de Nacho y Sofi" · "amigo de Nacho y 3 más".
 *
 * Names carry the weight, so at most two are shown before it collapses to a
 * count — a list of five names stops being a reference and becomes noise.
 */
function buildLabel(mutuals: Array<{ displayName: string }>): string {
  const [first, second] = mutuals;
  if (!first) return '';

  if (mutuals.length === 1) return `Amigo de ${first.displayName}`;
  if (mutuals.length === 2 && second) {
    return `Amigo de ${first.displayName} y ${second.displayName}`;
  }
  return `Amigo de ${first.displayName} y ${mutuals.length - 1} más`;
}
