import { Module } from '@nestjs/common';
import { SearchService } from './search.service';
import { EntitySearchService } from './entity-search.service';
import { UserSerializer } from '../users/user.serializer';
import { SocialProofService } from '../social/social-proof.service';
import { SearchController } from './search.controller';
import { ListingsModule } from '../listings/listings.module';

@Module({
  imports: [ListingsModule],
  controllers: [SearchController],
  providers: [SearchService, EntitySearchService, UserSerializer, SocialProofService],
  exports: [SearchService, EntitySearchService],
})
export class SearchModule {}
