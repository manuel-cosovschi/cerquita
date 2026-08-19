import { Module } from '@nestjs/common';
import { SearchService } from './search.service';
import { EntitySearchService } from './entity-search.service';
import { UserSerializer } from '../users/user.serializer';
import { SocialModule } from '../social/social.module';
import { SearchController } from './search.controller';
import { ListingsModule } from '../listings/listings.module';

@Module({
  imports: [SocialModule, ListingsModule],
  controllers: [SearchController],
  providers: [SearchService, EntitySearchService, UserSerializer],
  exports: [SearchService, EntitySearchService],
})
export class SearchModule {}
