import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import type { ListingSummary, UserProfile } from '@cerquita/types';
import {
  privacyPreferencesSchema,
  updateDiscountPolicySchema,
  updateProfileSchema,
} from '@cerquita/validation';
import { UsersService, type UserSettings } from './users.service';
import { ReviewsService } from '../reviews/reviews.service';
import { zodBody } from '../../common/zod-validation.pipe';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import { OptionalAuth } from '../auth/jwt-auth.guard';

@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly reviews: ReviewsService,
  ) {}

  /**
   * The viewer's own settings.
   *
   * Declared before `:username` on purpose: Nest matches routes in declaration
   * order, and a wildcard segment above this one would swallow `me`.
   */
  @Get('me/settings')
  settings(@CurrentUser() user: AuthenticatedUser): Promise<UserSettings> {
    return this.users.settings(user.userId);
  }

  /** Public profile. Signed-in viewers additionally get their relationship. */
  @OptionalAuth()
  @Get(':username')
  profile(
    @Param('username') username: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ): Promise<UserProfile> {
    return this.users.profileByUsername(username, user?.userId);
  }

  @OptionalAuth()
  @Get(':username/listings')
  listings(
    @Param('username') username: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Query('tab') tab: 'selling' | 'wanted' | 'auctions' | 'sold' = 'selling',
  ): Promise<ListingSummary[]> {
    return this.users.listingsForProfile(username, tab, user?.userId);
  }

  @OptionalAuth()
  @Get(':username/reviews')
  async reviewsFor(@Param('username') username: string, @Query('cursor') cursor?: string) {
    const profile = await this.users.profileByUsername(username);
    return this.reviews.listForUser(profile.id, cursor);
  }

  @Patch('me/profile')
  updateProfile(
    @Body(zodBody(updateProfileSchema)) body: Record<string, string | undefined>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.users.updateProfile(user.userId, body);
  }

  @Patch('me/discounts')
  updateDiscounts(
    @Body(zodBody(updateDiscountPolicySchema))
    body: { followerBasisPoints: number; friendBasisPoints: number },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.users.updateDiscountPolicy(user.userId, body);
  }

  @Patch('me/privacy')
  updatePrivacy(
    @Body(zodBody(privacyPreferencesSchema))
    body: {
      showSoldListings: boolean;
      showFavorites: boolean;
      showActivity: boolean;
      showPurchases: boolean;
    },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.users.updatePrivacy(user.userId, body);
  }
}
