import { Body, Controller, Delete, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { createOfferSchema, respondToOfferSchema } from '@cerquita/validation';
import { money } from '@cerquita/utils';
import { OffersService } from './offers.service';
import { zodBody } from '../../common/zod-validation.pipe';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';

type RespondBody =
  | { action: 'accept' }
  | { action: 'reject'; reason?: string }
  | {
      action: 'counter';
      amount: { amount: number; currency: 'ARS' };
      message?: string;
      expiresInMinutes?: number;
    };

@Controller('offers')
export class OffersController {
  constructor(private readonly offers: OffersService) {}

  @Post()
  create(
    @Body(zodBody(createOfferSchema))
    body: {
      listingId: string;
      amount: { amount: number; currency: 'ARS' };
      message?: string;
      expiresInMinutes?: number;
    },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.offers.create(
      {
        listingId: body.listingId,
        amount: money(body.amount.amount, body.amount.currency),
        message: body.message,
        expiresInMinutes: body.expiresInMinutes,
      },
      user.userId,
    );
  }

  @Post(':id/respond')
  respond(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(respondToOfferSchema)) body: RespondBody,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (body.action === 'counter') {
      return this.offers.respond(id, user.userId, {
        action: 'counter',
        amount: money(body.amount.amount, body.amount.currency),
        message: body.message,
        expiresInMinutes: body.expiresInMinutes,
      });
    }
    return this.offers.respond(id, user.userId, body);
  }

  @Delete(':id')
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.offers.cancel(id, user.userId);
  }
}
