import { Module } from '@nestjs/common';
import { AuctionsService } from './auctions.service';
import { AuctionsController } from './auctions.controller';
import { AuctionsGateway } from './auctions.gateway';
import { AuctionScheduler } from './auction.scheduler';
import { OffersModule } from '../offers/offers.module';
import { ReservationsModule } from '../reservations/reservations.module';

@Module({
  imports: [OffersModule, ReservationsModule],
  controllers: [AuctionsController],
  providers: [AuctionsService, AuctionsGateway, AuctionScheduler],
  exports: [AuctionsService, AuctionsGateway],
})
export class AuctionsModule {}
