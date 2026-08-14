import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { FriendshipStatus } from '@cerquita/types';
import { canRespondToRequest, friendshipKey, isParticipant } from '@cerquita/domain';
import { PrismaService } from '../../prisma/prisma.service';
import { EventBus } from '../events/event-bus.service';

/**
 * Follows and friendships (spec §8).
 *
 * Friendship rows are stored under a canonical `(userA < userB)` ordering, so
 * (A,B) and (B,A) cannot both exist. `requesterId` records who asked, which is
 * what the accept/reject rules key off.
 */
@Injectable()
export class SocialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
  ) {}

  async follow(followerId: string, followeeId: string): Promise<{ following: true }> {
    if (followerId === followeeId) {
      throw new BadRequestException({ message: 'No podés seguirte a vos mismo', code: 'self_follow' });
    }

    await this.prisma.follow.upsert({
      where: { followerId_followeeId: { followerId, followeeId } },
      update: {},
      create: { followerId, followeeId },
    });

    await this.events.publish({
      type: 'UserFollowed',
      id: `${followerId}:${followeeId}`,
      occurredAt: new Date().toISOString(),
      followerId,
      followeeId,
    });

    return { following: true };
  }

  async unfollow(followerId: string, followeeId: string): Promise<{ following: false }> {
    await this.prisma.follow
      .delete({ where: { followerId_followeeId: { followerId, followeeId } } })
      .catch(() => undefined);
    return { following: false };
  }

  async requestFriendship(requesterId: string, addresseeId: string): Promise<{ status: FriendshipStatus }> {
    if (requesterId === addresseeId) {
      throw new BadRequestException({
        message: 'No podés enviarte una solicitud',
        code: 'self_friendship',
      });
    }

    const [userAId, userBId] = friendshipKey(requesterId, addresseeId);

    const existing = await this.prisma.friendship.findUnique({
      where: { userAId_userBId: { userAId, userBId } },
    });

    if (existing) {
      if (existing.status === 'accepted') return { status: 'accepted' };
      if (existing.status === 'blocked') {
        throw new BadRequestException({ message: 'No disponible', code: 'blocked' });
      }

      // If the other person had already asked, accepting is the natural result
      // rather than creating a competing request in the opposite direction.
      if (existing.status === 'pending' && existing.requesterId === addresseeId) {
        return this.respondToFriendship(existing.id, requesterId, 'accepted');
      }

      await this.prisma.friendship.update({
        where: { id: existing.id },
        data: { status: 'pending', requesterId },
      });
      return { status: 'pending' };
    }

    await this.prisma.friendship.create({
      data: { userAId, userBId, requesterId, status: 'pending' },
    });
    return { status: 'pending' };
  }

  async respondToFriendship(
    friendshipId: string,
    actorId: string,
    decision: 'accepted' | 'rejected',
  ): Promise<{ status: FriendshipStatus }> {
    const friendship = await this.prisma.friendship.findUnique({ where: { id: friendshipId } });
    if (!friendship) {
      throw new NotFoundException({ message: 'Solicitud no encontrada', code: 'not_found' });
    }

    const state = {
      requesterId: friendship.requesterId,
      addresseeId:
        friendship.requesterId === friendship.userAId ? friendship.userBId : friendship.userAId,
      status: friendship.status,
    };

    if (!canRespondToRequest(state, actorId)) {
      throw new BadRequestException({
        message: 'No podés responder esta solicitud',
        code: 'not_addressee',
      });
    }

    await this.prisma.friendship.update({
      where: { id: friendshipId },
      data: { status: decision },
    });

    if (decision === 'accepted') {
      await this.events.publish({
        type: 'FriendshipAccepted',
        id: friendshipId,
        occurredAt: new Date().toISOString(),
        requesterId: state.requesterId,
        addresseeId: state.addresseeId,
      });
    }

    return { status: decision };
  }

  async removeFriendship(friendshipId: string, actorId: string): Promise<{ removed: true }> {
    const friendship = await this.prisma.friendship.findUnique({ where: { id: friendshipId } });
    if (!friendship) {
      throw new NotFoundException({ message: 'Amistad no encontrada', code: 'not_found' });
    }

    const state = {
      requesterId: friendship.requesterId,
      addresseeId:
        friendship.requesterId === friendship.userAId ? friendship.userBId : friendship.userAId,
      status: friendship.status,
    };

    if (!isParticipant(state, actorId)) {
      throw new BadRequestException({ message: 'No formás parte de esta amistad', code: 'forbidden' });
    }

    await this.prisma.friendship.delete({ where: { id: friendshipId } });
    return { removed: true };
  }

  /** Blocking hides content in both directions and severs any friendship. */
  async block(blockerId: string, blockedId: string): Promise<{ blocked: true }> {
    const [userAId, userBId] = friendshipKey(blockerId, blockedId);

    await this.prisma.$transaction([
      this.prisma.block.upsert({
        where: { blockerId_blockedId: { blockerId, blockedId } },
        update: {},
        create: { blockerId, blockedId },
      }),
      this.prisma.friendship.updateMany({
        where: { userAId, userBId },
        data: { status: 'blocked' },
      }),
      this.prisma.follow.deleteMany({
        where: {
          OR: [
            { followerId: blockerId, followeeId: blockedId },
            { followerId: blockedId, followeeId: blockerId },
          ],
        },
      }),
    ]);

    return { blocked: true };
  }

  async unblock(blockerId: string, blockedId: string): Promise<{ blocked: false }> {
    await this.prisma.block
      .delete({ where: { blockerId_blockedId: { blockerId, blockedId } } })
      .catch(() => undefined);
    return { blocked: false };
  }

  async followStore(userId: string, storeId: string): Promise<{ following: true }> {
    await this.prisma.storeFollow.upsert({
      where: { storeId_userId: { storeId, userId } },
      update: {},
      create: { storeId, userId },
    });

    await this.events.publish({
      type: 'StoreFollowed',
      id: `${storeId}:${userId}`,
      occurredAt: new Date().toISOString(),
      storeId,
      userId,
    });

    return { following: true };
  }
}
