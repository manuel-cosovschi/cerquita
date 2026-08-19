/**
 * Auction rules (spec §27, §28, §30, §83).
 *
 * The server is the only authority. Nothing here reads a clock or a database —
 * `now` and the current state are passed in — so the concurrency-sensitive parts
 * (which bid wins when two arrive together) are decided by pure, testable logic
 * that the API runs *inside* a serialized transaction holding a row lock on the
 * auction.
 *
 * The transaction boundary is what makes this safe; see
 * `apps/api/src/modules/auctions/auctions.service.ts`.
 */

import type { AuctionStatus, UUID } from '@cerquita/types';
import {
  add,
  compare,
  isGreaterThan,
  isLessThan,
  money,
  type Money,
  addMs,
  MINUTE_MS,
} from '@cerquita/utils';

export interface AuctionState {
  readonly id: UUID;
  readonly sellerId: UUID;
  readonly status: AuctionStatus;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly startingPrice: Money;
  readonly minimumIncrement: Money;
  readonly reservePrice?: Money;
  readonly buyNowPrice?: Money;
  /** Highest accepted bid so far, if any. */
  readonly highestBid?: { readonly bidderId: UUID; readonly amount: Money };
  /**
   * Window before `endsAt` in which a bid extends the auction, in ms.
   * Zero disables anti-sniping.
   */
  readonly antiSnipeWindowMs?: number;
  readonly antiSnipeExtensionMs?: number;
  /** Upper bound on total extension, so an auction cannot run forever. */
  readonly maxEndsAt?: Date;
}

/** The lowest amount a new bid may be. */
export function nextMinimumBid(state: AuctionState): Money {
  if (!state.highestBid) return state.startingPrice;
  return add(state.highestBid.amount, state.minimumIncrement);
}

export type BidRejectionReason =
  | 'auction_not_live'
  | 'auction_ended'
  | 'auction_not_started'
  | 'seller_cannot_bid'
  | 'currency_mismatch'
  | 'below_minimum'
  | 'already_highest_bidder';

export type BidOutcome =
  | {
      readonly accepted: true;
      readonly amount: Money;
      readonly previousHighestBidderId?: UUID;
      /** Set when anti-sniping pushed the end time out. */
      readonly newEndsAt?: Date;
      /** True when this bid meets or exceeds the reserve. */
      readonly reserveMet: boolean;
    }
  | { readonly accepted: false; readonly reason: BidRejectionReason };

export interface PlaceBidInput {
  readonly state: AuctionState;
  readonly bidderId: UUID;
  readonly amount: Money;
  readonly now: Date;
}

/**
 * Validates a single bid against the auction's current state.
 *
 * Called with the auction row already locked. Two simultaneous bids therefore
 * serialize: the second one sees the first one's `highestBid` and is rejected as
 * `below_minimum` unless it clears the new threshold. That is the guarantee
 * behind "only one bid can win" (spec §91).
 */
export function placeBid(input: PlaceBidInput): BidOutcome {
  const { state, bidderId, amount, now } = input;

  if (state.status === 'cancelled' || state.status === 'ended') {
    return { accepted: false, reason: 'auction_ended' };
  }
  if (state.status === 'scheduled' || now.getTime() < state.startsAt.getTime()) {
    return { accepted: false, reason: 'auction_not_started' };
  }
  if (state.status !== 'live') {
    return { accepted: false, reason: 'auction_not_live' };
  }
  if (now.getTime() >= state.endsAt.getTime()) {
    return { accepted: false, reason: 'auction_ended' };
  }
  if (bidderId === state.sellerId) {
    return { accepted: false, reason: 'seller_cannot_bid' };
  }
  if (amount.currency !== state.startingPrice.currency) {
    return { accepted: false, reason: 'currency_mismatch' };
  }
  // Re-bidding against yourself only inflates the price you will pay.
  if (state.highestBid && state.highestBid.bidderId === bidderId) {
    return { accepted: false, reason: 'already_highest_bidder' };
  }

  const minimum = nextMinimumBid(state);
  if (isLessThan(amount, minimum)) {
    return { accepted: false, reason: 'below_minimum' };
  }

  const newEndsAt = computeAntiSnipeEnd(state, now);

  return {
    accepted: true,
    amount,
    previousHighestBidderId: state.highestBid?.bidderId,
    newEndsAt,
    reserveMet: meetsReserve(state, amount),
  };
}

/**
 * Anti-sniping: a bid inside the closing window pushes the end time out, so a
 * last-second bid cannot deny others a response. Capped by `maxEndsAt`.
 */
export function computeAntiSnipeEnd(state: AuctionState, now: Date): Date | undefined {
  const window = state.antiSnipeWindowMs ?? 0;
  if (window <= 0) return undefined;

  const remaining = state.endsAt.getTime() - now.getTime();
  if (remaining > window) return undefined;

  const extension = state.antiSnipeExtensionMs ?? window;
  let extended = addMs(state.endsAt, extension);

  if (state.maxEndsAt && extended.getTime() > state.maxEndsAt.getTime()) {
    extended = state.maxEndsAt;
  }
  return extended.getTime() > state.endsAt.getTime() ? extended : undefined;
}

export function meetsReserve(state: AuctionState, amount: Money): boolean {
  if (!state.reservePrice) return true;
  return compare(amount, state.reservePrice) >= 0;
}

export function hasReserve(state: AuctionState): boolean {
  return state.reservePrice !== undefined;
}

/** Whether the current highest bid has met the reserve. */
export function reserveMet(state: AuctionState): boolean {
  if (!state.reservePrice) return true;
  if (!state.highestBid) return false;
  return compare(state.highestBid.amount, state.reservePrice) >= 0;
}

export type BuyNowRejectionReason =
  | 'buy_now_unavailable'
  | 'auction_not_live'
  | 'auction_ended'
  | 'seller_cannot_buy'
  | 'price_exceeded';

export type BuyNowOutcome =
  | { readonly allowed: true; readonly price: Money }
  | { readonly allowed: false; readonly reason: BuyNowRejectionReason };

/**
 * "Comprar ahora" on an auction (spec §30).
 *
 * Buy-now is withdrawn once bidding has passed it — otherwise a bidder who bid
 * above the buy-now price would be undercut by someone paying less.
 */
export function canBuyNow(input: { state: AuctionState; buyerId: UUID; now: Date }): BuyNowOutcome {
  const { state, buyerId, now } = input;

  if (!state.buyNowPrice) return { allowed: false, reason: 'buy_now_unavailable' };
  if (buyerId === state.sellerId) return { allowed: false, reason: 'seller_cannot_buy' };
  if (state.status === 'ended' || state.status === 'cancelled') {
    return { allowed: false, reason: 'auction_ended' };
  }
  if (state.status !== 'live') return { allowed: false, reason: 'auction_not_live' };
  if (now.getTime() >= state.endsAt.getTime()) {
    return { allowed: false, reason: 'auction_ended' };
  }
  if (state.highestBid && !isLessThan(state.highestBid.amount, state.buyNowPrice)) {
    return { allowed: false, reason: 'price_exceeded' };
  }

  return { allowed: true, price: state.buyNowPrice };
}

export interface AuctionClosure {
  readonly status: 'ended';
  readonly winnerId?: UUID;
  readonly finalPrice?: Money;
  readonly reserveMet: boolean;
  /** True when bids existed but none reached the reserve, so nothing is sold. */
  readonly endedBelowReserve: boolean;
}

/**
 * Determines the outcome when an auction's clock runs out.
 *
 * Runs in the closing job, inside a transaction, and never on a client (§28).
 */
export function closeAuction(state: AuctionState): AuctionClosure {
  const highest = state.highestBid;

  if (!highest) {
    return {
      status: 'ended',
      reserveMet: !state.reservePrice,
      endedBelowReserve: false,
    };
  }

  const met = meetsReserve(state, highest.amount);
  if (!met) {
    return { status: 'ended', reserveMet: false, endedBelowReserve: true };
  }

  return {
    status: 'ended',
    winnerId: highest.bidderId,
    finalPrice: highest.amount,
    reserveMet: true,
    endedBelowReserve: false,
  };
}

/** Whether a scheduled auction should flip to `live`. Used by the scheduler job. */
export function shouldStart(state: AuctionState, now: Date): boolean {
  return state.status === 'scheduled' && now.getTime() >= state.startsAt.getTime();
}

/** Whether a live auction should be closed. Used by the closing job. */
export function shouldClose(state: AuctionState, now: Date): boolean {
  return state.status === 'live' && now.getTime() >= state.endsAt.getTime();
}

export interface AuctionValidationIssue {
  readonly field: string;
  readonly message: string;
}

export const MIN_AUCTION_DURATION_MS = 15 * MINUTE_MS;
export const MAX_AUCTION_DURATION_MS = 30 * 24 * 60 * MINUTE_MS;

/** Validates an auction at creation time. Returns every problem, not just the first. */
export function validateAuctionSetup(input: {
  startsAt: Date;
  endsAt: Date;
  startingPrice: Money;
  minimumIncrement: Money;
  reservePrice?: Money;
  buyNowPrice?: Money;
  now: Date;
}): AuctionValidationIssue[] {
  const issues: AuctionValidationIssue[] = [];
  const currency = input.startingPrice.currency;

  if (input.startingPrice.amount <= 0) {
    issues.push({ field: 'startingPrice', message: 'El precio inicial debe ser mayor a cero' });
  }
  if (input.minimumIncrement.amount <= 0) {
    issues.push({
      field: 'minimumIncrement',
      message: 'El incremento mínimo debe ser mayor a cero',
    });
  }

  const duration = input.endsAt.getTime() - input.startsAt.getTime();
  if (duration < MIN_AUCTION_DURATION_MS) {
    issues.push({ field: 'endsAt', message: 'La subasta debe durar al menos 15 minutos' });
  }
  if (duration > MAX_AUCTION_DURATION_MS) {
    issues.push({ field: 'endsAt', message: 'La subasta no puede durar más de 30 días' });
  }
  if (input.endsAt.getTime() <= input.now.getTime()) {
    issues.push({ field: 'endsAt', message: 'La subasta no puede terminar en el pasado' });
  }

  for (const [field, value] of [
    ['minimumIncrement', input.minimumIncrement],
    ['reservePrice', input.reservePrice],
    ['buyNowPrice', input.buyNowPrice],
  ] as const) {
    if (value && value.currency !== currency) {
      issues.push({ field, message: 'Todos los montos deben usar la misma moneda' });
    }
  }

  // Comparing across currencies is meaningless and throws, so the ordering
  // checks below only run once every amount is known to share one currency.
  const reserve = input.reservePrice?.currency === currency ? input.reservePrice : undefined;
  const buyNow = input.buyNowPrice?.currency === currency ? input.buyNowPrice : undefined;

  if (reserve && isLessThan(reserve, input.startingPrice)) {
    issues.push({
      field: 'reservePrice',
      message: 'El precio de reserva no puede ser menor al precio inicial',
    });
  }
  if (buyNow) {
    if (!isGreaterThan(buyNow, input.startingPrice)) {
      issues.push({
        field: 'buyNowPrice',
        message: 'El precio de compra inmediata debe superar al precio inicial',
      });
    }
    if (reserve && isLessThan(buyNow, reserve)) {
      issues.push({
        field: 'buyNowPrice',
        message: 'El precio de compra inmediata no puede ser menor al precio de reserva',
      });
    }
  }

  return issues;
}

/** Suggests a sane minimum increment (~5% of the starting price, floored at 1 unit). */
export function suggestMinimumIncrement(startingPrice: Money): Money {
  const raw = Math.round(startingPrice.amount * 0.05);
  const magnitude = 10 ** Math.max(0, String(Math.max(1, raw)).length - 2);
  const rounded = Math.max(1, Math.round(raw / magnitude) * magnitude);
  return money(rounded, startingPrice.currency);
}
