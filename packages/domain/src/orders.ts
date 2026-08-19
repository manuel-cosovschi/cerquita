/**
 * Order totals and lifecycle (spec §41, §42).
 *
 * Totals are computed here and nowhere else. The checkout endpoint calls
 * `computeOrderTotals` with server-resolved prices; the number the client showed
 * is only ever used to detect a change and re-confirm, never as an input.
 */

import type { DeliveryMethod, OrderStatus, UUID } from '@cerquita/types';
import {
  add,
  money,
  multiply,
  percentOf,
  subtract,
  sum,
  zero,
  type Currency,
  type Money,
} from '@cerquita/utils';

export interface OrderLineInput {
  readonly listingId: UUID;
  readonly variantId?: UUID;
  readonly quantity: number;
  /** List price per unit, before any discount. */
  readonly unitListPrice: Money;
  /** Server-resolved price per unit, after social pricing and promotions. */
  readonly unitEffectivePrice: Money;
}

export interface OrderLineTotals extends OrderLineInput {
  readonly lineListTotal: Money;
  readonly lineTotal: Money;
  readonly lineDiscount: Money;
}

export interface OrderTotals {
  readonly currency: Currency;
  readonly lines: OrderLineTotals[];
  /** Sum of line totals at list price. */
  readonly listSubtotal: Money;
  /** Sum of line totals after per-line discounts. */
  readonly subtotal: Money;
  readonly discountTotal: Money;
  readonly shippingTotal: Money;
  /** Marketplace commission, charged to the seller out of the settlement. */
  readonly platformFee: Money;
  /** What the buyer pays. */
  readonly total: Money;
  /** What the seller receives once settled. */
  readonly sellerPayout: Money;
}

export class OrderTotalsError extends Error {}

export interface ComputeOrderTotalsInput {
  readonly lines: readonly OrderLineInput[];
  readonly currency: Currency;
  readonly shipping?: Money;
  /** Order-level coupon, applied after line discounts. In basis points. */
  readonly couponBasisPoints?: number;
  /** Marketplace commission rate in basis points (configurable, spec §78). */
  readonly platformFeeBasisPoints: number;
}

export function computeOrderTotals(input: ComputeOrderTotalsInput): OrderTotals {
  if (input.lines.length === 0) {
    throw new OrderTotalsError('An order needs at least one line');
  }

  const { currency } = input;

  const lines: OrderLineTotals[] = input.lines.map((line) => {
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
      throw new OrderTotalsError(`Invalid quantity ${line.quantity} for listing ${line.listingId}`);
    }
    if (line.unitEffectivePrice.currency !== currency || line.unitListPrice.currency !== currency) {
      throw new OrderTotalsError('All order lines must share the order currency');
    }
    if (line.unitEffectivePrice.amount < 0) {
      throw new OrderTotalsError('Unit price cannot be negative');
    }

    const lineListTotal = multiply(line.unitListPrice, line.quantity);
    const lineTotal = multiply(line.unitEffectivePrice, line.quantity);
    return {
      ...line,
      lineListTotal,
      lineTotal,
      lineDiscount: subtract(lineListTotal, lineTotal),
    };
  });

  const listSubtotal = sum(
    lines.map((line) => line.lineListTotal),
    currency,
  );
  const lineSubtotal = sum(
    lines.map((line) => line.lineTotal),
    currency,
  );

  const couponBps = clampBasisPoints(input.couponBasisPoints ?? 0);
  const couponDiscount = percentOf(lineSubtotal, couponBps);
  const subtotal = subtract(lineSubtotal, couponDiscount);

  const shippingTotal = input.shipping ?? zero(currency);
  if (shippingTotal.currency !== currency) {
    throw new OrderTotalsError('Shipping must use the order currency');
  }

  const total = add(subtotal, shippingTotal);

  // The commission is charged on goods only, never on the shipping the seller
  // has to pay out to a carrier.
  const platformFee = percentOf(subtotal, clampBasisPoints(input.platformFeeBasisPoints));
  const sellerPayout = subtract(total, platformFee);

  return {
    currency,
    lines,
    listSubtotal,
    subtotal,
    discountTotal: add(subtract(listSubtotal, lineSubtotal), couponDiscount),
    shippingTotal,
    platformFee,
    total,
    sellerPayout,
  };
}

function clampBasisPoints(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(10_000, Math.max(0, Math.round(value)));
}

/**
 * Order lifecycle.
 *
 * C2C flows skip the fulfilment middle: a meetup order goes
 * `paid -> completed` once both parties confirm, while a shipped order walks the
 * full path. Both are expressed in the same table (spec §42).
 */
const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending_payment: ['paid', 'cancelled'],
  paid: [
    'preparing',
    'ready_for_pickup',
    'shipped',
    'completed',
    'cancelled',
    'refunded',
    'disputed',
  ],
  preparing: ['ready_for_pickup', 'shipped', 'cancelled', 'disputed'],
  ready_for_pickup: ['completed', 'delivered', 'cancelled', 'disputed'],
  shipped: ['delivered', 'disputed', 'refunded'],
  delivered: ['completed', 'disputed', 'refunded'],
  completed: ['disputed', 'refunded'],
  cancelled: [],
  refunded: [],
  disputed: ['completed', 'refunded', 'cancelled'],
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return (ORDER_TRANSITIONS[from] ?? []).includes(to);
}

export function assertOrderTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransitionOrder(from, to)) {
    throw new OrderTotalsError(`Illegal order transition ${from} -> ${to}`);
  }
}

/** Statuses after which the money has moved and a review becomes possible. */
export function isSettled(status: OrderStatus): boolean {
  return status === 'completed' || status === 'delivered';
}

export function isCancellable(status: OrderStatus): boolean {
  return canTransitionOrder(status, 'cancelled');
}

/**
 * Which delivery methods are valid for a given seller setup. A private seller
 * has no store delivery fleet, so that option is not offered.
 */
export function availableDeliveryMethods(input: {
  sellerOffers: readonly DeliveryMethod[];
  isStore: boolean;
}): DeliveryMethod[] {
  return input.sellerOffers.filter((method) =>
    method === 'store_delivery' ? input.isStore : true,
  );
}

/** A short, human-quotable order reference, e.g. `CQ-7F3K2A`. */
export function buildOrderReference(seed: string): string {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  let out = '';
  for (let index = 0; index < 6; index += 1) {
    out += alphabet[hash % alphabet.length];
    hash = Math.floor(hash / alphabet.length) + 7919;
  }
  return `CQ-${out}`;
}

/** Refund amount for a full refund, including shipping but excluding the fee. */
export function fullRefundAmount(totals: OrderTotals): Money {
  return totals.total;
}

/** Partial refund, clamped so it can never exceed what was charged. */
export function partialRefundAmount(totals: OrderTotals, requested: Money): Money {
  if (requested.currency !== totals.currency) {
    throw new OrderTotalsError('Refund currency must match the order');
  }
  if (requested.amount < 0) throw new OrderTotalsError('Refund cannot be negative');
  return money(Math.min(requested.amount, totals.total.amount), totals.currency);
}
