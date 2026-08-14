import { Module } from '@nestjs/common';
import { CommentsService } from './comments.service';
import { CommentsController } from './comments.controller';
import { UserSerializer } from '../users/user.serializer';
import { SocialModule } from '../social/social.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [SocialModule, NotificationsModule],
  controllers: [CommentsController],
  providers: [CommentsService, UserSerializer],
  exports: [CommentsService],
})
export class CommentsModule {}
