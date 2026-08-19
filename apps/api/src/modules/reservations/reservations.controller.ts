import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { createReservationSchema } from '@cerquita/validation';
import { ReservationsService } from './reservations.service';
import { zodBody } from '../../common/zod-validation.pipe';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';

@Controller('reservations')
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.reservations.listForBuyer(user.userId);
  }

  @Post()
  create(
    @Body(zodBody(createReservationSchema))
    body: { listingId: string; variantId?: string; quantity: number },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reservations.create({ ...body, buyerId: user.userId });
  }

  @Delete(':id')
  release(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.reservations.release(id, user.userId);
  }
}
