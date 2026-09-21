import { Body, Controller, Post } from '@nestjs/common';
import type { ListingSummary, Paginated } from '@cerquita/types';
import { aiSearchSchema, searchQuerySchema, type SearchQueryInput } from '@cerquita/validation';
import { SearchService } from './search.service';
import { EntitySearchService } from './entity-search.service';
import { zodBody } from '../../common/zod-validation.pipe';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import { OptionalAuth } from '../auth/jwt-auth.guard';
import { z } from 'zod';

const entityQuerySchema = z.object({ q: z.string().min(1).max(200) });

/**
 * Search uses POST rather than GET because the filter set is a nested object
 * (bbox, arrays of categories and conditions) that does not survive a query
 * string cleanly.
 */
@Controller('search')
export class SearchController {
  constructor(
    private readonly search: SearchService,
    private readonly entities: EntitySearchService,
  ) {}

  @OptionalAuth()
  @Post()
  query(
    @Body(zodBody(searchQuerySchema)) body: SearchQueryInput,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ): Promise<Paginated<ListingSummary>> {
    return this.search.search(body, user?.userId);
  }

  /**
   * The People / Stores tabs (spec §18, direction 1c). Kept as separate
   * endpoints rather than one union so each tab paginates independently.
   */
  @OptionalAuth()
  @Post('people')
  people(
    @Body(zodBody(entityQuerySchema)) body: { q: string },
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    return this.entities.searchPeople(body.q, user?.userId);
  }

  @OptionalAuth()
  @Post('stores')
  stores(
    @Body(zodBody(entityQuerySchema)) body: { q: string },
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    return this.entities.searchStores(body.q, user?.userId);
  }

  /** "2 personas que seguís tienen una PS5 publicada". */
  @OptionalAuth()
  @Post('social-hint')
  socialHint(
    @Body(zodBody(entityQuerySchema)) body: { q: string },
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    return this.entities.socialHint(body.q, user?.userId);
  }

  @OptionalAuth()
  @Post('ai')
  ai(
    @Body(zodBody(aiSearchSchema))
    body: { prompt: string; center?: { lat: number; lng: number } },
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    return this.search.aiSearch(body.prompt, user?.userId, body.center);
  }
}
