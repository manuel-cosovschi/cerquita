import { Controller, Get, Query } from '@nestjs/common';
import { mapQuerySchema, type MapQueryInput } from '@cerquita/validation';
import { MapService, type MapResponse } from './map.service';
import { zodBody } from '../../common/zod-validation.pipe';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import { OptionalAuth } from '../auth/jwt-auth.guard';

@Controller('map')
export class MapController {
  constructor(private readonly map: MapService) {}

  /**
   * `GET /api/map/listings?bbox=…&zoom=…&layer=…`
   *
   * One request per viewport, never one per marker (spec §129). The server picks
   * clusters or individual markers from the zoom level.
   */
  @OptionalAuth()
  @Get('listings')
  query(
    @Query(zodBody(mapQuerySchema)) query: MapQueryInput,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Query('viewerLat') viewerLat?: string,
    @Query('viewerLng') viewerLng?: string,
  ): Promise<MapResponse> {
    const lat = Number(viewerLat);
    const lng = Number(viewerLng);
    const viewerLocation =
      Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : undefined;

    return this.map.query(query, { viewerId: user?.userId, viewerLocation });
  }
}
