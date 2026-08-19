import { Controller, Get, Query } from '@nestjs/common';
import type { FeedItem } from '@cerquita/types';
import { FeedService } from './feed.service';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import { OptionalAuth } from '../auth/jwt-auth.guard';

@Controller('feed')
export class FeedController {
  constructor(private readonly feed: FeedService) {}

  /**
   * Open to anonymous visitors on purpose: without a session the feed is simply
   * what is near you, which is a reasonable first screen and does not require
   * an account to be useful.
   */
  @OptionalAuth()
  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Query('lat') lat?: string,
    @Query('lng') lng?: string,
    @Query('limit') limit?: string,
  ): Promise<FeedItem[]> {
    return this.feed.forViewer(user?.userId, {
      lat: numeric(lat),
      lng: numeric(lng),
      limit: numeric(limit),
    });
  }
}

/** Query strings arrive as text; anything unparseable is treated as absent. */
function numeric(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
