/**
 * Offers and counteroffers (spec §25).
 *
 * An offer is a negotiation step, not a payment. Accepting one locks a price for
 * a specific buyer; checkout later re-reads that locked price through
 * `lockedPriceForOffer` rather than recomputing the social price, because the
 * negotiated number supersedes it.
 */

import type { OfferStatus, UUID } from '@cerquita/types';
import { isGreaterThan, isPast, type Money } from '@cerquita/utils';

export interface OfferState {
  readonly id: UUID;
  readonly listingId: UUID;
  readonly fromUserId: UUID;
  readonly toUserId: UUID;
  readonly amount: Money;
  readonly status: OfferStatus;
  readonly expiresAt?: Date;
  /** Set when this offer is a counter to an earlier one. */
  readonly counterOfOfferId?: UUID;
}

/** Statuses from which no further action is possible. */
const TERMINAL_STATUSES: readonly OfferStatus[] = [
  'accepted',
  'rejected',
  'expired',
  'cancelled',
  'completed',
];

export function isTerminal(status: OfferStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Legal transitions. `countered` is terminal for the original offer — countering
 * creates a NEW offer in the opposite direction rather than mutating this one,
 * which keeps the negotiation history intact for disputes.
 */
const TRANSITIONS: Record<OfferStatus, readonly OfferStatus[]> = {
  pending: ['accepted', 'rejected', 'countered', 'expired', 'cancelled'],
  countered: ['expired'],
  accepted: ['completed', 'cancelled'],
  rejected: [],
  expired: [],
  cancelled: [],
  completed: [],
};

export function canTransition(from: OfferStatus, to: OfferStatus): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

/** An offer is only actionable while pending and unexpired. */
export function isActionable(offer: OfferState, now: Date): boolean {
  if (offer.status !== 'pending') return false;
  if (offer.expiresAt && isPast(offer.expiresAt, now)) return false;
  return true;
}

export type OfferRejectionReason =
  | 'listing_not_available'
  | 'cannot_offer_on_own_listing'
  | 'currency_mismatch'
  | 'amount_must_be_positive'
  | 'amount_exceeds_price'
  | 'offers_not_accepted'
  | 'duplicate_pending_offer';

export type CreateOfferOutcome =
  { readonly ok: true } | { readonly ok: false; readonly reason: OfferRejectionReason };

export interface CreateOfferInput {
  readonly listingId: UUID;
  readonly sellerId: UUID;
  readonly buyerId: UUID;
  readonly amount: Money;
  /** The listing's current asking price for this buyer. */
  readonly askingPrice: Money;
  readonly listingAcceptsOffers: boolean;
  readonly listingIsAvailable: boolean;
  /** Pending offers this buyer already has on this listing. */
  readonly existingPendingOffers: number;
}

export function canCreateOffer(input: CreateOfferInput): CreateOfferOutcome {
  if (!input.listingIsAvailable) return { ok: false, reason: 'listing_not_available' };
  if (!input.listingAcceptsOffers) return { ok: false, reason: 'offers_not_accepted' };
  if (input.buyerId === input.sellerId) {
    return { ok: false, reason: 'cannot_offer_on_own_listing' };
  }
  if (input.amount.currency !== input.askingPrice.currency) {
    return { ok: false, reason: 'currency_mismatch' };
  }
  if (input.amount.amount <= 0) return { ok: false, reason: 'amount_must_be_positive' };
  // Offering above asking price is pointless and usually a typo — buy it instead.
  if (isGreaterThan(input.amount, input.askingPrice)) {
    return { ok: false, reason: 'amount_exceeds_price' };
  }
  if (input.existingPendingOffers > 0) {
    return { ok: false, reason: 'duplicate_pending_offer' };
  }
  return { ok: true };
}

/** Who is allowed to respond (accept/reject/counter) to an offer. */
export function canRespond(offer: OfferState, userId: UUID, now: Date): boolean {
  return isActionable(offer, now) && offer.toUserId === userId;
}

/** Who is allowed to withdraw an offer: only whoever made it. */
export function canCancel(offer: OfferState, userId: UUID, now: Date): boolean {
  return isActionable(offer, now) && offer.fromUserId === userId;
}

/**
 * Builds the counteroffer that replaces `offer`. The direction flips: the
 * responder becomes the proposer.
 */
export function buildCounterOffer(input: {
  original: OfferState;
  amount: Money;
  expiresAt?: Date;
}): Omit<OfferState, 'id' | 'status'> & { status: 'pending' } {
  return {
    listingId: input.original.listingId,
    fromUserId: input.original.toUserId,
    toUserId: input.original.fromUserId,
    amount: input.amount,
    status: 'pending',
    expiresAt: input.expiresAt,
    counterOfOfferId: input.original.id,
  };
}

/**
 * The price checkout must charge for an accepted offer.
 *
 * Returns `null` when the offer cannot back a purchase, so the caller falls back
 * to normal pricing instead of silently charging a stale negotiated amount.
 */
export function lockedPriceForOffer(offer: OfferState, buyerId: UUID): Money | null {
  if (offer.status !== 'accepted') return null;
  // The buyer is whoever the accepted offer names — either the original proposer
  // or, for a counteroffer, whoever accepted it.
  if (offer.fromUserId !== buyerId && offer.toUserId !== buyerId) return null;
  return offer.amount;
}

/** Offers that have passed their expiry, for the sweeper job. */
export function selectExpiredOffers(
  offers: readonly OfferState[],
  now: Date,
): readonly OfferState[] {
  return offers.filter(
    (offer) =>
      offer.status === 'pending' && offer.expiresAt !== undefined && isPast(offer.expiresAt, now),
  );
}
