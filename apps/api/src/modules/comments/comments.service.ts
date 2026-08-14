import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UserSerializer, USER_SUMMARY_SELECT } from '../users/user.serializer';
import { NotificationsService } from '../notifications/notifications.service';
import { SocialProofService } from '../social/social-proof.service';

/**
 * Listing comments — direction 1c's trust mechanism.
 *
 * These are public references, not chat: "Nacho: doy fe, la vi funcionando la
 * semana pasada" is worth more to a stranger than any badge. That is why each
 * comment carries the author's social proof relative to the VIEWER, so a
 * vouch from someone you actually know reads differently from one from a
 * stranger.
 *
 * Moderation is soft-delete (`hiddenAt`): the board flags that 1c "exige
 * moderación de comentarios desde el día uno", and hard deletes destroy the
 * evidence a dispute might need.
 */
@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserSerializer,
    private readonly notifications: NotificationsService,
    private readonly socialProof: SocialProofService,
  ) {}

  async list(listingId: string, viewerId?: string) {
    const comments = await this.prisma.listingComment.findMany({
      where: { listingId, hiddenAt: null, parentId: null },
      orderBy: { createdAt: 'asc' },
      take: 50,
      include: {
        author: { select: USER_SUMMARY_SELECT },
        replies: {
          where: { hiddenAt: null },
          orderBy: { createdAt: 'asc' },
          take: 10,
          include: { author: { select: USER_SUMMARY_SELECT } },
        },
      },
    });

    // Social proof is resolved per distinct author, not per comment — a thread
    // with ten comments from three people should cost three graph lookups.
    const authorIds = new Set<string>();
    for (const comment of comments) {
      authorIds.add(comment.authorId);
      for (const reply of comment.replies) authorIds.add(reply.authorId);
    }

    const proofs = new Map<string, string | null>();
    for (const authorId of authorIds) {
      proofs.set(authorId, (await this.socialProof.forSeller(authorId, viewerId)).label);
    }

    return comments.map((comment) => ({
      id: comment.id,
      body: comment.body,
      author: this.users.toSummary(comment.author),
      socialProof: proofs.get(comment.authorId) ?? null,
      createdAt: comment.createdAt.toISOString(),
      replies: comment.replies.map((reply) => ({
        id: reply.id,
        body: reply.body,
        author: this.users.toSummary(reply.author),
        socialProof: proofs.get(reply.authorId) ?? null,
        createdAt: reply.createdAt.toISOString(),
      })),
    }));
  }

  async create(input: { listingId: string; authorId: string; body: string; parentId?: string }) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: input.listingId },
      select: { id: true, sellerId: true, title: true, status: true },
    });

    if (!listing) {
      throw new NotFoundException({ message: 'Publicación no encontrada', code: 'not_found' });
    }
    if (listing.status === 'removed') {
      throw new BadRequestException({
        message: 'No se puede comentar una publicación retirada',
        code: 'listing_removed',
      });
    }

    // Blocking cuts commenting the same way it cuts messaging.
    const blocked = await this.prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: listing.sellerId, blockedId: input.authorId },
          { blockerId: input.authorId, blockedId: listing.sellerId },
        ],
      },
      select: { blockerId: true },
    });
    if (blocked) {
      throw new ForbiddenException({ message: 'No podés comentar acá', code: 'blocked' });
    }

    const comment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.listingComment.create({
        data: {
          listingId: listing.id,
          authorId: input.authorId,
          body: input.body,
          parentId: input.parentId,
        },
        include: { author: { select: USER_SUMMARY_SELECT } },
      });

      // Counter moves with the row, so the badge can never drift.
      await tx.listing.update({
        where: { id: listing.id },
        data: { commentCount: { increment: 1 } },
      });

      return created;
    });

    if (listing.sellerId !== input.authorId) {
      await this.notifications.create({
        userId: listing.sellerId,
        type: 'message',
        title: `${comment.author.displayName} comentó en ${listing.title}`,
        body: input.body.slice(0, 140),
        deepLink: `cerquita://listing/${listing.id}`,
      });
    }

    return {
      id: comment.id,
      body: comment.body,
      author: this.users.toSummary(comment.author),
      socialProof: null,
      createdAt: comment.createdAt.toISOString(),
      replies: [],
    };
  }

  /** Soft delete. Authors may remove their own; the seller may hide any. */
  async hide(commentId: string, actorId: string): Promise<{ ok: true }> {
    const comment = await this.prisma.listingComment.findUnique({
      where: { id: commentId },
      select: { id: true, authorId: true, listing: { select: { sellerId: true } } },
    });

    if (!comment) {
      throw new NotFoundException({ message: 'Comentario no encontrado', code: 'not_found' });
    }
    if (comment.authorId !== actorId && comment.listing.sellerId !== actorId) {
      throw new ForbiddenException({ message: 'No podés eliminar este comentario', code: 'forbidden' });
    }

    await this.prisma.listingComment.update({
      where: { id: commentId },
      data: { hiddenAt: new Date() },
    });
    return { ok: true };
  }
}
