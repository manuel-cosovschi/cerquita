import { describe, expect, it } from 'vitest';
import {
  availableQuantity,
  canConsumeReservation,
  canTake,
  isReservationHeld,
  reservationExpiry,
  selectExpiredReservations,
  type ReservationState,
  type StockState,
} from './inventory.js';

const NOW = new Date('2026-08-14T12:00:00.000Z');

describe('stock accounting', () => {
  it('subtracts reserved and sold units from availability', () => {
    const stock: StockState = { quantity: 10, reservedQuantity: 3, soldQuantity: 2 };
    expect(availableQuantity(stock)).toBe(5);
  });

  it('never reports negative availability', () => {
    const stock: StockState = { quantity: 1, reservedQuantity: 5, soldQuantity: 3 };
    expect(availableQuantity(stock)).toBe(0);
  });
});

describe('taking stock (spec §91)', () => {
  /**
   * Two buyers race for the last unit. In the API these run as conditional
   * UPDATEs inside transactions, so they serialize; the second sees the state the
   * first produced. Exactly one may succeed.
   */
  it('lets only one of two buyers take the last unit', () => {
    const before: StockState = { quantity: 1, reservedQuantity: 0, soldQuantity: 0 };

    const first = canTake(before, 1);
    expect(first).toEqual({ ok: true, remaining: 0 });

    const afterFirst: StockState = { quantity: 1, reservedQuantity: 0, soldQuantity: 1 };
    const second = canTake(afterFirst, 1);
    expect(second).toEqual({ ok: false, reason: 'insufficient_stock' });
  });

  it('refuses to oversell', () => {
    const stock: StockState = { quantity: 3, reservedQuantity: 1, soldQuantity: 0 };
    expect(canTake(stock, 2)).toEqual({ ok: true, remaining: 0 });
    expect(canTake(stock, 3)).toEqual({ ok: false, reason: 'insufficient_stock' });
  });

  it('rejects non-positive and fractional quantities', () => {
    const stock: StockState = { quantity: 5, reservedQuantity: 0, soldQuantity: 0 };
    expect(canTake(stock, 0)).toEqual({ ok: false, reason: 'invalid_quantity' });
    expect(canTake(stock, -1)).toEqual({ ok: false, reason: 'invalid_quantity' });
    expect(canTake(stock, 1.5)).toEqual({ ok: false, reason: 'invalid_quantity' });
  });
});

describe('reservations', () => {
  function reservation(overrides: Partial<ReservationState> = {}): ReservationState {
    return {
      id: 'res-1',
      listingId: 'listing-1',
      buyerId: 'buyer-1',
      quantity: 1,
      status: 'active',
      expiresAt: new Date('2026-08-14T12:30:00.000Z'),
      ...overrides,
    };
  }

  it('holds an active, unexpired reservation', () => {
    expect(isReservationHeld(reservation(), NOW)).toBe(true);
  });

  it('does not hold once expired', () => {
    expect(isReservationHeld(reservation(), new Date('2026-08-14T13:00:00.000Z'))).toBe(false);
  });

  it('does not hold once released', () => {
    expect(isReservationHeld(reservation({ status: 'released' }), NOW)).toBe(false);
  });

  it('only lets the holder consume it', () => {
    expect(canConsumeReservation(reservation(), 'buyer-1', NOW)).toBe(true);
    expect(canConsumeReservation(reservation(), 'buyer-2', NOW)).toBe(false);
  });

  it('refuses to consume a reservation that expired during checkout', () => {
    const late = new Date('2026-08-14T12:31:00.000Z');
    expect(canConsumeReservation(reservation(), 'buyer-1', late)).toBe(false);
  });

  it('clamps the hold duration into the allowed range', () => {
    expect(reservationExpiry(NOW, 1).getTime() - NOW.getTime()).toBe(5 * 60_000);
    expect(reservationExpiry(NOW, 99_999).getTime() - NOW.getTime()).toBe(24 * 60 * 60_000);
    expect(reservationExpiry(NOW).getTime() - NOW.getTime()).toBe(30 * 60_000);
  });

  it('selects only active, expired reservations for the sweeper', () => {
    const later = new Date('2026-08-14T13:00:00.000Z');
    const expired = selectExpiredReservations(
      [
        reservation({ id: 'a' }),
        reservation({ id: 'b', status: 'consumed' }),
        reservation({ id: 'c', expiresAt: new Date('2026-08-14T14:00:00.000Z') }),
      ],
      later,
    );
    expect(expired.map((item) => item.id)).toEqual(['a']);
  });
});
