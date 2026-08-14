import { Module } from '@nestjs/common';
import { CommentsService } from './comments.service';
import { CommentsController } from './comments.controller';
import { UserSerializer } from '../users/user.serializer';
import { SocialProofService } from '../social/social-proof.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [CommentsController],
  providers: [CommentsService, UserSerializer, SocialProofService],
  exports: [CommentsService],
})
export class CommentsModule {}
