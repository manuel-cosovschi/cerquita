import { Module } from '@nestjs/common';
import { ListingsService } from './listings.service';
import { ListingsController } from './listings.controller';
import { ListingSerializer } from './listing.serializer';
import { SocialModule } from '../social/social.module';

@Module({
  imports: [SocialModule],
  controllers: [ListingsController],
  providers: [ListingsService, ListingSerializer],
  exports: [ListingsService, ListingSerializer],
})
export class ListingsModule {}
