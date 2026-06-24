import { describe, it, expect } from 'vitest';
import {
  calcTotalAssets,
  calcSharePrice,
  calcApyFromPrices,
  project30dFromApy,
} from '../apyMath';

describe('calcTotalAssets', () => {
  it('sums cash and totalBorrows', () => {
    expect(calcTotalAssets({ cash: '100', totalBorrows: '200' })).toBe(300);
  });

  it('handles zero cash', () => {
    expect(calcTotalAssets({ cash: '0', totalBorrows: '500' })).toBe(500);
  });

  it('handles zero borrows', () => {
    expect(calcTotalAssets({ cash: '750', totalBorrows: '0' })).toBe(750);
  });

  it('handles both zero', () => {
    expect(calcTotalAssets({ cash: '0', totalBorrows: '0' })).toBe(0);
  });

  it('handles decimal values', () => {
    expect(calcTotalAssets({ cash: '1.5', totalBorrows: '2.5' })).toBeCloseTo(4);
  });
});

describe('calcSharePrice', () => {
  it('returns assets divided by shares', () => {
    // 100 cash + 200 borrows = 300 assets, 300 shares → price = 1
    expect(calcSharePrice({ cash: '100', totalBorrows: '200', totalShares: '300' })).toBe(1);
  });

  it('returns > 1 when assets exceed shares (vault has earned yield)', () => {
    // 600 assets / 500 shares = 1.2
    expect(calcSharePrice({ cash: '300', totalBorrows: '300', totalShares: '500' })).toBeCloseTo(1.2);
  });

  it('returns 0 when totalShares is zero (avoid division by zero)', () => {
    expect(calcSharePrice({ cash: '100', totalBorrows: '100', totalShares: '0' })).toBe(0);
  });

  it('returns 0 when all values are zero', () => {
    expect(calcSharePrice({ cash: '0', totalBorrows: '0', totalShares: '0' })).toBe(0);
  });

  it('returns fractional price when assets < shares', () => {
    // 100 assets / 200 shares = 0.5
    expect(calcSharePrice({ cash: '100', totalBorrows: '0', totalShares: '200' })).toBeCloseTo(0.5);
  });
});

describe('calcApyFromPrices', () => {
  it('returns 0 when pricePast is zero', () => {
    expect(calcApyFromPrices(1.05, 0, 15)).toBe(0);
  });

  it('returns 0 when priceNow is zero', () => {
    expect(calcApyFromPrices(0, 1.0, 15)).toBe(0);
  });

  it('returns 0 when ratio is negative (should not happen in practice)', () => {
    // ratio = -1 / 1 = -1 → ratio <= 0 branch
    expect(calcApyFromPrices(-1, 1, 15)).toBe(0);
  });

  it('returns 0 for unchanged prices (flat vault)', () => {
    const apy = calcApyFromPrices(1.0, 1.0, 15);
    // ratio = 1, apy = 1^(365/15) - 1 = 0
    expect(apy).toBeCloseTo(0);
  });

  it('computes APY correctly for a known scenario', () => {
    // If price grew from 1.0 to 1.001 over 1 day,
    // APY ≈ 1.001^365 - 1 ≈ 0.44 (44%)
    const apy = calcApyFromPrices(1.001, 1.0, 1);
    expect(apy).toBeGreaterThan(0.4);
    expect(apy).toBeLessThan(0.5);
  });

  it('returns positive APY when price has grown', () => {
    const apy = calcApyFromPrices(1.002, 1.0, 15);
    expect(apy).toBeGreaterThan(0);
  });

  it('returns negative APY when price has decreased (depeg scenario)', () => {
    const apy = calcApyFromPrices(0.999, 1.0, 15);
    expect(apy).toBeLessThan(0);
  });
});

describe('project30dFromApy', () => {
  it('returns 0 for 0 APY', () => {
    expect(project30dFromApy(0)).toBeCloseTo(0);
  });

  it('returns a positive value for a positive APY', () => {
    // 10% APY projected 30 days
    const result = project30dFromApy(0.1);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(0.1); // 30d < 365d
  });

  it('is consistent with the compound formula for 100% APY', () => {
    // (1 + 1)^(30/365) - 1
    const expected = Math.pow(2, 30 / 365) - 1;
    expect(project30dFromApy(1)).toBeCloseTo(expected, 8);
  });

  it('30d projection is less than annual APY for positive rates', () => {
    const apy = 0.5;
    const projected = project30dFromApy(apy);
    expect(projected).toBeLessThan(apy);
  });
});
