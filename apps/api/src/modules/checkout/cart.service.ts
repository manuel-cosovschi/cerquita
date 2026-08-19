import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Cart } from '@cerquita/types';
import { discountPolicyFor, resolvePrice, toResolvedPriceDto } from '@cerquita/domain';
import { add, money, zero, type Money } from '@cerquita/utils';
import { PrismaService } from '../../prisma/prisma.service';
import { ListingsService } from '../listings/listings.service';

/**
 * Carts, partitioned by seller (spec §40).
 *
 * Adding an item from a different seller opens a separate cart rather than
 * mixing them, because one payment cannot settle to two payees. Clients present
 * these grouped under a single "carrito" view.
 */
@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly listings: ListingsService,
  ) {}

  async add(
    input: { listingId: string; variantId?: string; quantity: number },
    buyerId: string,
  ): Promise<Cart> {
    const listing = await this.prisma.listing.findUnique({
      where: { id: input.listingId },
      select: {
        id: true,
        sellerId: true,
        storeId: true,
        status: true,
        priceCurrency: true,
        quantity: true,
        reserved: true,
        sold: true,
        kind: true,
      },
    });

    if (!listing) {
      throw new NotFoundException({ message: 'Publicación no encontrada', code: 'not_found' });
    }
    if (listing.sellerId === buyerId) {
      throw new BadRequestException({
        message: 'No podés comprar tu propia publicación',
        code: 'own_listing',
      });
    }
    if (listing.status !== 'active') {
      throw new BadRequestException({
        message: 'La publicación no está disponible',
        code: 'unavailable',
      });
    }
    if (listing.kind !== 'sale') {
      throw new BadRequestException({
        message: 'Solo se pueden agregar publicaciones de venta directa',
        code: 'not_purchasable',
      });
    }

    const available = listing.quantity - listing.reserved - listing.sold;
    if (available < input.quantity) {
      throw new BadRequestException({
        message: 'No hay stock suficiente',
        code: 'insufficient_stock',
      });
    }

    // `storeId` and `variantId` are nullable parts of these unique keys, and
    // Postgres treats NULLs as distinct — so `upsert` cannot be used here.
    // Find-then-create keeps one cart per (buyer, seller, store) as intended.
    const cart =
      (await this.prisma.cart.findFirst({
        where: { buyerId, sellerId: listing.sellerId, storeId: listing.storeId },
        select: { id: true },
      })) ??
      (await this.prisma.cart.create({
        data: {
          buyerId,
          sellerId: listing.sellerId,
          storeId: listing.storeId,
          currency: listing.priceCurrency,
        },
        select: { id: true },
      }));

    const existingItem = await this.prisma.cartItem.findFirst({
      where: { cartId: cart.id, listingId: listing.id, variantId: input.variantId ?? null },
      select: { id: true },
    });

    if (existingItem) {
      await this.prisma.cartItem.update({
        where: { id: existingItem.id },
        data: { quantity: { increment: input.quantity } },
      });
    } else {
      await this.prisma.cartItem.create({
        data: {
          cartId: cart.id,
          listingId: listing.id,
          variantId: input.variantId,
          quantity: input.quantity,
        },
      });
    }

    return this.find(cart.id, buyerId);
  }

  async setQuantity(itemId: string, quantity: number, buyerId: string): Promise<void> {
    const item = await this.prisma.cartItem.findUnique({
      where: { id: itemId },
      select: { id: true, cart: { select: { id: true, buyerId: true } } },
    });

    if (!item || item.cart.buyerId !== buyerId) {
      throw new NotFoundException({ message: 'Ítem no encontrado', code: 'not_found' });
    }

    if (quantity === 0) {
      await this.prisma.cartItem.delete({ where: { id: itemId } });
      return;
    }
    await this.prisma.cartItem.update({ where: { id: itemId }, data: { quantity } });
  }

  async listForBuyer(buyerId: string): Promise<Cart[]> {
    const carts = await this.prisma.cart.findMany({
      where: { buyerId, items: { some: {} } },
      select: { id: true },
    });
    return Promise.all(carts.map((cart) => this.find(cart.id, buyerId)));
  }

  /**
   * Builds the cart with server-resolved prices, so the total shown before
   * checkout is computed the same way checkout will compute it.
   */
  async find(cartId: string, buyerId: string): Promise<Cart> {
    const cart = await this.prisma.cart.findUnique({
      where: { id: cartId },
      include: {
        items: {
          include: {
            listing: {
              select: {
                id: true,
                title: true,
                storeId: true,
                priceAmount: true,
                priceCurrency: true,
                followerDiscountBps: true,
                friendDiscountBps: true,
                quantity: true,
                reserved: true,
                sold: true,
                images: { orderBy: { position: 'asc' }, take: 1 },
              },
            },
            variant: { select: { id: true, priceAmount: true, priceCurrency: true } },
          },
        },
        seller: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
            verified: true,
            ratingSum: true,
            reviewCount: true,
            followerDiscountBps: true,
            friendDiscountBps: true,
          },
        },
        store: {
          select: {
            id: true,
            handle: true,
            name: true,
            logoUrl: true,
            verified: true,
            followerDiscountBps: true,
          },
        },
      },
    });

    if (!cart || cart.buyerId !== buyerId) {
      throw new NotFoundException({ message: 'Carrito no encontrado', code: 'not_found' });
    }

    const currency = cart.currency as 'ARS';
    const tier = await this.listings.resolveTier(cart.sellerId, buyerId, cart.storeId);

    // A shop's listing is priced by the shop, not by whoever owns it. Built with
    // the same helper the checkout uses, so the basket and the bill agree.
    const sellerPolicy = discountPolicyFor({
      seller: {
        followerBasisPoints: cart.seller.followerDiscountBps,
        friendBasisPoints: cart.seller.friendDiscountBps,
      },
      store: cart.store ? { followerBasisPoints: cart.store.followerDiscountBps } : null,
    });

    const now = new Date();

    let subtotal: Money = zero(currency);
    let listTotal: Money = zero(currency);

    const items = cart.items.map((item) => {
      const listAmount = item.variant?.priceAmount ?? item.listing.priceAmount ?? 0;
      const listPrice = money(listAmount, currency);

      const resolution = resolvePrice({
        listPrice,
        tier,
        sellerPolicy,
        listingOverride: {
          followerBasisPoints: item.listing.followerDiscountBps,
          friendBasisPoints: item.listing.friendDiscountBps,
        },
        isStoreListing: item.listing.storeId !== null,
        now,
      });

      const lineTotal = money(resolution.effective.amount * item.quantity, currency);
      subtotal = add(subtotal, lineTotal);
      listTotal = add(listTotal, money(listPrice.amount * item.quantity, currency));

      const image = item.listing.images[0];

      return {
        id: item.id,
        listingId: item.listing.id,
        variantId: item.variantId ?? undefined,
        title: item.listing.title,
        image: image
          ? {
              id: image.id,
              url: image.url,
              thumbnailUrl: image.thumbnailUrl,
              width: image.width,
              height: image.height,
              position: image.position,
              alt: image.alt ?? undefined,
            }
          : undefined,
        quantity: item.quantity,
        unitPrice: toResolvedPriceDto(resolution),
        lineTotal: { amount: lineTotal.amount, currency },
        availableQuantity: item.listing.quantity - item.listing.reserved - item.listing.sold,
      };
    });

    return {
      id: cart.id,
      sellerId: cart.sellerId,
      seller: {
        id: cart.seller.id,
        username: cart.seller.username,
        displayName: cart.seller.displayName,
        avatarUrl: cart.seller.avatarUrl ?? undefined,
        verified: cart.seller.verified,
        rating:
          cart.seller.reviewCount > 0 ? cart.seller.ratingSum / cart.seller.reviewCount : undefined,
        reviewCount: cart.seller.reviewCount,
      },
      store: cart.store
        ? {
            id: cart.store.id,
            handle: cart.store.handle,
            name: cart.store.name,
            logoUrl: cart.store.logoUrl ?? undefined,
            verified: cart.store.verified,
            followerCount: 0,
            activeListingCount: 0,
          }
        : undefined,
      items,
      subtotal: { amount: subtotal.amount, currency },
      discountTotal: { amount: listTotal.amount - subtotal.amount, currency },
      total: { amount: subtotal.amount, currency },
      currency,
    };
  }
}
