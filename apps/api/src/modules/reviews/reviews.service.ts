import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Review } from '@cerquita/types';
import { canReviewOrder, isSettled } from '@cerquita/domain';
import { PrismaService } from '../../prisma/prisma.service';
import { UserSerializer, USER_SUMMARY_SELECT } from '../users/user.serializer';

/**
 * Reviews (spec §45, §46).
 *
 * A review requires a settled order the author took part in, so ratings cannot
 * be manufactured without a real transaction behind them. The uniqueness
 * constraint `(orderId, authorId)` in the database backs this up.
 *
 * Reputation is stored as `ratingSum` + `reviewCount` and updated in the same
 * transaction as the review, so the average can never disagree with the reviews.
 */
@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserSerializer,
  ) {}

  async create(input: {
    authorId: string;
    orderId: string;
    rating: number;
    body?: string;
  }): Promise<Review> {
    const order = await this.prisma.order.findUnique({
      where: { id: input.orderId },
      select: { id: true, buyerId: true, sellerId: true, status: true },
    });

    if (!order) {
      throw new NotFoundException({ message: 'Orden no encontrada', code: 'not_found' });
    }

    const alreadyReviewed = await this.prisma.review.findFirst({
      where: { orderId: order.id, authorId: input.authorId },
      select: { id: true },
    });

    const allowed = canReviewOrder({
      actorId: input.authorId,
      buyerId: order.buyerId,
      sellerId: order.sellerId,
      orderIsSettled: isSettled(order.status),
      alreadyReviewed: alreadyReviewed !== null,
    });

    if (!allowed) {
      throw new ForbiddenException({
        message: alreadyReviewed
          ? 'Ya calificaste esta operación'
          : !isSettled(order.status)
            ? 'Podés calificar cuando la operación esté completada'
            : 'No participaste de esta operación',
        code: 'cannot_review',
      });
    }

    // The counterparty is whoever the author is not.
    const subjectId = input.authorId === order.buyerId ? order.sellerId : order.buyerId;

    const review = await this.prisma.$transaction(async (tx) => {
      const created = await tx.review.create({
        data: {
          orderId: order.id,
          authorId: input.authorId,
          subjectId,
          rating: input.rating,
          body: input.body,
        },
        include: { author: { select: USER_SUMMARY_SELECT } },
      });

      // Reputation moves with the review, inside the same transaction.
      await tx.user.update({
        where: { id: subjectId },
        data: { ratingSum: { increment: input.rating }, reviewCount: { increment: 1 } },
      });

      return created;
    });

    return this.toReview(review);
  }

  async listForUser(userId: string, cursor?: string, limit = 20) {
    const rows = await this.prisma.review.findMany({
      where: { subjectId: userId },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { author: { select: USER_SUMMARY_SELECT } },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return {
      items: page.map((row) => this.toReview(row)),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  /** Orders the user can still review — drives the "calificá tu compra" prompt. */
  async pendingForUser(userId: string): Promise<Array<{ orderId: string; reference: string }>> {
    const orders = await this.prisma.order.findMany({
      where: {
        status: { in: ['completed', 'delivered'] },
        OR: [{ buyerId: userId }, { sellerId: userId }],
        reviews: { none: { authorId: userId } },
      },
      orderBy: { completedAt: 'desc' },
      take: 20,
      select: { id: true, reference: true },
    });

    return orders.map((order) => ({ orderId: order.id, reference: order.reference }));
  }

  private toReview(row: {
    id: string;
    orderId: string;
    rating: number;
    body: string | null;
    subjectId: string;
    createdAt: Date;
    author: Parameters<UserSerializer['toSummary']>[0];
  }): Review {
    return {
      id: row.id,
      orderId: row.orderId,
      rating: row.rating,
      body: row.body ?? undefined,
      author: this.users.toSummary(row.author),
      subjectId: row.subjectId,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
