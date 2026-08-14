import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { CommentsService } from './comments.service';
import { zodBody } from '../../common/zod-validation.pipe';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import { OptionalAuth } from '../auth/jwt-auth.guard';

const createCommentSchema = z.object({
  body: z.string().trim().min(1).max(1000),
  parentId: z.string().uuid().optional(),
});

@Controller()
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  /** Public: comments are references, so a logged-out visitor should read them. */
  @OptionalAuth()
  @Get('listings/:id/comments')
  list(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    return this.comments.list(id, user?.userId);
  }

  @Post('listings/:id/comments')
  create(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(createCommentSchema)) body: { body: string; parentId?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.comments.create({ listingId: id, authorId: user.userId, ...body });
  }

  @Delete('comments/:commentId')
  hide(
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.comments.hide(commentId, user.userId);
  }
}
