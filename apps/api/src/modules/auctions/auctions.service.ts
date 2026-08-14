import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuctionStatus } from '@cerquita/types';
import {
  canBuyNow,
  closeAuction,
  placeBid,
  type AuctionState,
  type BidOutcome,
} from '@cerquita/domain';
import { money, type Money } from '@cerquita/utils';
import { PrismaService } from '../../prisma/prisma.service';
import { EventBus } from '../events/event-bus.service';

const REJECTION_MESSAGES: Record<string, string> = {
  auction_not_live: 'La subasta no está activa',
  auction_ended: 'La subasta ya terminó',
  auction_not_started: 'La subasta todavía no empezó',
  seller_cannot_bid: 'No podés pujar en tu propia subasta',
  currency_mismatch: 'La moneda no coincide',
  below_minimum: 'Tu puja no alcanza el mínimo requerido',
  already_highest_bidder: 'Ya tenés la puja más alta',
};

/**
 * Auction writes.
 *
 * The whole correctness argument for bidding lives in `bid()`:
 *
 *   1. Open a READ COMMITTED transaction and take a row lock on the auction
 *      (`SELECT … FOR UPDATE`) — see `PrismaService.withRowLock` for why the
 *      isolation level must NOT be SERIALIZABLE here.
 *   2. Re-read the auction under the lock; never trust what the client saw.
 *   3. Decide with the pure `placeBid` rules from the domain package.
 *   4. Insert the bid and update the standing bid in the same transaction.
 *
 * Two simultaneous bids serialize at step 1. The loser reads the winner's bid at
 * step 2 and is rejected as `below_minimum`. There is no window in which both
 * can be accepted, and the winner is never computed on a client (spec §28).
 *
 * The `@@unique([auctionId, amount])` constraint backs this up at the storage
 * layer: even if the logic above were wrong, two identical winning bids could
 * not both be stored.
 */
@Injectable()
export class AuctionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
  ) {}

  async bid(input: {
    auctionId: string;
    bidderId: string;
    amount: Money;
    expectedMinimum?: Money;
  }): Promise<{ accepted: true; currentPrice: Money; nextMinimumBid: Money; endsAt: Date }> {
    const result = await this.prisma.withRowLock('Auction', input.auctionId, async (tx) => {
      // Re-read UNDER the lock. At READ COMMITTED this returns whatever the
      // previous bidder just committed, which is what makes the rejection below
      // correct rather than a race against a stale snapshot.
      const auction = await tx.auction.findUniqueOrThrow({
        where: { id: input.auctionId },
        include: { listing: { select: { sellerId: true } } },
      });

      const state = this.toState(auction, auction.listing.sellerId);
      const now = new Date();

      // If the client bid against a stale threshold, tell it rather than
      // silently accepting a number the user did not mean to commit to.
      if (input.expectedMinimum) {
        const actualMinimum = state.highestBid
          ? state.highestBid.amount.amount + state.minimumIncrement.amount
          : state.startingPrice.amount;
        if (input.expectedMinimum.amount !== actualMinimum) {
          throw new ConflictException({
            message: 'Alguien pujó antes que vos. Revisá el nuevo mínimo.',
            code: 'stale_minimum',
            nextMinimumBid: { amount: actualMinimum, currency: state.startingPrice.currency },
          });
        }
      }

      const outcome: BidOutcome = placeBid({
        state,
        bidderId: input.bidderId,
        amount: input.amount,
        now,
      });

      if (!outcome.accepted) {
        throw new BadRequestException({
          message: REJECTION_MESSAGES[outcome.reason] ?? 'No pudimos registrar tu puja',
          code: outcome.reason,
          nextMinimumBid: {
            amount: state.highestBid
              ? state.highestBid.amount.amount + state.minimumIncrement.amount
              : state.startingPrice.amount,
            currency: state.startingPrice.currency,
          },
        });
      }

      const bid = await tx.bid.create({
        data: {
          auctionId: auction.id,
          bidderId: input.bidderId,
          amount: outcome.amount.amount,
          currency: outcome.amount.currency,
          placedAt: now,
        },
        select: { id: true },
      });

      const isNewParticipant =
        (await tx.bid.count({
          where: { auctionId: auction.id, bidderId: input.bidderId },
        })) === 1;

      const updated = await tx.auction.update({
        where: { id: auction.id },
        data: {
          highestBidAmount: outcome.amount.amount,
          highestBidderId: input.bidderId,
          bidCount: { increment: 1 },
          participantCount: isNewParticipant ? { increment: 1 } : undefined,
          endsAt: outcome.newEndsAt ?? undefined,
        },
        select: { endsAt: true, minimumIncrementAmount: true, currency: true },
      });

      return {
        bidId: bid.id,
        amount: outcome.amount,
        previousHighestBidderId: outcome.previousHighestBidderId,
        endsAt: updated.endsAt,
        nextMinimumBid: money(
          outcome.amount.amount + updated.minimumIncrementAmount,
          updated.currency as 'ARS',
        ),
      };
    });

    await this.events.publish({
      type: 'BidPlaced',
      id: result.bidId,
      occurredAt: new Date().toISOString(),
      auctionId: input.auctionId,
      bidId: result.bidId,
      bidderId: input.bidderId,
      amount: { amount: result.amount.amount, currency: result.amount.currency },
      previousHighestBidderId: result.previousHighestBidderId,
    });

    return {
      accepted: true,
      currentPrice: result.amount,
      nextMinimumBid: result.nextMinimumBid,
      endsAt: result.endsAt,
    };
  }

  /**
   * Buy-now ends the auction immediately and blocks further bids, inside the
   * same lock bidding uses — so a bid cannot slip in between the check and the
   * close (spec §30).
   */
  async buyNow(input: {
    auctionId: string;
    buyerId: string;
  }): Promise<{ price: Money; listingId: string }> {
    return this.prisma.withRowLock('Auction', input.auctionId, async (tx) => {
      const auction = await tx.auction.findUniqueOrThrow({
        where: { id: input.auctionId },
        include: { listing: { select: { id: true, sellerId: true } } },
      });

      const decision = canBuyNow({
        state: this.toState(auction, auction.listing.sellerId),
        buyerId: input.buyerId,
        now: new Date(),
      });

      if (!decision.allowed) {
        throw new BadRequestException({
          message:
            decision.reason === 'price_exceeded'
              ? 'Las pujas ya superaron el precio de compra inmediata'
              : 'La compra inmediata no está disponible',
          code: decision.reason,
        });
      }

      await tx.auction.update({
        where: { id: auction.id },
        data: {
          status: 'ended',
          winnerId: input.buyerId,
          finalAmount: decision.price.amount,
          closedAt: new Date(),
        },
      });
      await tx.listing.update({
        where: { id: auction.listing.id },
        data: { status: 'reserved' },
      });

      return { price: decision.price, listingId: auction.listing.id };
    });
  }

  /**
   * Closes every auction whose clock has run out. Driven by the scheduler job,
   * not by a request, so an auction ends on time whether or not anyone is
   * watching it.
   */
  async closeDueAuctions(now = new Date()): Promise<number> {
    const due = await this.prisma.auction.findMany({
      where: { status: 'live', endsAt: { lte: now } },
      select: { id: true },
      take: 100,
    });

    let closed = 0;
    for (const { id } of due) {
      await this.closeOne(id).then(
        () => {
          closed += 1;
        },
        () => undefined,
      );
    }
    return closed;
  }

  private async closeOne(auctionId: string): Promise<void> {
    const result = await this.prisma.withRowLock('Auction', auctionId, async (tx) => {
      const auction = await tx.auction.findUniqueOrThrow({
        where: { id: auctionId },
        include: { listing: { select: { id: true, sellerId: true } } },
      });

      // Another worker may have closed it between the scan and the lock.
      if (auction.status !== 'live') return null;

      const closure = closeAuction(this.toState(auction, auction.listing.sellerId));

      await tx.auction.update({
        where: { id: auctionId },
        data: {
          status: 'ended',
          winnerId: closure.winnerId ?? null,
          finalAmount: closure.finalPrice?.amount ?? null,
          closedAt: new Date(),
        },
      });

      await tx.listing.update({
        where: { id: auction.listing.id },
        // No winner means the item goes back on sale rather than being marked sold.
        data: { status: closure.winnerId ? 'reserved' : 'active' },
      });

      return { closure, listingId: auction.listing.id, sellerId: auction.listing.sellerId };
    });

    if (!result) return;

    await this.events.publish({
      type: 'AuctionEnded',
      id: auctionId,
      occurredAt: new Date().toISOString(),
      auctionId,
      listingId: result.listingId,
      sellerId: result.sellerId,
      winnerId: result.closure.winnerId,
      finalPrice: result.closure.finalPrice
        ? {
            amount: result.closure.finalPrice.amount,
            currency: result.closure.finalPrice.currency,
          }
        : undefined,
      reserveMet: result.closure.reserveMet,
    });
  }

  /** Flips scheduled auctions to live once their start time arrives. */
  async startDueAuctions(now = new Date()): Promise<number> {
    const due = await this.prisma.auction.findMany({
      where: { status: 'scheduled', startsAt: { lte: now } },
      select: { id: true, listing: { select: { id: true, sellerId: true } } },
      take: 100,
    });

    for (const auction of due) {
      await this.prisma.auction.update({
        where: { id: auction.id },
        data: { status: 'live' },
      });
      await this.events.publish({
        type: 'AuctionStarted',
        id: auction.id,
        occurredAt: new Date().toISOString(),
        auctionId: auction.id,
        listingId: auction.listing.id,
        sellerId: auction.listing.sellerId,
      });
    }

    return due.length;
  }

  /** Maps a database row into the pure domain state the rules operate on. */
  private toState(
    auction: {
      id: string;
      status: AuctionStatus;
      startsAt: Date;
      endsAt: Date;
      currency: string;
      startingPriceAmount: number;
      minimumIncrementAmount: number;
      reservePriceAmount: number | null;
      buyNowPriceAmount: number | null;
      highestBidAmount: number | null;
      highestBidderId: string | null;
      antiSnipeWindowMs: number;
      antiSnipeExtensionMs: number;
      maxEndsAt: Date | null;
    },
    sellerId: string,
  ): AuctionState {
    const currency = auction.currency as 'ARS';

    return {
      id: auction.id,
      sellerId,
      status: auction.status,
      startsAt: auction.startsAt,
      endsAt: auction.endsAt,
      startingPrice: money(auction.startingPriceAmount, currency),
      minimumIncrement: money(auction.minimumIncrementAmount, currency),
      reservePrice:
        auction.reservePriceAmount === null
          ? undefined
          : money(auction.reservePriceAmount, currency),
      buyNowPrice:
        auction.buyNowPriceAmount === null
          ? undefined
          : money(auction.buyNowPriceAmount, currency),
      highestBid:
        auction.highestBidAmount === null || auction.highestBidderId === null
          ? undefined
          : {
              bidderId: auction.highestBidderId,
              amount: money(auction.highestBidAmount, currency),
            },
      antiSnipeWindowMs: auction.antiSnipeWindowMs,
      antiSnipeExtensionMs: auction.antiSnipeExtensionMs,
      maxEndsAt: auction.maxEndsAt ?? undefined,
    };
  }
}
