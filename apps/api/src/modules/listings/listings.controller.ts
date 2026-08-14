import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import type { Listing } from '@cerquita/types';
import {
  createListingSchema,
  listingStatusActionSchema,
  updateListingSchema,
  type CreateListingInput,
} from '@cerquita/validation';
import { ListingsService } from './listings.service';
import { zodBody } from '../../common/zod-validation.pipe';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import { OptionalAuth } from '../auth/jwt-auth.guard';

@Controller('listings')
export class ListingsController {
  constructor(private readonly listings: ListingsService) {}

  @Post()
  create(
    @Body(zodBody(createListingSchema)) body: CreateListingInput,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Listing> {
    return this.listings.create(body, user);
  }

  /** Anonymous callers get public pricing; signed-in ones get their tier's price. */
  @OptionalAuth()
  @Get(':id')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ): Promise<Listing> {
    const listing = await this.listings.findOne(id, user?.userId);
    void this.listings.incrementViewCount(id);
    return listing;
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateListingSchema)) body: Record<string, unknown>,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Listing> {
    return this.listings.update(id, body, user);
  }

  @Patch(':id/status')
  setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(listingStatusActionSchema)) body: { status: 'active' | 'paused' | 'removed' },
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ status: string }> {
    return this.listings.setStatus(id, body.status, user);
  }
}
