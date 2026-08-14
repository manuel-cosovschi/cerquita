import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import type { Store } from '@cerquita/types';
import {
  addStoreMemberSchema,
  createProductSchema,
  createStoreSchema,
  updateStoreSchema,
} from '@cerquita/validation';
import { StoresService } from './stores.service';
import { ProductsService, type CreateProductInput } from './products.service';
import { zodBody } from '../../common/zod-validation.pipe';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import { OptionalAuth } from '../auth/jwt-auth.guard';

const openingHoursSchema = z.object({
  hours: z
    .array(
      z.object({
        weekday: z.number().int().min(0).max(6),
        opensAt: z.number().int().min(0).max(1440),
        closesAt: z.number().int().min(0).max(1440),
      }),
    )
    .max(21)
    .refine((entries) => entries.every((entry) => entry.closesAt > entry.opensAt), {
      message: 'El horario de cierre debe ser posterior al de apertura',
    }),
});

const setStockSchema = z.object({ quantity: z.number().int().min(0).max(1_000_000) });

const publishSchema = z.object({
  variantId: z.string().uuid().optional(),
  location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
});

@Controller('stores')
export class StoresController {
  constructor(
    private readonly stores: StoresService,
    private readonly products: ProductsService,
  ) {}

  @Post()
  create(
    @Body(zodBody(createStoreSchema)) body: Parameters<StoresService['create']>[0],
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Store> {
    return this.stores.create(body, user);
  }

  /** Public storefront. Signed-in viewers also get their role and follow state. */
  @OptionalAuth()
  @Get(':handle')
  findOne(
    @Param('handle') handle: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ): Promise<Store> {
    return this.stores.findByHandle(handle, user?.userId);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateStoreSchema)) body: Record<string, unknown>,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Store> {
    return this.stores.update(id, body, user);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.stores.remove(id, user);
  }

  @Get(':id/members')
  members(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.stores.listMembers(id, user);
  }

  @Post(':id/members')
  addMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(addStoreMemberSchema))
    body: { userId: string; role: 'admin' | 'manager' | 'seller' | 'support' },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.stores.addMember(id, body, user);
  }

  @Delete(':id/members/:userId')
  removeMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.stores.removeMember(id, userId, user);
  }

  @Post(':id/hours')
  setHours(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(openingHoursSchema))
    body: { hours: Array<{ weekday: number; opensAt: number; closesAt: number }> },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.stores.setOpeningHours(id, body.hours, user);
  }

  /** Seller dashboard (spec §50). Requires `manager` or above. */
  @Get(':id/dashboard')
  dashboard(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.stores.dashboard(id, user);
  }

  @Get(':id/products')
  listProducts(@Param('id', ParseUUIDPipe) id: string) {
    return this.products.listForStore(id);
  }
}

@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Post()
  create(
    @Body(zodBody(createProductSchema)) body: CreateProductInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.products.create(body, user);
  }

  @OptionalAuth()
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.products.findOne(id);
  }

  @Patch('variants/:variantId/stock')
  setStock(
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body(zodBody(setStockSchema)) body: { quantity: number },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.products.setStock(variantId, body.quantity, user);
  }

  /** Puts a catalogue product on the map as a listing (spec §49). */
  @Post(':id/publish')
  publish(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(publishSchema))
    body: { variantId?: string; location: { lat: number; lng: number } },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.products.publishAsListing(id, body, user);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.products.remove(id, user);
  }
}
