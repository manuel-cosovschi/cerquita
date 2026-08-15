import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import type { Cart, Order } from '@cerquita/types';
import {
  addToCartSchema,
  checkoutSchema,
  updateCartItemSchema,
  type CheckoutInput,
} from '@cerquita/validation';
import { CartService } from './cart.service';
import { CheckoutService } from './checkout.service';
import { zodBody } from '../../common/zod-validation.pipe';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';

@Controller()
export class CheckoutController {
  constructor(
    private readonly cart: CartService,
    private readonly checkout: CheckoutService,
  ) {}

  @Get('cart')
  list(@CurrentUser() user: AuthenticatedUser): Promise<Cart[]> {
    return this.cart.listForBuyer(user.userId);
  }

  @Post('cart/items')
  add(
    @Body(zodBody(addToCartSchema))
    body: { listingId: string; variantId?: string; quantity: number },
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Cart> {
    return this.cart.add(body, user.userId);
  }

  @Patch('cart/items/:itemId')
  async setQuantity(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body(zodBody(updateCartItemSchema)) body: { quantity: number },
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ ok: true }> {
    await this.cart.setQuantity(itemId, body.quantity, user.userId);
    return { ok: true };
  }

  @Delete('cart/items/:itemId')
  async remove(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ ok: true }> {
    await this.cart.setQuantity(itemId, 0, user.userId);
    return { ok: true };
  }

  @Post('checkout')
  submit(
    @Body(zodBody(checkoutSchema)) body: CheckoutInput,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ order: Order; checkoutUrl?: string }> {
    return this.checkout.checkout(body, user.userId);
  }

  @Get('orders/:id')
  findOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Order> {
    return this.checkout.findOrder(id, user.userId);
  }
}
