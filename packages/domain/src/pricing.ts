/**
 * Social pricing (spec §23, §24).
 *
 * The single rule that matters: THE SERVER DECIDES THE PRICE. This module is the
 * only place that decides, and both the listing serializer and checkout call it.
 * Checkout re-runs it from scratch rather than trusting anything the client sent
 * back, so a tampered price in the UI cannot become a tampered charge.
 *
 * Discounts are expressed in basis points (1% = 100 bps) and never stack: the
 * buyer gets the single best discount they qualify for. Stacking is a pricing
 * policy decision with real revenue consequences, so it is opt-in per promotion
 * rather than an emergent accident of the resolution order.
 */

import type { AudienceTier, MoneyDto, ResolvedPrice, UUID } from '@cerquita/types';
import {
  applyDiscount,
  discountBasisPoints,
  isGreaterThan,
  money,
  type Money,
} from '@cerquita/utils';

/** Privilege ordering. A friend qualifies for anything a follower qualifies for. */
const TIER_RANK: Record<AudienceTier, number> = {
  public: 0,
  follower: 1,
  friend: 2,
};

export function tierRank(tier: AudienceTier): number {
  return TIER_RANK[tier];
}

export function tierSatisfies(viewer: AudienceTier, required: AudienceTier): boolean {
  return TIER_RANK[viewer] >= TIER_RANK[required];
}

/**
 * A seller-level or store-level default applied to new listings (spec §24).
 * Stores have no notion of friendship, so `friendBasisPoints` is ignored for them.
 */
export interface DiscountPolicy {
  readonly followerBasisPoints: number;
  readonly friendBasisPoints: number;
}

export const NO_DISCOUNT_POLICY: DiscountPolicy = {
  followerBasisPoints: 0,
  friendBasisPoints: 0,
};

/** A per-listing override. `null` on a field means "inherit the seller policy". */
export interface ListingDiscountOverride {
  readonly followerBasisPoints: number | null;
  readonly friendBasisPoints: number | null;
}

/** A promotion narrowed to what pricing needs to evaluate it. */
export interface ApplicablePromotion {
  readonly id: UUID;
  readonly label: string;
  /** Minimum relationship required to qualify. */
  readonly requiredTier: AudienceTier;
  /** Percentage off, in basis points. Mutually exclusive with `fixedPrice`. */
  readonly basisPoints?: number;
  /** Absolute override price. Wins over `basisPoints` if both are set. */
  readonly fixedPrice?: Money;
  readonly startsAt?: Date;
  readonly endsAt?: Date;
  /** Whether this promotion may combine with the social discount. Defaults to false. */
  readonly stacksWithSocialDiscount?: boolean;
}

export interface ResolvePriceInput {
  readonly listPrice: Money;
  readonly tier: AudienceTier;
  readonly sellerPolicy?: DiscountPolicy;
  readonly listingOverride?: ListingDiscountOverride;
  readonly promotions?: readonly ApplicablePromotion[];
  /** Store listings never grant a friend discount — there is no friend-of-a-store. */
  readonly isStoreListing?: boolean;
  readonly now: Date;
}

export interface PriceResolution {
  readonly list: Money;
  readonly effective: Money;
  readonly tier: AudienceTier;
  readonly discountBasisPoints: number;
  readonly appliedPromotionId?: UUID;
  readonly reason?: string;
}

/**
 * Resolves the social discount in basis points for a viewer, before promotions.
 *
 * A friend receives at least the follower discount, because a seller who set
 * "followers -10%, friends -5%" almost certainly made a mistake, and charging a
 * friend more than a stranger-who-follows is never the intent.
 */
export function socialDiscountBasisPoints(input: {
  tier: AudienceTier;
  sellerPolicy?: DiscountPolicy;
  listingOverride?: ListingDiscountOverride;
  isStoreListing?: boolean;
}): number {
  const policy = input.sellerPolicy ?? NO_DISCOUNT_POLICY;
  const override = input.listingOverride;

  const followerBps = override?.followerBasisPoints ?? policy.followerBasisPoints;
  const friendBps = override?.friendBasisPoints ?? policy.friendBasisPoints;

  switch (input.tier) {
    case 'public':
      return 0;
    case 'follower':
      return clampBasisPoints(followerBps);
    case 'friend':
      // Stores have followers but not friends: a "friend" of the store owner
      // still buys at the follower price.
      if (input.isStoreListing) return clampBasisPoints(followerBps);
      return clampBasisPoints(Math.max(friendBps, followerBps));
    default:
      return 0;
  }
}

function clampBasisPoints(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(10_000, Math.max(0, Math.round(value)));
}

function isPromotionActive(promotion: ApplicablePromotion, now: Date): boolean {
  if (promotion.startsAt && now.getTime() < promotion.startsAt.getTime()) return false;
  if (promotion.endsAt && now.getTime() >= promotion.endsAt.getTime()) return false;
  return true;
}

/**
 * The authoritative price for one viewer looking at one listing.
 *
 * Resolution order:
 *   1. Compute the social discount for the viewer's tier.
 *   2. Evaluate every active promotion the viewer qualifies for.
 *   3. Take whichever single outcome is cheapest for the buyer, unless a
 *      promotion opts into stacking, in which case it applies on top of the
 *      social price.
 */
export function resolvePrice(input: ResolvePriceInput): PriceResolution {
  const { listPrice, tier, now } = input;

  const socialBps = socialDiscountBasisPoints({
    tier,
    sellerPolicy: input.sellerPolicy,
    listingOverride: input.listingOverride,
    isStoreListing: input.isStoreListing,
  });

  const socialPrice = applyDiscount(listPrice, socialBps);

  let best: { price: Money; promotionId?: UUID; reason?: string } = {
    price: socialPrice,
    reason: socialBps > 0 ? `social:${tier}` : undefined,
  };

  for (const promotion of input.promotions ?? []) {
    if (!isPromotionActive(promotion, now)) continue;
    if (!tierSatisfies(tier, promotion.requiredTier)) continue;

    // A stacking promotion starts from the social price; otherwise from list.
    const base = promotion.stacksWithSocialDiscount ? socialPrice : listPrice;

    let candidate: Money;
    if (promotion.fixedPrice) {
      candidate = promotion.fixedPrice;
    } else if (typeof promotion.basisPoints === 'number') {
      candidate = applyDiscount(base, clampBasisPoints(promotion.basisPoints));
    } else {
      continue;
    }

    if (candidate.currency !== listPrice.currency) continue;

    if (isGreaterThan(best.price, candidate)) {
      best = { price: candidate, promotionId: promotion.id, reason: promotion.label };
    }
  }

  // A promotion must never raise the price above list.
  const effective = isGreaterThan(best.price, listPrice) ? listPrice : best.price;

  return {
    list: listPrice,
    effective,
    tier,
    discountBasisPoints: discountBasisPoints(listPrice, effective),
    appliedPromotionId: best.promotionId,
    reason: best.reason,
  };
}

/** Serializes a resolution for the wire. */
export function toResolvedPriceDto(resolution: PriceResolution): ResolvedPrice {
  return {
    list: toMoneyDto(resolution.list),
    effective: toMoneyDto(resolution.effective),
    tier: resolution.tier,
    discountBasisPoints: resolution.discountBasisPoints,
    appliedPromotionId: resolution.appliedPromotionId,
    reason: resolution.reason,
  };
}

export function toMoneyDto(value: Money): MoneyDto {
  return { amount: value.amount, currency: value.currency };
}

export function fromMoneyDto(value: MoneyDto): Money {
  return money(value.amount, value.currency);
}

/**
 * Guard used at checkout: recompute, then compare against what the client showed.
 *
 * A mismatch is not automatically fraud — a promotion can expire between page
 * load and payment — so callers surface it as "the price changed, confirm again"
 * rather than an error. What they must never do is charge the client's number.
 */
export function priceMatchesQuote(authoritative: Money, quoted: MoneyDto): boolean {
  return authoritative.amount === quoted.amount && authoritative.currency === quoted.currency;
}
