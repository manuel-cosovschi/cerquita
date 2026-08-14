/**
 * Stock and reservations (spec §26, §83).
 *
 * The invariant: `availableQuantity = quantity - reservedQuantity - soldQuantity`
 * and it can never go negative. The API enforces this with a conditional UPDATE
 * inside a transaction (`UPDATE ... WHERE available >= :n`), so two simultaneous
 * buyers of the last unit serialize and exactly one succeeds. The functions here
 * decide *whether* an operation is legal; the database guarantees that only one
 * caller wins the race.
 */

import type { ReservationStatus, UUID } from '@cerquita/types';
import { isPast, MINUTE_MS } from '@cerquita/utils';

export interface StockState {
  readonly quantity: number;
  readonly reservedQuantity: number;
  readonly soldQuantity: number;
}

export function availableQuantity(stock: StockState): number {
  return Math.max(0, stock.quantity - stock.reservedQuantity - stock.soldQuantity);
}

export function isInStock(stock: StockState, requested = 1): boolean {
  return availableQuantity(stock) >= requested;
}

export type StockRejectionReason = 'insufficient_stock' | 'invalid_quantity';

export type StockOutcome =
  | { readonly ok: true; readonly remaining: number }
  | { readonly ok: false; readonly reason: StockRejectionReason };

/** Checks a reservation or purchase against current stock. */
export function canTake(stock: StockState, requested: number): StockOutcome {
  if (!Number.isSafeInteger(requested) || requested <= 0) {
    return { ok: false, reason: 'invalid_quantity' };
  }
  const available = availableQuantity(stock);
  if (available < requested) return { ok: false, reason: 'insufficient_stock' };
  return { ok: true, remaining: available - requested };
}

export const DEFAULT_RESERVATION_MINUTES = 30;
export const MIN_RESERVATION_MINUTES = 5;
export const MAX_RESERVATION_MINUTES = 24 * 60;

export interface ReservationState {
  readonly id: UUID;
  readonly listingId: UUID;
  readonly variantId?: UUID;
  readonly buyerId: UUID;
  readonly quantity: number;
  readonly status: ReservationStatus;
  readonly expiresAt: Date;
}

const RESERVATION_TRANSITIONS: Record<ReservationStatus, readonly ReservationStatus[]> = {
  active: ['consumed', 'released', 'expired'],
  consumed: [],
  released: [],
  expired: [],
};

export function canTransitionReservation(
  from: ReservationStatus,
  to: ReservationStatus,
): boolean {
  return (RESERVATION_TRANSITIONS[from] ?? []).includes(to);
}

export function isReservationHeld(reservation: ReservationState, now: Date): boolean {
  return reservation.status === 'active' && !isPast(reservation.expiresAt, now);
}

/** Clamps a seller-configured hold duration into the allowed range. */
export function reservationExpiry(now: Date, minutes = DEFAULT_RESERVATION_MINUTES): Date {
  const clamped = Math.min(MAX_RESERVATION_MINUTES, Math.max(MIN_RESERVATION_MINUTES, minutes));
  return new Date(now.getTime() + clamped * MINUTE_MS);
}

/** Reservations the sweeper job should release back into stock. */
export function selectExpiredReservations(
  reservations: readonly ReservationState[],
  now: Date,
): readonly ReservationState[] {
  return reservations.filter(
    (reservation) => reservation.status === 'active' && isPast(reservation.expiresAt, now),
  );
}

/**
 * Whether a buyer may check out against a reservation they hold. Guards the case
 * where a reservation expired between opening checkout and paying.
 */
export function canConsumeReservation(
  reservation: ReservationState,
  buyerId: UUID,
  now: Date,
): boolean {
  return reservation.buyerId === buyerId && isReservationHeld(reservation, now);
}
