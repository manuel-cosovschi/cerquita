import { Module } from '@nestjs/common';
import { MapService } from './map.service';
import { MapController } from './map.controller';
import { DemandService } from './demand.service';
import { DemandController } from './demand.controller';

@Module({
  controllers: [MapController, DemandController],
  providers: [MapService, DemandService],
  exports: [MapService, DemandService],
})
export class GeoModule {}
