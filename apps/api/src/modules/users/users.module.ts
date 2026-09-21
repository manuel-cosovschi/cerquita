import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { UserSerializer } from './user.serializer';
import { ListingsModule } from '../listings/listings.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { SocialModule } from '../social/social.module';

@Module({
  imports: [ListingsModule, ReviewsModule, SocialModule],
  controllers: [UsersController],
  providers: [UsersService, UserSerializer],
  exports: [UsersService, UserSerializer],
})
export class UsersModule {}
