import { Module } from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { ReviewsController } from './reviews.controller';
import { UserSerializer } from '../users/user.serializer';

@Module({
  controllers: [ReviewsController],
  providers: [ReviewsService, UserSerializer],
  exports: [ReviewsService],
})
export class ReviewsModule {}
