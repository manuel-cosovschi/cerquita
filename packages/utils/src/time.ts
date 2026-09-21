/**
 * Time helpers.
 *
 * Everything is stored and transported in UTC (spec §98). Only the presentation
 * layer converts to the viewer's timezone. Auctions, offers and reservations all
 * depend on this being consistent, so the helpers below never read the machine
 * clock implicitly — callers pass `now`.
 */

export const SECOND_MS = 1000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

export interface CountdownParts {
  readonly totalMs: number;
  readonly days: number;
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
  readonly expired: boolean;
}

export function countdown(target: Date, now: Date): CountdownParts {
  const totalMs = Math.max(0, target.getTime() - now.getTime());
  return {
    totalMs,
    days: Math.floor(totalMs / DAY_MS),
    hours: Math.floor((totalMs % DAY_MS) / HOUR_MS),
    minutes: Math.floor((totalMs % HOUR_MS) / MINUTE_MS),
    seconds: Math.floor((totalMs % MINUTE_MS) / SECOND_MS),
    expired: totalMs <= 0,
  };
}

const pad = (value: number): string => String(value).padStart(2, '0');

/**
 * Countdown label for auction timers and offer expiries.
 * Under a day: `04:32` (mm:ss) or `01:48:21` (hh:mm:ss). Over a day: `2d 04h`.
 */
export function formatCountdown(parts: CountdownParts): string {
  if (parts.expired) return '00:00';
  if (parts.days > 0) return `${parts.days}d ${pad(parts.hours)}h`;
  if (parts.hours > 0) return `${pad(parts.hours)}:${pad(parts.minutes)}:${pad(parts.seconds)}`;
  return `${pad(parts.minutes)}:${pad(parts.seconds)}`;
}

/** Relative label for feed rows: "hace 5 min", "hace 2 h", "hace 3 d". */
export function formatRelativeTime(date: Date, now: Date, locale = 'es-AR'): string {
  const deltaMs = date.getTime() - now.getTime();
  const absMs = Math.abs(deltaMs);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'narrow' });

  if (absMs < MINUTE_MS) return formatter.format(Math.round(deltaMs / SECOND_MS), 'second');
  if (absMs < HOUR_MS) return formatter.format(Math.round(deltaMs / MINUTE_MS), 'minute');
  if (absMs < DAY_MS) return formatter.format(Math.round(deltaMs / HOUR_MS), 'hour');
  if (absMs < 30 * DAY_MS) return formatter.format(Math.round(deltaMs / DAY_MS), 'day');
  return formatter.format(Math.round(deltaMs / (30 * DAY_MS)), 'month');
}

export function addMs(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms);
}

export function addMinutes(date: Date, minutes: number): Date {
  return addMs(date, minutes * MINUTE_MS);
}

export function isPast(date: Date, now: Date): boolean {
  return date.getTime() <= now.getTime();
}

export function isFuture(date: Date, now: Date): boolean {
  return date.getTime() > now.getTime();
}

/** Clamps a date into a range. Used to bound auction extensions. */
export function clampDate(value: Date, low: Date, high: Date): Date {
  if (value.getTime() < low.getTime()) return low;
  if (value.getTime() > high.getTime()) return high;
  return value;
}
