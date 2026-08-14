import { describe, expect, it } from 'vitest';
import { money } from '@cerquita/utils';
import {
  NO_DISCOUNT_POLICY,
  priceMatchesQuote,
  resolvePrice,
  socialDiscountBasisPoints,
  tierSatisfies,
} from './pricing.js';

const NOW = new Date('2026-08-14T12:00:00.000Z');
const ARS = (major: number) => money(major * 100, 'ARS');

describe('social pricing (spec §91)', () => {
  // The exact scenario the spec calls out: 100.000 public / 95.000 follower /
  // 85.000 friend, from a -5% / -15% policy.
  const policy = { followerBasisPoints: 500, friendBasisPoints: 1500 };
  const listPrice = ARS(100_000);

  it('charges the public the list price', () => {
    const result = resolvePrice({ listPrice, tier: 'public', sellerPolicy: policy, now: NOW });
    expect(result.effective).toEqual(ARS(100_000));
    expect(result.discountBasisPoints).toBe(0);
  });

  it('charges followers 95.000', () => {
    const result = resolvePrice({ listPrice, tier: 'follower', sellerPolicy: policy, now: NOW });
    expect(result.effective).toEqual(ARS(95_000));
    expect(result.discountBasisPoints).toBe(500);
  });

  it('charges friends 85.000', () => {
    const result = resolvePrice({ listPrice, tier: 'friend', sellerPolicy: policy, now: NOW });
    expect(result.effective).toEqual(ARS(85_000));
    expect(result.discountBasisPoints).toBe(1500);
  });
});

describe('socialDiscountBasisPoints', () => {
  it('gives a friend at least the follower discount when the policy is inverted', () => {
    // A seller who sets followers -10% / friends -5% almost certainly misconfigured
    // it; a friend must never pay more than a follower.
    const bps = socialDiscountBasisPoints({
      tier: 'friend',
      sellerPolicy: { followerBasisPoints: 1000, friendBasisPoints: 500 },
    });
    expect(bps).toBe(1000);
  });

  it('falls back to the seller policy when the listing does not override', () => {
    const bps = socialDiscountBasisPoints({
      tier: 'follower',
      sellerPolicy: { followerBasisPoints: 700, friendBasisPoints: 1500 },
      listingOverride: { followerBasisPoints: null, friendBasisPoints: null },
    });
    expect(bps).toBe(700);
  });

  it('lets a listing override the seller policy, including down to zero', () => {
    const bps = socialDiscountBasisPoints({
      tier: 'follower',
      sellerPolicy: { followerBasisPoints: 700, friendBasisPoints: 1500 },
      listingOverride: { followerBasisPoints: 0, friendBasisPoints: null },
    });
    expect(bps).toBe(0);
  });

  it('treats a friend of a store owner as a follower — stores have no friends', () => {
    const bps = socialDiscountBasisPoints({
      tier: 'friend',
      sellerPolicy: { followerBasisPoints: 500, friendBasisPoints: 2000 },
      isStoreListing: true,
    });
    expect(bps).toBe(500);
  });

  it('clamps nonsense policy values into range', () => {
    expect(
      socialDiscountBasisPoints({
        tier: 'follower',
        sellerPolicy: { followerBasisPoints: 50_000, friendBasisPoints: 0 },
      }),
    ).toBe(10_000);
    expect(
      socialDiscountBasisPoints({
        tier: 'follower',
        sellerPolicy: { followerBasisPoints: -300, friendBasisPoints: 0 },
      }),
    ).toBe(0);
  });
});

describe('promotions', () => {
  const listPrice = ARS(100_000);

  it('applies a promotion when it beats the social price', () => {
    const result = resolvePrice({
      listPrice,
      tier: 'follower',
      sellerPolicy: { followerBasisPoints: 500, friendBasisPoints: 1500 },
      promotions: [
        { id: 'promo-1', label: 'Flash 30%', requiredTier: 'public', basisPoints: 3000 },
      ],
      now: NOW,
    });
    expect(result.effective).toEqual(ARS(70_000));
    expect(result.appliedPromotionId).toBe('promo-1');
  });

  it('keeps the social price when the promotion is worse', () => {
    const result = resolvePrice({
      listPrice,
      tier: 'friend',
      sellerPolicy: { followerBasisPoints: 500, friendBasisPoints: 2500 },
      promotions: [{ id: 'promo-1', label: '10%', requiredTier: 'public', basisPoints: 1000 }],
      now: NOW,
    });
    expect(result.effective).toEqual(ARS(75_000));
    expect(result.appliedPromotionId).toBeUndefined();
  });

  it('ignores a promotion the viewer does not qualify for', () => {
    const result = resolvePrice({
      listPrice,
      tier: 'public',
      promotions: [
        { id: 'promo-1', label: 'Solo amigos', requiredTier: 'friend', basisPoints: 5000 },
      ],
      now: NOW,
    });
    expect(result.effective).toEqual(listPrice);
  });

  it('ignores a promotion outside its time window', () => {
    const result = resolvePrice({
      listPrice,
      tier: 'public',
      promotions: [
        {
          id: 'promo-1',
          label: 'Ya terminó',
          requiredTier: 'public',
          basisPoints: 5000,
          endsAt: new Date('2026-08-14T11:00:00.000Z'),
        },
      ],
      now: NOW,
    });
    expect(result.effective).toEqual(listPrice);
  });

  it('stacks only when the promotion opts in', () => {
    const shared = {
      listPrice,
      tier: 'follower' as const,
      sellerPolicy: { followerBasisPoints: 1000, friendBasisPoints: 1000 },
      now: NOW,
    };

    const notStacked = resolvePrice({
      ...shared,
      promotions: [{ id: 'p', label: '10%', requiredTier: 'public' as const, basisPoints: 1000 }],
    });
    // Best of (90.000 social, 90.000 promo) — not 81.000.
    expect(notStacked.effective).toEqual(ARS(90_000));

    const stacked = resolvePrice({
      ...shared,
      promotions: [
        {
          id: 'p',
          label: '10%',
          requiredTier: 'public' as const,
          basisPoints: 1000,
          stacksWithSocialDiscount: true,
        },
      ],
    });
    expect(stacked.effective).toEqual(ARS(81_000));
  });

  it('never lets a promotion raise the price above list', () => {
    const result = resolvePrice({
      listPrice,
      tier: 'public',
      promotions: [
        { id: 'p', label: 'Precio fijo alto', requiredTier: 'public', fixedPrice: ARS(150_000) },
      ],
      now: NOW,
    });
    expect(result.effective).toEqual(listPrice);
  });

  it('ignores a promotion in a different currency', () => {
    const result = resolvePrice({
      listPrice,
      tier: 'public',
      promotions: [
        {
          id: 'p',
          label: 'USD',
          requiredTier: 'public',
          fixedPrice: money(1000, 'USD'),
        },
      ],
      now: NOW,
    });
    expect(result.effective).toEqual(listPrice);
  });
});

describe('tierSatisfies', () => {
  it('treats friend as satisfying follower-only requirements', () => {
    expect(tierSatisfies('friend', 'follower')).toBe(true);
    expect(tierSatisfies('follower', 'friend')).toBe(false);
    expect(tierSatisfies('public', 'public')).toBe(true);
  });
});

describe('priceMatchesQuote', () => {
  it('detects a tampered or stale client quote', () => {
    const authoritative = ARS(95_000);
    expect(priceMatchesQuote(authoritative, { amount: 9_500_000, currency: 'ARS' })).toBe(true);
    expect(priceMatchesQuote(authoritative, { amount: 1, currency: 'ARS' })).toBe(false);
    expect(priceMatchesQuote(authoritative, { amount: 9_500_000, currency: 'USD' })).toBe(false);
  });
});

describe('no policy configured', () => {
  it('charges everyone the list price', () => {
    for (const tier of ['public', 'follower', 'friend'] as const) {
      const result = resolvePrice({
        listPrice: ARS(50_000),
        tier,
        sellerPolicy: NO_DISCOUNT_POLICY,
        now: NOW,
      });
      expect(result.effective).toEqual(ARS(50_000));
    }
  });
});
