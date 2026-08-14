import { Module } from '@nestjs/common';
import { ListingsService } from './listings.service';
import { ListingsController } from './listings.controller';
import { ListingSerializer } from './listing.serializer';

@Module({
  controllers: [ListingsController],
  providers: [ListingsService, ListingSerializer],
  exports: [ListingsService, ListingSerializer],
})
export class ListingsModule {}
