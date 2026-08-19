import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { SocialService, type FriendRequest } from './social.service';
import { zodBody } from '../../common/zod-validation.pipe';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';

const respondSchema = z.object({ decision: z.enum(['accepted', 'rejected']) });

@Controller()
export class SocialController {
  constructor(private readonly social: SocialService) {}

  @Post('users/:id/follow')
  follow(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.social.follow(user.userId, id);
  }

  @Delete('users/:id/follow')
  unfollow(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.social.unfollow(user.userId, id);
  }

  @Post('users/:id/friend-request')
  requestFriendship(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.social.requestFriendship(user.userId, id);
  }

  /**
   * Requests waiting on the viewer. Declared before `:id` routes so the literal
   * segment is not swallowed by a parameter.
   */
  @Get('friendships/pending')
  pendingFriendRequests(@CurrentUser() user: AuthenticatedUser): Promise<FriendRequest[]> {
    return this.social.pendingFriendRequests(user.userId);
  }

  @Post('friendships/:id/respond')
  respond(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(respondSchema)) body: { decision: 'accepted' | 'rejected' },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.social.respondToFriendship(id, user.userId, body.decision);
  }

  @Delete('friendships/:id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.social.removeFriendship(id, user.userId);
  }

  @Post('users/:id/block')
  block(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.social.block(user.userId, id);
  }

  @Delete('users/:id/block')
  unblock(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.social.unblock(user.userId, id);
  }

  @Post('stores/:id/follow')
  followStore(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.social.followStore(user.userId, id);
  }

  @Delete('stores/:id/follow')
  unfollowStore(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.social.unfollowStore(user.userId, id);
  }
}
