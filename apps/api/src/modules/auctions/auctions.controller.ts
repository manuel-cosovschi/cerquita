import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { placeBidSchema, type PlaceBidInput } from '@cerquita/validation';
import { money } from '@cerquita/utils';
import { AuctionsService } from './auctions.service';
import { AuctionsGateway } from './auctions.gateway';
import { zodBody } from '../../common/zod-validation.pipe';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';

@Controller('auctions')
export class AuctionsController {
  constructor(
    private readonly auctions: AuctionsService,
    private readonly gateway: AuctionsGateway,
  ) {}

  @Post(':id/bids')
  async bid(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(placeBidSchema)) body: PlaceBidInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.auctions.bid({
      auctionId: id,
      bidderId: user.userId,
      amount: money(body.amount.amount, body.amount.currency),
      expectedMinimum: body.expectedMinimum
        ? money(body.expectedMinimum.amount, body.expectedMinimum.currency)
        : undefined,
    });

    // Everyone watching the auction sees the new standing bid immediately.
    this.gateway.broadcastBid(id, {
      currentPrice: { amount: result.currentPrice.amount, currency: result.currentPrice.currency },
      nextMinimumBid: {
        amount: result.nextMinimumBid.amount,
        currency: result.nextMinimumBid.currency,
      },
      endsAt: result.endsAt.toISOString(),
      highestBidderId: user.userId,
    });

    return result;
  }

  @Post(':id/buy-now')
  buyNow(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.auctions.buyNow({ auctionId: id, buyerId: user.userId });
  }
}
