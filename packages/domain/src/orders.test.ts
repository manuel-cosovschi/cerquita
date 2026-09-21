import { describe, expect, it } from 'vitest';
import { money, zero } from '@cerquita/utils';
import {
  buildOrderReference,
  canTransitionOrder,
  computeOrderTotals,
  OrderTotalsError,
  partialRefundAmount,
} from './orders.js';

const ARS = (major: number) => money(major * 100, 'ARS');

describe('order totals', () => {
  it('multiplies quantity and sums lines', () => {
    const totals = computeOrderTotals({
      currency: 'ARS',
      platformFeeBasisPoints: 0,
      lines: [
        {
          listingId: 'a',
          quantity: 2,
          unitListPrice: ARS(10_000),
          unitEffectivePrice: ARS(10_000),
        },
        {
          listingId: 'b',
          quantity: 1,
          unitListPrice: ARS(5_000),
          unitEffectivePrice: ARS(5_000),
        },
      ],
    });

    expect(totals.subtotal).toEqual(ARS(25_000));
    expect(totals.total).toEqual(ARS(25_000));
    expect(totals.discountTotal).toEqual(zero('ARS'));
  });

  it('records the discount between list and effective prices', () => {
    const totals = computeOrderTotals({
      currency: 'ARS',
      platformFeeBasisPoints: 0,
      lines: [
        {
          listingId: 'a',
          quantity: 2,
          unitListPrice: ARS(100_000),
          unitEffectivePrice: ARS(85_000),
        },
      ],
    });

    expect(totals.listSubtotal).toEqual(ARS(200_000));
    expect(totals.subtotal).toEqual(ARS(170_000));
    expect(totals.discountTotal).toEqual(ARS(30_000));
  });

  it('applies an order-level coupon after line discounts', () => {
    const totals = computeOrderTotals({
      currency: 'ARS',
      platformFeeBasisPoints: 0,
      couponBasisPoints: 1000,
      lines: [
        {
          listingId: 'a',
          quantity: 1,
          unitListPrice: ARS(100_000),
          unitEffectivePrice: ARS(90_000),
        },
      ],
    });

    // 90.000 less 10% = 81.000. Total discount vs list = 19.000.
    expect(totals.subtotal).toEqual(ARS(81_000));
    expect(totals.discountTotal).toEqual(ARS(19_000));
  });

  it('adds shipping to the buyer total but not to the commission base', () => {
    const totals = computeOrderTotals({
      currency: 'ARS',
      platformFeeBasisPoints: 1000,
      shipping: ARS(5_000),
      lines: [
        {
          listingId: 'a',
          quantity: 1,
          unitListPrice: ARS(100_000),
          unitEffectivePrice: ARS(100_000),
        },
      ],
    });

    expect(totals.total).toEqual(ARS(105_000));
    // 10% of goods only.
    expect(totals.platformFee).toEqual(ARS(10_000));
    expect(totals.sellerPayout).toEqual(ARS(95_000));
  });

  it('keeps every total an exact integer of minor units', () => {
    const totals = computeOrderTotals({
      currency: 'ARS',
      platformFeeBasisPoints: 333,
      lines: [
        {
          listingId: 'a',
          quantity: 3,
          unitListPrice: money(33_333, 'ARS'),
          unitEffectivePrice: money(33_333, 'ARS'),
        },
      ],
    });

    for (const value of [totals.subtotal, totals.total, totals.platformFee, totals.sellerPayout]) {
      expect(Number.isSafeInteger(value.amount)).toBe(true);
    }
    // Payout plus commission must reconstruct the total exactly — no lost centavo.
    expect(totals.sellerPayout.amount + totals.platformFee.amount).toBe(totals.total.amount);
  });

  it('rejects mixed currencies', () => {
    expect(() =>
      computeOrderTotals({
        currency: 'ARS',
        platformFeeBasisPoints: 0,
        lines: [
          {
            listingId: 'a',
            quantity: 1,
            unitListPrice: money(100, 'USD'),
            unitEffectivePrice: money(100, 'USD'),
          },
        ],
      }),
    ).toThrow(OrderTotalsError);
  });

  it('rejects an empty order and invalid quantities', () => {
    expect(() =>
      computeOrderTotals({ currency: 'ARS', platformFeeBasisPoints: 0, lines: [] }),
    ).toThrow(OrderTotalsError);

    expect(() =>
      computeOrderTotals({
        currency: 'ARS',
        platformFeeBasisPoints: 0,
        lines: [
          {
            listingId: 'a',
            quantity: 0,
            unitListPrice: ARS(1),
            unitEffectivePrice: ARS(1),
          },
        ],
      }),
    ).toThrow(OrderTotalsError);
  });
});

describe('order lifecycle', () => {
  it('allows a C2C meetup order to go straight from paid to completed', () => {
    expect(canTransitionOrder('paid', 'completed')).toBe(true);
  });

  it('allows the full shipped path', () => {
    expect(canTransitionOrder('paid', 'preparing')).toBe(true);
    expect(canTransitionOrder('preparing', 'shipped')).toBe(true);
    expect(canTransitionOrder('shipped', 'delivered')).toBe(true);
    expect(canTransitionOrder('delivered', 'completed')).toBe(true);
  });

  it('refuses to move backwards or out of a terminal state', () => {
    expect(canTransitionOrder('delivered', 'paid')).toBe(false);
    expect(canTransitionOrder('cancelled', 'paid')).toBe(false);
    expect(canTransitionOrder('refunded', 'completed')).toBe(false);
  });

  it('refuses to cancel an order that already shipped', () => {
    expect(canTransitionOrder('shipped', 'cancelled')).toBe(false);
  });
});

describe('refunds', () => {
  const totals = computeOrderTotals({
    currency: 'ARS',
    platformFeeBasisPoints: 500,
    lines: [
      {
        listingId: 'a',
        quantity: 1,
        unitListPrice: ARS(100_000),
        unitEffectivePrice: ARS(100_000),
      },
    ],
  });

  it('clamps a partial refund to the amount actually charged', () => {
    expect(partialRefundAmount(totals, ARS(500_000))).toEqual(totals.total);
    expect(partialRefundAmount(totals, ARS(20_000))).toEqual(ARS(20_000));
  });

  it('refuses a negative refund', () => {
    expect(() => partialRefundAmount(totals, money(-1, 'ARS'))).toThrow(OrderTotalsError);
  });
});

describe('order reference', () => {
  it('is stable for a given seed and looks quotable', () => {
    const first = buildOrderReference('order-123');
    expect(first).toBe(buildOrderReference('order-123'));
    expect(first).toMatch(/^CQ-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
  });
});
