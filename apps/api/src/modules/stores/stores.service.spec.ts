import { describe, expect, it } from 'vitest';
import { isOpenNow } from './stores.service';

/** Minutes from midnight, store-local — the unit the schedule is stored in. */
const at = (hour: number, minute = 0): number => hour * 60 + minute;

// 2026-08-14 is a Friday (weekday 5).
const friday = (hour: number, minute = 0) => new Date(2026, 7, 14, hour, minute);

describe('isOpenNow', () => {
  const weekdays = [1, 2, 3, 4, 5].map((weekday) => ({
    weekday,
    opensAt: at(9),
    closesAt: at(18),
  }));

  it('is open inside the window', () => {
    expect(isOpenNow(weekdays, friday(12))).toBe(true);
  });

  it('is closed before opening and after closing', () => {
    expect(isOpenNow(weekdays, friday(8, 59))).toBe(false);
    expect(isOpenNow(weekdays, friday(18, 1))).toBe(false);
  });

  it('treats the closing minute as closed', () => {
    // At 18:00 sharp the shop has shut; `closesAt` is exclusive.
    expect(isOpenNow(weekdays, friday(18))).toBe(false);
    expect(isOpenNow(weekdays, friday(17, 59))).toBe(true);
  });

  it('is open exactly at the opening minute', () => {
    expect(isOpenNow(weekdays, friday(9))).toBe(true);
  });

  it('is closed on a day with no schedule', () => {
    // 2026-08-16 is a Sunday, which has no entry.
    expect(isOpenNow(weekdays, new Date(2026, 7, 16, 12))).toBe(false);
  });

  it('returns undefined when the store published no hours at all', () => {
    // "Unknown" is not "closed" — a store without a schedule should not be
    // rendered as shut.
    expect(isOpenNow([], friday(12))).toBeUndefined();
  });

  it('supports split shifts on the same day', () => {
    const siesta = [
      { weekday: 5, opensAt: at(9), closesAt: at(13) },
      { weekday: 5, opensAt: at(17), closesAt: at(21) },
    ];
    expect(isOpenNow(siesta, friday(10))).toBe(true);
    expect(isOpenNow(siesta, friday(15))).toBe(false);
    expect(isOpenNow(siesta, friday(19))).toBe(true);
  });
});
