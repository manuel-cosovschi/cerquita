import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  buildCounterOffer,
  canCancel,
  canCreateOffer,
  canRespond,
  resolvePrice,
  type OfferState,
} from '@cerquita/domain';
import type { Offer } from '@cerquita/types';
import { addMinutes, money, type Currency, type Money } from '@cerquita/utils';
import { PrismaService } from '../../prisma/prisma.service';
import { EventBus } from '../events/event-bus.service';
import { ListingsService } from '../listings/listings.service';
import { UserSerializer, USER_SUMMARY_SELECT } from '../users/user.serializer';

const REJECTIONS: Record<string, string> = {
  listing_not_available: 'La publicación ya no está disponible',
  cannot_offer_on_own_listing: 'No podés ofertar en tu propia publicación',
  currency_mismatch: 'La moneda no coincide',
  amount_must_be_positive: 'El monto debe ser mayor a cero',
  amount_exceeds_price: 'Tu oferta supera el precio publicado',
  offers_not_accepted: 'Esta publicación no acepta ofertas',
  duplicate_pending_offer: 'Ya tenés una oferta pendiente en esta publicación',
};

/** Offer negotiation (spec §25). State transitions come from the domain package. */
@Injectable()
export class OffersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
    private readonly listings: ListingsService,
    private readonly users: UserSerializer,
  ) {}

  async create(
    input: { listingId: string; amount: Money; message?: string; expiresInMinutes?: number },
    buyerId: string,
  ) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: input.listingId },
      select: {
        id: true,
        sellerId: true,
        storeId: true,
        status: true,
        acceptsOffers: true,
        priceAmount: true,
        priceCurrency: true,
        followerDiscountBps: true,
        friendDiscountBps: true,
        seller: { select: { followerDiscountBps: true, friendDiscountBps: true } },
      },
    });

    if (!listing) {
      throw new NotFoundException({ message: 'Publicación no encontrada', code: 'not_found' });
    }

    // Compare against the price THIS buyer would actually pay, so someone with a
    // friend discount is not blocked for "exceeding" the public price.
    const tier = await this.listings.resolveTier(listing.sellerId, buyerId);
    const asking = resolvePrice({
      listPrice: money(listing.priceAmount ?? 0, listing.priceCurrency as 'ARS'),
      tier,
      sellerPolicy: {
        followerBasisPoints: listing.seller.followerDiscountBps,
        friendBasisPoints: listing.seller.friendDiscountBps,
      },
      listingOverride: {
        followerBasisPoints: listing.followerDiscountBps,
        friendBasisPoints: listing.friendDiscountBps,
      },
      isStoreListing: listing.storeId !== null,
      now: new Date(),
    }).effective;

    const pending = await this.prisma.offer.count({
      where: { listingId: listing.id, fromUserId: buyerId, status: 'pending' },
    });

    const decision = canCreateOffer({
      listingId: listing.id,
      sellerId: listing.sellerId,
      buyerId,
      amount: input.amount,
      askingPrice: asking,
      listingAcceptsOffers: listing.acceptsOffers,
      listingIsAvailable: listing.status === 'active',
      existingPendingOffers: pending,
    });

    if (!decision.ok) {
      throw new BadRequestException({
        message: REJECTIONS[decision.reason] ?? 'No pudimos crear la oferta',
        code: decision.reason,
      });
    }

    const offer = await this.prisma.offer.create({
      data: {
        listingId: listing.id,
        fromUserId: buyerId,
        toUserId: listing.sellerId,
        amount: input.amount.amount,
        currency: input.amount.currency,
        message: input.message,
        expiresAt: input.expiresInMinutes ? addMinutes(new Date(), input.expiresInMinutes) : null,
      },
    });

    await this.events.publish({
      type: 'OfferCreated',
      id: offer.id,
      occurredAt: new Date().toISOString(),
      offerId: offer.id,
      listingId: listing.id,
      fromUserId: buyerId,
      toUserId: listing.sellerId,
      amount: { amount: input.amount.amount, currency: input.amount.currency },
    });

    return offer;
  }

  async respond(
    offerId: string,
    actorId: string,
    action:
      | { action: 'accept' }
      | { action: 'reject'; reason?: string }
      | { action: 'counter'; amount: Money; message?: string; expiresInMinutes?: number },
  ) {
    const row = await this.prisma.offer.findUnique({ where: { id: offerId } });
    if (!row) {
      throw new NotFoundException({ message: 'Oferta no encontrada', code: 'not_found' });
    }

    const state = this.toState(row);
    const now = new Date();

    if (!canRespond(state, actorId, now)) {
      throw new BadRequestException({
        message: 'No podés responder esta oferta',
        code: 'cannot_respond',
      });
    }

    if (action.action === 'accept') {
      const updated = await this.prisma.offer.update({
        where: { id: offerId },
        data: { status: 'accepted' },
      });

      await this.events.publish({
        type: 'OfferAccepted',
        id: offerId,
        occurredAt: now.toISOString(),
        offerId,
        listingId: row.listingId,
        buyerId: row.fromUserId,
        sellerId: row.toUserId,
        amount: { amount: row.amount, currency: row.currency as 'ARS' },
      });

      return updated;
    }

    if (action.action === 'reject') {
      return this.prisma.offer.update({ where: { id: offerId }, data: { status: 'rejected' } });
    }

    // Countering closes this offer and opens a new one in the opposite
    // direction, so the negotiation history stays intact for disputes.
    const counter = buildCounterOffer({
      original: state,
      amount: action.amount,
      expiresAt: action.expiresInMinutes ? addMinutes(now, action.expiresInMinutes) : undefined,
    });

    const [, created] = await this.prisma.$transaction([
      this.prisma.offer.update({ where: { id: offerId }, data: { status: 'countered' } }),
      this.prisma.offer.create({
        data: {
          listingId: counter.listingId,
          fromUserId: counter.fromUserId,
          toUserId: counter.toUserId,
          amount: counter.amount.amount,
          currency: counter.amount.currency,
          message: action.message,
          expiresAt: counter.expiresAt ?? null,
          counterOfOfferId: offerId,
        },
      }),
    ]);

    return created;
  }

  async cancel(offerId: string, actorId: string) {
    const row = await this.prisma.offer.findUnique({ where: { id: offerId } });
    if (!row) {
      throw new NotFoundException({ message: 'Oferta no encontrada', code: 'not_found' });
    }
    if (!canCancel(this.toState(row), actorId, new Date())) {
      throw new BadRequestException({
        message: 'No podés cancelar esta oferta',
        code: 'forbidden',
      });
    }
    return this.prisma.offer.update({ where: { id: offerId }, data: { status: 'cancelled' } });
  }

  /** Expires stale offers. Driven by the same tick as the auction scheduler. */
  async expireDueOffers(now = new Date()): Promise<number> {
    const result = await this.prisma.offer.updateMany({
      where: { status: 'pending', expiresAt: { not: null, lte: now } },
      data: { status: 'expired' },
    });
    return result.count;
  }

  /**
   * Every offer the viewer is a party to, in both directions.
   *
   * One list rather than two endpoints: a seller who counter-offered is now the
   * sender of the live offer, and splitting "recibidas" from "enviadas" at the
   * API would put the two halves of one negotiation on different screens. The
   * client decides how to group them; the server decides what you may see.
   *
   * Expired and cancelled offers are excluded — an offer nobody can act on any
   * more is history, and the inbox is for things that need an answer.
   */
  async listForUser(viewerId: string): Promise<Offer[]> {
    const rows = await this.prisma.offer.findMany({
      where: {
        OR: [{ fromUserId: viewerId }, { toUserId: viewerId }],
        status: { in: ['pending', 'accepted', 'countered'] },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        fromUser: { select: USER_SUMMARY_SELECT },
        toUser: { select: USER_SUMMARY_SELECT },
      },
    });

    // Listings are resolved for the viewer in one batch so the inbox can show
    // what the offer is actually about.
    const listings = await this.listings.summariesByIds(
      rows.map((row) => row.listingId),
      viewerId,
    );

    return rows.map((row) => ({
      id: row.id,
      listingId: row.listingId,
      listing: listings.get(row.listingId),
      status: row.status as Offer['status'],
      // The column is plain text and the wire type is a closed union, so it
      // goes through `money`, which validates rather than casts.
      amount: money(row.amount, row.currency as Currency),
      fromUser: this.users.toSummary(row.fromUser),
      toUser: this.users.toSummary(row.toUser),
      message: row.message ?? undefined,
      expiresAt: row.expiresAt?.toISOString(),
      counterOfOfferId: row.counterOfOfferId ?? undefined,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  private toState(row: {
    id: string;
    listingId: string;
    fromUserId: string;
    toUserId: string;
    amount: number;
    currency: string;
    status: string;
    expiresAt: Date | null;
    counterOfOfferId: string | null;
  }): OfferState {
    return {
      id: row.id,
      listingId: row.listingId,
      fromUserId: row.fromUserId,
      toUserId: row.toUserId,
      amount: money(row.amount, row.currency as 'ARS'),
      status: row.status as OfferState['status'],
      expiresAt: row.expiresAt ?? undefined,
      counterOfOfferId: row.counterOfOfferId ?? undefined,
    };
  }
}
