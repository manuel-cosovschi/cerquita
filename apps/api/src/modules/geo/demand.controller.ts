import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { DemandService, type LocalDemand } from './demand.service';
import { Public } from '../auth/jwt-auth.guard';

/**
 * What people around here are asking for (spec §51).
 *
 * Public: it is aggregate, and it is most useful to somebody deciding whether
 * to list something — which is exactly the moment they may not have an account
 * yet.
 */
@Controller('demand')
export class DemandController {
  constructor(private readonly demand: DemandService) {}

  @Public()
  @Get()
  near(
    @Query('lat') lat: string,
    @Query('lng') lng: string,
    @Query('radius') radius?: string,
  ): Promise<LocalDemand> {
    const center = { lat: Number(lat), lng: Number(lng) };

    // Demand is meaningless without a place to ask about, so this is required
    // rather than defaulted to somewhere arbitrary.
    if (!Number.isFinite(center.lat) || !Number.isFinite(center.lng)) {
      throw new BadRequestException({
        message: 'Necesitamos una ubicación para mostrar la demanda',
        code: 'location_required',
      });
    }

    const parsedRadius = radius === undefined ? undefined : Number(radius);
    return this.demand.near(center, Number.isFinite(parsedRadius) ? parsedRadius : undefined);
  }
}
