import { Module } from '@nestjs/common';
import { SocialService } from './social.service';
import { SocialController } from './social.controller';
import { SocialProofService } from './social-proof.service';
import { UserSerializer } from '../users/user.serializer';

/**
 * The social graph, and the one thing every other module wants from it.
 *
 * `SocialProofService` is exported rather than re-provided per consumer: four
 * modules were each constructing their own instance, which works only because
 * it happens to be stateless. Owning it here keeps that from becoming a rule
 * somebody later relies on.
 */
@Module({
  controllers: [SocialController],
  providers: [SocialService, SocialProofService, UserSerializer],
  exports: [SocialService, SocialProofService],
})
export class SocialModule {}
