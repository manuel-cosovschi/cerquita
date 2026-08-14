import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import type { ListingSummary, Paginated } from '@cerquita/types';
import {
  createCollectionSchema,
  createFavoriteSchema,
  createSavedSearchSchema,
} from '@cerquita/validation';
import { FavoritesService } from './favorites.service';
import { zodBody } from '../../common/zod-validation.pipe';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';

@Controller()
export class FavoritesController {
  constructor(private readonly favorites: FavoritesService) {}

  @Get('favorites')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('collectionId') collectionId?: string,
  ): Promise<Paginated<ListingSummary>> {
    return this.favorites.list(user.userId, collectionId);
  }

  @Post('favorites')
  add(
    @Body(zodBody(createFavoriteSchema))
    body: { listingId?: string; storeId?: string; collectionId?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.favorites.add(user.userId, body);
  }

  @Delete('favorites/listing/:listingId')
  removeListing(
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.favorites.remove(user.userId, { listingId });
  }

  @Delete('favorites/store/:storeId')
  removeStore(
    @Param('storeId', ParseUUIDPipe) storeId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.favorites.remove(user.userId, { storeId });
  }

  @Get('collections')
  collections(@CurrentUser() user: AuthenticatedUser) {
    return this.favorites.listCollections(user.userId);
  }

  @Post('collections')
  createCollection(
    @Body(zodBody(createCollectionSchema)) body: { name: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.favorites.createCollection(user.userId, body.name);
  }

  @Get('saved-searches')
  savedSearches(@CurrentUser() user: AuthenticatedUser) {
    return this.favorites.listSavedSearches(user.userId);
  }

  @Post('saved-searches')
  createSavedSearch(
    @Body(zodBody(createSavedSearchSchema)) body: Parameters<FavoritesService['createSavedSearch']>[1],
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.favorites.createSavedSearch(user.userId, body);
  }

  @Delete('saved-searches/:id')
  deleteSavedSearch(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.favorites.deleteSavedSearch(user.userId, id);
  }
}
