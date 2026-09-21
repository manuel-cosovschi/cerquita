/**
 * Money.
 *
 * Amounts are integers in the currency's MINOR unit (centavos for ARS, cents for
 * USD). Floating point never touches a monetary value — spec §97.
 *
 * The representable range is ±2^53-1 minor units, i.e. about ±90 trillion ARS.
 * Every constructor and operator guards the invariant rather than trusting
 * callers, because these values come off the wire.
 */

export const SUPPORTED_CURRENCIES = ['ARS', 'USD', 'EUR', 'BRL', 'UYU', 'CLP'] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

/** Minor units per major unit. CLP has no minor unit in practice. */
const MINOR_UNIT_EXPONENT: Record<Currency, number> = {
  ARS: 2,
  USD: 2,
  EUR: 2,
  BRL: 2,
  UYU: 2,
  CLP: 0,
};

export interface Money {
  /** Integer count of minor units. May be negative (refunds, adjustments). */
  readonly amount: number;
  readonly currency: Currency;
}

export class MoneyError extends Error {}

export function isCurrency(value: unknown): value is Currency {
  return typeof value === 'string' && (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

export function money(amount: number, currency: Currency): Money {
  if (!Number.isSafeInteger(amount)) {
    throw new MoneyError(
      `Monetary amounts must be safe integers in minor units, received ${amount}`,
    );
  }
  if (!isCurrency(currency)) {
    throw new MoneyError(`Unsupported currency ${String(currency)}`);
  }
  return { amount, currency };
}

export function zero(currency: Currency): Money {
  return { amount: 0, currency };
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new MoneyError(`Cannot combine ${a.currency} with ${b.currency}`);
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount + b.amount, a.currency);
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount - b.amount, a.currency);
}

export function sum(values: readonly Money[], currency: Currency): Money {
  return values.reduce<Money>((acc, value) => add(acc, value), zero(currency));
}

/** Multiply by an integer quantity. Quantities are counts, never fractions. */
export function multiply(value: Money, quantity: number): Money {
  if (!Number.isSafeInteger(quantity)) {
    throw new MoneyError(`Quantity must be an integer, received ${quantity}`);
  }
  return money(value.amount * quantity, value.currency);
}

export type RoundingMode = 'half-up' | 'half-even' | 'floor' | 'ceil';

/**
 * Rounds a rational amount to whole minor units.
 *
 * `half-up` is the default because it matches how Argentine invoices round and
 * how users expect a displayed discount to resolve.
 */
function roundToInteger(value: number, mode: RoundingMode): number {
  switch (mode) {
    case 'floor':
      return Math.floor(value);
    case 'ceil':
      return Math.ceil(value);
    case 'half-even': {
      const floor = Math.floor(value);
      const diff = value - floor;
      if (diff > 0.5) return floor + 1;
      if (diff < 0.5) return floor;
      return floor % 2 === 0 ? floor : floor + 1;
    }
    case 'half-up':
    default:
      return Math.sign(value) * Math.round(Math.abs(value));
  }
}

/**
 * Applies a percentage expressed in BASIS POINTS (1% = 100 bps).
 *
 * Percentages are stored as integers everywhere in Cerquita so a "15% friend
 * discount" is `1500`, never `0.15`. This keeps discount math exact.
 */
export function percentOf(
  value: Money,
  basisPoints: number,
  mode: RoundingMode = 'half-up',
): Money {
  if (!Number.isSafeInteger(basisPoints)) {
    throw new MoneyError(`Basis points must be an integer, received ${basisPoints}`);
  }
  const raw = (value.amount * basisPoints) / 10_000;
  return money(roundToInteger(raw, mode), value.currency);
}

/** Reduces `value` by `basisPoints` percent. Never returns a negative amount. */
export function applyDiscount(
  value: Money,
  basisPoints: number,
  mode: RoundingMode = 'half-up',
): Money {
  if (basisPoints < 0) throw new MoneyError('Discount basis points cannot be negative');
  if (basisPoints > 10_000) throw new MoneyError('Discount cannot exceed 100%');
  const discount = percentOf(value, basisPoints, mode);
  return money(Math.max(0, value.amount - discount.amount), value.currency);
}

export function compare(a: Money, b: Money): number {
  assertSameCurrency(a, b);
  return a.amount === b.amount ? 0 : a.amount < b.amount ? -1 : 1;
}

export const isGreaterThan = (a: Money, b: Money): boolean => compare(a, b) > 0;
export const isLessThan = (a: Money, b: Money): boolean => compare(a, b) < 0;
export const isEqual = (a: Money, b: Money): boolean => compare(a, b) === 0;
export const isZero = (value: Money): boolean => value.amount === 0;
export const isNegative = (value: Money): boolean => value.amount < 0;

export function max(a: Money, b: Money): Money {
  return isGreaterThan(a, b) ? a : b;
}

export function min(a: Money, b: Money): Money {
  return isLessThan(a, b) ? a : b;
}

/**
 * Splits an amount into `parts` as evenly as possible, distributing the
 * remainder one minor unit at a time so the parts always sum back to the whole.
 * Used by settlement and multi-item proportional discounts.
 */
export function allocate(value: Money, parts: number): Money[] {
  if (!Number.isSafeInteger(parts) || parts <= 0) {
    throw new MoneyError(`Cannot allocate into ${parts} parts`);
  }
  const base = Math.trunc(value.amount / parts);
  let remainder = value.amount - base * parts;
  const step = remainder >= 0 ? 1 : -1;
  return Array.from({ length: parts }, () => {
    let share = base;
    if (remainder !== 0) {
      share += step;
      remainder -= step;
    }
    return money(share, value.currency);
  });
}

/** Allocates proportionally to integer weights, preserving the total exactly. */
export function allocateByWeights(value: Money, weights: readonly number[]): Money[] {
  const total = weights.reduce((acc, weight) => acc + weight, 0);
  if (total <= 0) throw new MoneyError('Allocation weights must sum to a positive number');

  const shares: number[] = [];
  let distributed = 0;
  for (const weight of weights) {
    const share = Math.trunc((value.amount * weight) / total);
    shares.push(share);
    distributed += share;
  }

  // Hand out the rounding remainder to the largest weights first.
  let remainder = value.amount - distributed;
  const order = weights
    .map((weight, index) => ({ weight, index }))
    .sort((a, b) => b.weight - a.weight);
  let cursor = 0;
  const step = remainder >= 0 ? 1 : -1;
  while (remainder !== 0 && order.length > 0) {
    const target = order[cursor % order.length];
    if (target) {
      shares[target.index] = (shares[target.index] ?? 0) + step;
      remainder -= step;
    }
    cursor += 1;
  }

  return shares.map((share) => money(share, value.currency));
}

export function minorUnitExponent(currency: Currency): number {
  return MINOR_UNIT_EXPONENT[currency];
}

/** Converts major units ("550000.50" pesos) to a Money. Parses as a decimal string. */
export function fromMajorUnits(input: string | number, currency: Currency): Money {
  const exponent = minorUnitExponent(currency);
  const text = typeof input === 'number' ? String(input) : input.trim();

  if (!/^-?\d+(\.\d+)?$/.test(text)) {
    throw new MoneyError(`Cannot parse "${text}" as a decimal amount`);
  }

  const negative = text.startsWith('-');
  const [wholePart = '0', fractionPart = ''] = text.replace('-', '').split('.');
  const paddedFraction = fractionPart.padEnd(exponent, '0');

  if (paddedFraction.length > exponent) {
    throw new MoneyError(`${currency} supports ${exponent} decimal places, received "${text}"`);
  }

  const minor = Number(`${wholePart}${paddedFraction}`);
  return money(negative ? -minor : minor, currency);
}

/** Exact decimal string of the major-unit value. Safe for display and for logs. */
export function toMajorUnitsString(value: Money): string {
  const exponent = minorUnitExponent(value.currency);
  if (exponent === 0) return String(value.amount);

  const negative = value.amount < 0;
  const digits = String(Math.abs(value.amount)).padStart(exponent + 1, '0');
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = digits.slice(digits.length - exponent);
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/**
 * Localized display string, e.g. `$ 550.000` for ARS in es-AR.
 *
 * Formatting goes through Intl so it follows the viewer's locale; the value
 * handed to Intl is derived from the exact decimal string, not from arithmetic.
 */
export function formatMoney(
  value: Money,
  locale = 'es-AR',
  options: Intl.NumberFormatOptions = {},
): string {
  const exponent = minorUnitExponent(value.currency);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: value.currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
    ...options,
  }).format(Number(toMajorUnitsString(value)));
}

/**
 * Compact display for map markers and dense cards, where "$550.000" must fit in
 * a 44px pin. Drops minor units deliberately.
 */
export function formatMoneyCompact(value: Money, locale = 'es-AR'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: value.currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(Number(toMajorUnitsString(value)));
}

/** Discount between two prices, in basis points. Used for "-15%" badges. */
export function discountBasisPoints(original: Money, discounted: Money): number {
  assertSameCurrency(original, discounted);
  if (original.amount <= 0) return 0;
  const delta = original.amount - discounted.amount;
  if (delta <= 0) return 0;
  return Math.round((delta * 10_000) / original.amount);
}
