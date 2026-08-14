import { Module } from '@nestjs/common';
import { AuctionsService } from './auctions.service';
import { AuctionsController } from './auctions.controller';
import { AuctionsGateway } from './auctions.gateway';
import { AuctionScheduler } from './auction.scheduler';

@Module({
  controllers: [AuctionsController],
  providers: [AuctionsService, AuctionsGateway, AuctionScheduler],
  exports: [AuctionsService, AuctionsGateway],
})
export class AuctionsModule {}
