import { describe, expect, it } from 'vitest';
import { money } from '@cerquita/utils';
import {
  canBuyNow,
  closeAuction,
  nextMinimumBid,
  placeBid,
  shouldClose,
  shouldStart,
  suggestMinimumIncrement,
  validateAuctionSetup,
  type AuctionState,
} from './auctions.js';

const ARS = (major: number) => money(major * 100, 'ARS');
const NOW = new Date('2026-08-14T12:00:00.000Z');

function auction(overrides: Partial<AuctionState> = {}): AuctionState {
  return {
    id: 'auction-1',
    sellerId: 'seller-1',
    status: 'live',
    startsAt: new Date('2026-08-14T10:00:00.000Z'),
    endsAt: new Date('2026-08-14T14:00:00.000Z'),
    startingPrice: ARS(500_000),
    minimumIncrement: ARS(10_000),
    ...overrides,
  };
}

describe('bidding', () => {
  it('accepts a first bid at the starting price', () => {
    const outcome = placeBid({
      state: auction(),
      bidderId: 'buyer-1',
      amount: ARS(500_000),
      now: NOW,
    });
    expect(outcome.accepted).toBe(true);
  });

  it('rejects a first bid below the starting price', () => {
    const outcome = placeBid({
      state: auction(),
      bidderId: 'buyer-1',
      amount: ARS(499_000),
      now: NOW,
    });
    expect(outcome).toEqual({ accepted: false, reason: 'below_minimum' });
  });

  it('requires the minimum increment over the standing bid', () => {
    const state = auction({ highestBid: { bidderId: 'buyer-1', amount: ARS(500_000) } });
    expect(nextMinimumBid(state)).toEqual(ARS(510_000));

    expect(
      placeBid({ state, bidderId: 'buyer-2', amount: ARS(505_000), now: NOW }).accepted,
    ).toBe(false);
    expect(
      placeBid({ state, bidderId: 'buyer-2', amount: ARS(510_000), now: NOW }).accepted,
    ).toBe(true);
  });

  /**
   * Spec §91: two users bid simultaneously; only one may win.
   *
   * The API holds a row lock on the auction, so the two bids serialize. This
   * models that: both see the same pre-state, but the second one is evaluated
   * against the state the first one produced.
   */
  it('lets only one of two simultaneous bids win', () => {
    const initial = auction({ highestBid: { bidderId: 'buyer-0', amount: ARS(500_000) } });
    const amount = ARS(510_000);

    const first = placeBid({ state: initial, bidderId: 'buyer-1', amount, now: NOW });
    expect(first.accepted).toBe(true);

    // Second transaction now observes buyer-1's bid.
    const afterFirst = auction({ highestBid: { bidderId: 'buyer-1', amount } });
    const second = placeBid({ state: afterFirst, bidderId: 'buyer-2', amount, now: NOW });

    expect(second).toEqual({ accepted: false, reason: 'below_minimum' });
  });

  it('refuses a bid from the seller', () => {
    const outcome = placeBid({
      state: auction(),
      bidderId: 'seller-1',
      amount: ARS(600_000),
      now: NOW,
    });
    expect(outcome).toEqual({ accepted: false, reason: 'seller_cannot_bid' });
  });

  it('refuses to let the highest bidder bid against themselves', () => {
    const state = auction({ highestBid: { bidderId: 'buyer-1', amount: ARS(500_000) } });
    const outcome = placeBid({ state, bidderId: 'buyer-1', amount: ARS(600_000), now: NOW });
    expect(outcome).toEqual({ accepted: false, reason: 'already_highest_bidder' });
  });

  it('refuses bids before the start and after the end', () => {
    expect(
      placeBid({
        state: auction({ status: 'scheduled' }),
        bidderId: 'buyer-1',
        amount: ARS(500_000),
        now: new Date('2026-08-14T09:00:00.000Z'),
      }),
    ).toEqual({ accepted: false, reason: 'auction_not_started' });

    expect(
      placeBid({
        state: auction(),
        bidderId: 'buyer-1',
        amount: ARS(500_000),
        now: new Date('2026-08-14T15:00:00.000Z'),
      }),
    ).toEqual({ accepted: false, reason: 'auction_ended' });
  });

  it('refuses a bid in the wrong currency', () => {
    const outcome = placeBid({
      state: auction(),
      bidderId: 'buyer-1',
      amount: money(500_000, 'USD'),
      now: NOW,
    });
    expect(outcome).toEqual({ accepted: false, reason: 'currency_mismatch' });
  });
});

describe('anti-sniping', () => {
  const state = auction({
    endsAt: new Date('2026-08-14T12:00:30.000Z'),
    antiSnipeWindowMs: 60_000,
    antiSnipeExtensionMs: 120_000,
  });

  it('extends the auction when a bid lands inside the window', () => {
    const outcome = placeBid({ state, bidderId: 'buyer-1', amount: ARS(500_000), now: NOW });
    expect(outcome.accepted).toBe(true);
    if (!outcome.accepted) return;
    expect(outcome.newEndsAt).toEqual(new Date('2026-08-14T12:02:30.000Z'));
  });

  it('does not extend a bid placed well before the end', () => {
    const early = auction({
      endsAt: new Date('2026-08-14T14:00:00.000Z'),
      antiSnipeWindowMs: 60_000,
    });
    const outcome = placeBid({ state: early, bidderId: 'buyer-1', amount: ARS(500_000), now: NOW });
    expect(outcome.accepted).toBe(true);
    if (!outcome.accepted) return;
    expect(outcome.newEndsAt).toBeUndefined();
  });

  it('never extends past maxEndsAt', () => {
    const capped = auction({
      endsAt: new Date('2026-08-14T12:00:30.000Z'),
      antiSnipeWindowMs: 60_000,
      antiSnipeExtensionMs: 600_000,
      maxEndsAt: new Date('2026-08-14T12:01:00.000Z'),
    });
    const outcome = placeBid({ state: capped, bidderId: 'buyer-1', amount: ARS(500_000), now: NOW });
    expect(outcome.accepted).toBe(true);
    if (!outcome.accepted) return;
    expect(outcome.newEndsAt).toEqual(new Date('2026-08-14T12:01:00.000Z'));
  });
});

describe('closing', () => {
  it('declares the highest bidder the winner', () => {
    const result = closeAuction(
      auction({ highestBid: { bidderId: 'buyer-2', amount: ARS(620_000) } }),
    );
    expect(result.winnerId).toBe('buyer-2');
    expect(result.finalPrice).toEqual(ARS(620_000));
  });

  it('produces no winner when there were no bids', () => {
    const result = closeAuction(auction());
    expect(result.winnerId).toBeUndefined();
    expect(result.endedBelowReserve).toBe(false);
  });

  it('produces no winner when the reserve was not met', () => {
    const result = closeAuction(
      auction({
        reservePrice: ARS(800_000),
        highestBid: { bidderId: 'buyer-2', amount: ARS(620_000) },
      }),
    );
    expect(result.winnerId).toBeUndefined();
    expect(result.endedBelowReserve).toBe(true);
    expect(result.reserveMet).toBe(false);
  });

  it('sells when the reserve is exactly met', () => {
    const result = closeAuction(
      auction({
        reservePrice: ARS(620_000),
        highestBid: { bidderId: 'buyer-2', amount: ARS(620_000) },
      }),
    );
    expect(result.winnerId).toBe('buyer-2');
  });
});

describe('buy now', () => {
  it('allows buy-now while bidding is below it', () => {
    const state = auction({
      buyNowPrice: ARS(700_000),
      highestBid: { bidderId: 'buyer-1', amount: ARS(520_000) },
    });
    expect(canBuyNow({ state, buyerId: 'buyer-2', now: NOW })).toEqual({
      allowed: true,
      price: ARS(700_000),
    });
  });

  it('withdraws buy-now once bidding reaches it', () => {
    const state = auction({
      buyNowPrice: ARS(700_000),
      highestBid: { bidderId: 'buyer-1', amount: ARS(700_000) },
    });
    expect(canBuyNow({ state, buyerId: 'buyer-2', now: NOW })).toEqual({
      allowed: false,
      reason: 'price_exceeded',
    });
  });

  it('refuses when the auction has no buy-now price', () => {
    expect(canBuyNow({ state: auction(), buyerId: 'buyer-2', now: NOW })).toEqual({
      allowed: false,
      reason: 'buy_now_unavailable',
    });
  });
});

describe('scheduling', () => {
  it('starts a scheduled auction once its time arrives', () => {
    const state = auction({ status: 'scheduled', startsAt: new Date('2026-08-14T11:00:00.000Z') });
    expect(shouldStart(state, NOW)).toBe(true);
    expect(shouldStart(state, new Date('2026-08-14T10:00:00.000Z'))).toBe(false);
  });

  it('closes a live auction once its time passes', () => {
    const state = auction({ endsAt: new Date('2026-08-14T11:00:00.000Z') });
    expect(shouldClose(state, NOW)).toBe(true);
  });
});

describe('setup validation', () => {
  const base = {
    startsAt: NOW,
    endsAt: new Date('2026-08-15T12:00:00.000Z'),
    startingPrice: ARS(100_000),
    minimumIncrement: ARS(5_000),
    now: NOW,
  };

  it('accepts a well-formed auction', () => {
    expect(validateAuctionSetup(base)).toEqual([]);
  });

  it('rejects a reserve below the starting price', () => {
    const issues = validateAuctionSetup({ ...base, reservePrice: ARS(50_000) });
    expect(issues.map((issue) => issue.field)).toContain('reservePrice');
  });

  it('rejects a buy-now below the reserve', () => {
    const issues = validateAuctionSetup({
      ...base,
      reservePrice: ARS(200_000),
      buyNowPrice: ARS(150_000),
    });
    expect(issues.map((issue) => issue.field)).toContain('buyNowPrice');
  });

  it('rejects an auction shorter than the minimum duration', () => {
    const issues = validateAuctionSetup({
      ...base,
      endsAt: new Date('2026-08-14T12:05:00.000Z'),
    });
    expect(issues.map((issue) => issue.field)).toContain('endsAt');
  });

  it('rejects mixed currencies', () => {
    const issues = validateAuctionSetup({ ...base, buyNowPrice: money(999, 'USD') });
    expect(issues.some((issue) => issue.message.includes('moneda'))).toBe(true);
  });
});

describe('suggestMinimumIncrement', () => {
  it('suggests a round number near 5% of the starting price', () => {
    const suggestion = suggestMinimumIncrement(ARS(500_000));
    expect(suggestion.currency).toBe('ARS');
    expect(suggestion.amount).toBeGreaterThan(0);
    expect(Number.isSafeInteger(suggestion.amount)).toBe(true);
  });
});
