import { describe, expect, it } from 'vitest';
import {
  allocate,
  allocateByWeights,
  applyDiscount,
  discountBasisPoints,
  formatMoney,
  fromMajorUnits,
  money,
  MoneyError,
  percentOf,
  toMajorUnitsString,
} from './money.js';

describe('money construction', () => {
  it('rejects non-integer amounts, because floats must never touch money', () => {
    expect(() => money(10.5, 'ARS')).toThrow(MoneyError);
    expect(() => money(Number.MAX_SAFE_INTEGER + 1, 'ARS')).toThrow(MoneyError);
  });

  it('rejects unknown currencies', () => {
    // @ts-expect-error deliberately passing an unsupported currency
    expect(() => money(100, 'XYZ')).toThrow(MoneyError);
  });
});

describe('major/minor conversion', () => {
  it('parses decimal strings exactly', () => {
    expect(fromMajorUnits('550000.50', 'ARS')).toEqual(money(55_000_050, 'ARS'));
    expect(fromMajorUnits('0.01', 'ARS')).toEqual(money(1, 'ARS'));
    expect(fromMajorUnits('-12.34', 'ARS')).toEqual(money(-1234, 'ARS'));
  });

  it('handles currencies with no minor unit', () => {
    expect(fromMajorUnits('1500', 'CLP')).toEqual(money(1500, 'CLP'));
    expect(toMajorUnitsString(money(1500, 'CLP'))).toBe('1500');
  });

  it('refuses more decimals than the currency has', () => {
    expect(() => fromMajorUnits('1.234', 'ARS')).toThrow(MoneyError);
  });

  it('round-trips without drift on values that break float math', () => {
    // 0.1 + 0.2 !== 0.3 in floating point; in minor units it is exact.
    const a = fromMajorUnits('0.1', 'ARS');
    const b = fromMajorUnits('0.2', 'ARS');
    expect(a.amount + b.amount).toBe(30);
    expect(toMajorUnitsString(money(30, 'ARS'))).toBe('0.30');
  });
});

describe('percentages', () => {
  it('applies basis points', () => {
    expect(percentOf(money(100_000, 'ARS'), 1500)).toEqual(money(15_000, 'ARS'));
  });

  it('rounds half up', () => {
    expect(percentOf(money(101, 'ARS'), 5000)).toEqual(money(51, 'ARS'));
  });

  it('applies discounts without going negative', () => {
    expect(applyDiscount(money(100_000, 'ARS'), 10_000)).toEqual(money(0, 'ARS'));
  });

  it('refuses discounts above 100% or below zero', () => {
    expect(() => applyDiscount(money(100, 'ARS'), 10_001)).toThrow(MoneyError);
    expect(() => applyDiscount(money(100, 'ARS'), -1)).toThrow(MoneyError);
  });

  it('computes the discount between two prices', () => {
    expect(discountBasisPoints(money(100_000, 'ARS'), money(85_000, 'ARS'))).toBe(1500);
    expect(discountBasisPoints(money(100_000, 'ARS'), money(120_000, 'ARS'))).toBe(0);
  });
});

describe('allocation', () => {
  it('splits without losing a minor unit', () => {
    const parts = allocate(money(100, 'ARS'), 3);
    expect(parts.map((part) => part.amount)).toEqual([34, 33, 33]);
    expect(parts.reduce((acc, part) => acc + part.amount, 0)).toBe(100);
  });

  it('handles negative amounts (refund splits)', () => {
    const parts = allocate(money(-100, 'ARS'), 3);
    expect(parts.reduce((acc, part) => acc + part.amount, 0)).toBe(-100);
  });

  it('allocates by weights and preserves the total', () => {
    const parts = allocateByWeights(money(1000, 'ARS'), [1, 1, 1]);
    expect(parts.reduce((acc, part) => acc + part.amount, 0)).toBe(1000);

    const uneven = allocateByWeights(money(1000, 'ARS'), [7, 2, 1]);
    expect(uneven.reduce((acc, part) => acc + part.amount, 0)).toBe(1000);
  });

  it('rejects zero-weight allocations', () => {
    expect(() => allocateByWeights(money(100, 'ARS'), [0, 0])).toThrow(MoneyError);
  });
});

describe('formatting', () => {
  it('formats ARS for es-AR without throwing', () => {
    const formatted = formatMoney(money(55_000_000, 'ARS'), 'es-AR');
    expect(formatted).toContain('550.000');
  });
});
