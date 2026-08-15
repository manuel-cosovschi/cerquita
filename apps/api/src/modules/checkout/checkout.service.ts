import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Order } from '@cerquita/types';
import {
  buildOrderReference,
  computeOrderTotals,
  lockedPriceForOffer,
  priceMatchesQuote,
  resolvePrice,
  type OrderLineInput,
} from '@cerquita/domain';
import type { CheckoutInput } from '@cerquita/validation';
import { money, type Money } from '@cerquita/utils';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '../config/config.service';
import { EventBus } from '../events/event-bus.service';
import { ListingsService } from '../listings/listings.service';
import { PAYMENT_PROVIDER, type PaymentProvider } from '../../providers/payments/payment-provider';

/**
 * Checkout (spec §41, §83, §91).
 *
 * The two rules this service exists to enforce:
 *
 *  1. THE SERVER RECOMPUTES EVERY PRICE. `quotedTotal` from the client is used
 *     only to detect that the price moved and ask for re-confirmation. The
 *     charge is always built from `resolvePrice` + `computeOrderTotals`.
 *
 *  2. STOCK CANNOT GO NEGATIVE. Each line is decremented with a CONDITIONAL
 *     UPDATE (`WHERE quantity - reserved - sold >= n`). Two buyers racing for the
 *     last unit both issue it; the second blocks on the first one's row lock and,
 *     at READ COMMITTED, re-evaluates its WHERE against the updated row — so it
 *     matches zero rows and is rejected. Nothing depends on a read-then-write
 *     gap, and a CHECK constraint makes negative stock unrepresentable anyway.
 */
@Injectable()
export class CheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly events: EventBus,
    private readonly listings: ListingsService,
    @Inject(PAYMENT_PROVIDER) private readonly payments: PaymentProvider,
  ) {}

  async checkout(
    input: CheckoutInput,
    buyerId: string,
  ): Promise<{ order: Order; checkoutUrl?: string }> {
    const platformFeeBasisPoints = await this.config.platformFeeBasisPoints();

    const created = await this.prisma.$transaction(async (tx) => {
      const cart = await tx.cart.findUnique({
        where: { id: input.cartId },
        include: {
          items: {
            include: {
              listing: {
                select: {
                  id: true,
                  title: true,
                  sellerId: true,
                  storeId: true,
                  status: true,
                  priceAmount: true,
                  priceCurrency: true,
                  followerDiscountBps: true,
                  friendDiscountBps: true,
                  quantity: true,
                  reserved: true,
                  sold: true,
                },
              },
              variant: { select: { id: true, priceAmount: true, priceCurrency: true } },
            },
          },
        },
      });

      if (!cart) {
        throw new NotFoundException({ message: 'Carrito no encontrado', code: 'not_found' });
      }
      if (cart.buyerId !== buyerId) {
        throw new ForbiddenException({ message: 'Ese carrito no es tuyo', code: 'forbidden' });
      }
      if (cart.items.length === 0) {
        throw new BadRequestException({ message: 'El carrito está vacío', code: 'empty_cart' });
      }

      const tier = await this.listings.resolveTier(cart.sellerId, buyerId);
      const seller = await tx.user.findUniqueOrThrow({
        where: { id: cart.sellerId },
        select: { followerDiscountBps: true, friendDiscountBps: true },
      });

      // A price locked by an accepted offer supersedes the social price.
      const offerPrice = await this.resolveOfferPrice(tx, input.offerId, buyerId);

      const now = new Date();
      const lines: OrderLineInput[] = [];
      const snapshots: Array<{
        listingId: string;
        variantId?: string;
        title: string;
        unitPrice: Money;
        quantity: number;
      }> = [];

      for (const item of cart.items) {
        const listing = item.listing;

        if (listing.status !== 'active') {
          throw new ConflictException({
            message: `"${listing.title}" ya no está disponible`,
            code: 'listing_unavailable',
            listingId: listing.id,
          });
        }

        const listAmount = item.variant?.priceAmount ?? listing.priceAmount;
        if (listAmount === null || listAmount === undefined) {
          throw new BadRequestException({
            message: `"${listing.title}" no tiene precio`,
            code: 'listing_without_price',
          });
        }

        const currency = (item.variant?.priceCurrency ?? listing.priceCurrency) as 'ARS';
        const listPrice = money(listAmount, currency);

        const resolution = resolvePrice({
          listPrice,
          tier,
          sellerPolicy: {
            followerBasisPoints: seller.followerDiscountBps,
            friendBasisPoints: seller.friendDiscountBps,
          },
          listingOverride: {
            followerBasisPoints: listing.followerDiscountBps,
            friendBasisPoints: listing.friendDiscountBps,
          },
          isStoreListing: listing.storeId !== null,
          now,
        });

        const unitPrice = offerPrice ?? resolution.effective;

        // The conditional decrement. This single statement is what prevents
        // overselling — see the class comment.
        const affected = await tx.$executeRaw`
          UPDATE "Listing"
          SET "reserved" = "reserved" + ${item.quantity}
          WHERE "id" = ${listing.id}::uuid
            AND "quantity" - "reserved" - "sold" >= ${item.quantity}
        `;

        if (affected === 0) {
          throw new ConflictException({
            message: `Se agotó "${listing.title}" mientras completabas la compra`,
            code: 'insufficient_stock',
            listingId: listing.id,
          });
        }

        lines.push({
          listingId: listing.id,
          variantId: item.variantId ?? undefined,
          quantity: item.quantity,
          unitListPrice: listPrice,
          unitEffectivePrice: unitPrice,
        });
        snapshots.push({
          listingId: listing.id,
          variantId: item.variantId ?? undefined,
          title: listing.title,
          unitPrice,
          quantity: item.quantity,
        });
      }

      const totals = computeOrderTotals({
        lines,
        currency: cart.currency as 'ARS',
        platformFeeBasisPoints,
      });

      // The client's number is compared, never used. A mismatch means the price
      // moved between render and submit, which the buyer must see before paying.
      if (input.quotedTotal && !priceMatchesQuote(totals.total, input.quotedTotal)) {
        throw new ConflictException({
          message: 'El precio cambió. Revisá el total actualizado antes de confirmar.',
          code: 'price_changed',
          total: { amount: totals.total.amount, currency: totals.total.currency },
        });
      }

      const order = await tx.order.create({
        data: {
          reference: buildOrderReference(`${cart.id}:${Date.now()}`),
          status: 'pending_payment',
          buyerId,
          sellerId: cart.sellerId,
          storeId: cart.storeId,
          offerId: input.offerId ?? null,
          currency: totals.currency,
          subtotal: totals.subtotal.amount,
          discountTotal: totals.discountTotal.amount,
          shippingTotal: totals.shippingTotal.amount,
          platformFee: totals.platformFee.amount,
          total: totals.total.amount,
          deliveryMethod: input.deliveryMethod,
          meetingLabel: input.meetingPoint?.label ?? null,
          items: {
            create: snapshots.map((snapshot) => ({
              listingId: snapshot.listingId,
              variantId: snapshot.variantId,
              // Snapshots, so the order still renders if the listing is edited.
              titleSnapshot: snapshot.title,
              unitPriceSnapshot: snapshot.unitPrice.amount,
              currency: snapshot.unitPrice.currency,
              quantity: snapshot.quantity,
              lineTotal: snapshot.unitPrice.amount * snapshot.quantity,
            })),
          },
        },
        select: { id: true, reference: true, total: true, currency: true },
      });

      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

      return { order, totals, sellerId: cart.sellerId };
    });

    const intent = await this.payments.createPayment({
      orderId: created.order.id,
      orderReference: created.order.reference,
      amount: { amount: created.totals.total.amount, currency: created.totals.total.currency },
      buyerId,
      sellerId: created.sellerId,
      platformFee: {
        amount: created.totals.platformFee.amount,
        currency: created.totals.platformFee.currency,
      },
      description: `Cerquita ${created.order.reference}`,
    });

    await this.prisma.payment.create({
      data: {
        orderId: created.order.id,
        provider: intent.provider,
        providerRef: intent.providerRef,
        status: intent.status === 'captured' ? 'captured' : 'pending',
        amount: created.totals.total.amount,
        currency: created.totals.total.currency,
      },
    });

    // The mock provider captures immediately, so development exercises the full
    // paid-order path without a webhook round trip.
    if (intent.status === 'captured') {
      await this.markPaid(created.order.id);
    }

    const order = await this.findOrder(created.order.id, buyerId);
    return { order, checkoutUrl: intent.checkoutUrl };
  }

  /** Moves a paid order forward and converts reservations into sales. */
  async markPaid(orderId: string): Promise<void> {
    const result = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { items: true },
      });

      if (order.status !== 'pending_payment') return null;

      await tx.order.update({
        where: { id: orderId },
        data: { status: 'paid', paidAt: new Date() },
      });

      for (const item of order.items) {
        if (!item.listingId) continue;
        // Reserved stock becomes sold stock; availability is unchanged, so this
        // cannot push the listing negative.
        await tx.$executeRaw`
          UPDATE "Listing"
          SET "reserved" = GREATEST(0, "reserved" - ${item.quantity}),
              "sold"     = "sold" + ${item.quantity}
          WHERE "id" = ${item.listingId}::uuid
        `;
        await tx.$executeRaw`
          UPDATE "Listing"
          SET "status" = 'sold'
          WHERE "id" = ${item.listingId}::uuid
            AND "quantity" - "sold" <= 0
        `;
      }

      /*
       * The seller's sales count, which is the number the profile shows next to
       * their reviews.
       *
       * Once per order rather than per item: a cart holds one seller (§40), and
       * "3 ventas" reading as three people who bought from you is the useful
       * meaning — not three objects that left the house in one transaction.
       *
       * In this transaction and behind the `pending_payment` guard above, so a
       * retried webhook cannot inflate it.
       */
      await tx.user.update({
        where: { id: order.sellerId },
        data: { salesCount: { increment: 1 } },
      });

      return order;
    });

    if (!result) return;

    await this.events.publish({
      type: 'OrderPaid',
      id: orderId,
      occurredAt: new Date().toISOString(),
      orderId,
      buyerId: result.buyerId,
      sellerId: result.sellerId,
      total: { amount: result.total, currency: result.currency as 'ARS' },
    });
  }

  /** Releases reserved stock when an unpaid order is abandoned or cancelled. */
  async releaseUnpaidOrder(orderId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { items: true },
      });
      if (order.status !== 'pending_payment') return;

      for (const item of order.items) {
        if (!item.listingId) continue;
        await tx.$executeRaw`
          UPDATE "Listing"
          SET "reserved" = GREATEST(0, "reserved" - ${item.quantity})
          WHERE "id" = ${item.listingId}::uuid
        `;
      }

      await tx.order.update({
        where: { id: orderId },
        data: { status: 'cancelled', cancelledAt: new Date() },
      });
    });
  }

  private async resolveOfferPrice(
    tx: Prisma.TransactionClient,
    offerId: string | undefined,
    buyerId: string,
  ): Promise<Money | undefined> {
    if (!offerId) return undefined;

    const offer = await tx.offer.findUnique({ where: { id: offerId } });
    if (!offer) {
      throw new NotFoundException({ message: 'Oferta no encontrada', code: 'not_found' });
    }

    const locked = lockedPriceForOffer(
      {
        id: offer.id,
        listingId: offer.listingId,
        fromUserId: offer.fromUserId,
        toUserId: offer.toUserId,
        amount: money(offer.amount, offer.currency as 'ARS'),
        status: offer.status,
        expiresAt: offer.expiresAt ?? undefined,
      },
      buyerId,
    );

    if (!locked) {
      throw new BadRequestException({
        message: 'Esa oferta no habilita esta compra',
        code: 'offer_not_usable',
      });
    }
    return locked;
  }

  async findOrder(orderId: string, viewerId: string): Promise<Order> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        buyer: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
            verified: true,
            ratingSum: true,
            reviewCount: true,
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
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException({ message: 'Orden no encontrada', code: 'not_found' });
    }
    if (order.buyerId !== viewerId && order.sellerId !== viewerId) {
      throw new ForbiddenException({ message: 'No podés ver esta orden', code: 'forbidden' });
    }

    const currency = order.currency as 'ARS';
    const toSummary = (user: typeof order.buyer) => ({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl ?? undefined,
      verified: user.verified,
      rating: user.reviewCount > 0 ? user.ratingSum / user.reviewCount : undefined,
      reviewCount: user.reviewCount,
    });

    return {
      id: order.id,
      reference: order.reference,
      status: order.status,
      buyer: toSummary(order.buyer),
      seller: toSummary(order.seller),
      items: order.items.map((item) => ({
        id: item.id,
        titleSnapshot: item.titleSnapshot,
        unitPriceSnapshot: { amount: item.unitPriceSnapshot, currency },
        imageUrlSnapshot: item.imageUrlSnapshot ?? undefined,
        variantLabelSnapshot: item.variantLabelSnapshot ?? undefined,
        quantity: item.quantity,
        lineTotal: { amount: item.lineTotal, currency },
        listingId: item.listingId ?? undefined,
        variantId: item.variantId ?? undefined,
      })),
      subtotal: { amount: order.subtotal, currency },
      discountTotal: { amount: order.discountTotal, currency },
      shippingTotal: { amount: order.shippingTotal, currency },
      platformFee: { amount: order.platformFee, currency },
      total: { amount: order.total, currency },
      deliveryMethod: order.deliveryMethod,
      createdAt: order.createdAt.toISOString(),
      paidAt: order.paidAt?.toISOString(),
      completedAt: order.completedAt?.toISOString(),
    };
  }
}
