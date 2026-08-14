import { Module } from '@nestjs/common';
import { CartService } from './cart.service';
import { CheckoutService } from './checkout.service';
import { CheckoutController } from './checkout.controller';
import { ListingsModule } from '../listings/listings.module';

@Module({
  imports: [ListingsModule],
  controllers: [CheckoutController],
  providers: [CartService, CheckoutService],
  exports: [CartService, CheckoutService],
})
export class CheckoutModule {}
