import { describe, it, expect } from 'vitest';
import { formatUsdcFromBigIntString, formatCountFromBigIntString } from '../format';

describe('formatUsdcFromBigIntString', () => {
  it('returns dash for undefined', () => {
    expect(formatUsdcFromBigIntString(undefined)).toBe('—');
  });

  it('returns dash for empty string', () => {
    expect(formatUsdcFromBigIntString('')).toBe('—');
  });

  it('formats 1 USDC (1_000_000 raw)', () => {
    const result = formatUsdcFromBigIntString('1000000');
    expect(result).toBe('1.00');
  });

  it('formats 10 USDC (10_000_000 raw)', () => {
    const result = formatUsdcFromBigIntString('10000000');
    expect(result).toBe('10.00');
  });

  it('formats 1000 USDC with thousands separator', () => {
    const result = formatUsdcFromBigIntString('1000000000');
    // 1000000000 / 1e6 = 1000.00
    expect(result).toBe('1,000.00');
  });

  it('formats fractional USDC with 2 decimal places', () => {
    const result = formatUsdcFromBigIntString('1500000');
    // 1500000 / 1e6 = 1.5 -> displayed as "1.50"
    expect(result).toBe('1.50');
  });

  it('formats zero', () => {
    const result = formatUsdcFromBigIntString('0');
    expect(result).toBe('0.00');
  });

  it('returns dash for non-numeric string', () => {
    expect(formatUsdcFromBigIntString('not-a-number')).toBe('—');
  });
});

describe('formatCountFromBigIntString', () => {
  it('returns dash for undefined', () => {
    expect(formatCountFromBigIntString(undefined)).toBe('—');
  });

  it('returns dash for empty string', () => {
    expect(formatCountFromBigIntString('')).toBe('—');
  });

  it('formats small count', () => {
    const result = formatCountFromBigIntString('5');
    expect(result).toBe('5');
  });

  it('formats count with thousands separator', () => {
    const result = formatCountFromBigIntString('1000');
    expect(result).toBe('1,000');
  });

  it('formats zero', () => {
    const result = formatCountFromBigIntString('0');
    expect(result).toBe('0');
  });

  it('returns raw string for non-numeric input', () => {
    // non-numeric returns raw value since Number() would be NaN
    const result = formatCountFromBigIntString('abc');
    expect(result).toBe('abc');
  });
});
