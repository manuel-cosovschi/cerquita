import { Body, Controller, Post } from '@nestjs/common';
import type { ListingSummary, Paginated } from '@cerquita/types';
import { aiSearchSchema, searchQuerySchema, type SearchQueryInput } from '@cerquita/validation';
import { SearchService } from './search.service';
import { zodBody } from '../../common/zod-validation.pipe';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import { OptionalAuth } from '../auth/jwt-auth.guard';

/**
 * Search uses POST rather than GET because the filter set is a nested object
 * (bbox, arrays of categories and conditions) that does not survive a query
 * string cleanly.
 */
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @OptionalAuth()
  @Post()
  query(
    @Body(zodBody(searchQuerySchema)) body: SearchQueryInput,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ): Promise<Paginated<ListingSummary>> {
    return this.search.search(body, user?.userId);
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
