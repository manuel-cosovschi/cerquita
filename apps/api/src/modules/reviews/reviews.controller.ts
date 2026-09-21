import { Body, Controller, Get, Post } from '@nestjs/common';
import type { Review } from '@cerquita/types';
import { createReviewSchema } from '@cerquita/validation';
import { ReviewsService } from './reviews.service';
import { zodBody } from '../../common/zod-validation.pipe';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';

@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Post()
  create(
    @Body(zodBody(createReviewSchema)) body: { orderId: string; rating: number; body?: string },
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Review> {
    return this.reviews.create({ authorId: user.userId, ...body });
  }

  /** Settled orders the caller has not reviewed yet. */
  @Get('pending')
  pending(@CurrentUser() user: AuthenticatedUser) {
    return this.reviews.pendingForUser(user.userId);
  }
}
