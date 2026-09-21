import { Module } from '@nestjs/common';
import { OffersService } from './offers.service';
import { OffersController } from './offers.controller';
import { ListingsModule } from '../listings/listings.module';
import { UserSerializer } from '../users/user.serializer';

@Module({
  imports: [ListingsModule],
  controllers: [OffersController],
  providers: [OffersService, UserSerializer],
  exports: [OffersService],
})
export class OffersModule {}
