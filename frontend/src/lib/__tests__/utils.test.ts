import { describe, it, expect } from 'vitest';
import {
  cn,
  withThousands,
  formatAmount,
  formatUSDCAmount,
  formatUSDCAmount2dp,
  formatUSDCAmountExact,
  parseUsdcAmount,
  normalizeErrorMessage,
  getScoreNumber,
  getLevelInfoFromXp,
  XP_PER_LEVEL,
  MAX_LEVEL,
  DECIMALS,
} from '../utils';

describe('cn (class name merger)', () => {
  it('merges simple class strings', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });

  it('deduplicates conflicting tailwind classes', () => {
    // tailwind-merge resolves conflicts by keeping the last one
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
  });

  it('ignores falsy values', () => {
    expect(cn('foo', false, undefined, null, 'bar')).toBe('foo bar');
  });

  it('handles conditional objects', () => {
    expect(cn('base', { active: true, disabled: false })).toBe('base active');
  });

  it('returns empty string for no arguments', () => {
    expect(cn()).toBe('');
  });
});

describe('withThousands', () => {
  it('formats thousands separator for 4-digit number', () => {
    expect(withThousands('1000')).toBe('1,000');
  });

  it('formats thousands for 7-digit number', () => {
    expect(withThousands('1234567')).toBe('1,234,567');
  });

  it('does not modify 3-digit number', () => {
    expect(withThousands('999')).toBe('999');
  });

  it('does not modify empty string', () => {
    expect(withThousands('')).toBe('');
  });
});

describe('DECIMALS constant', () => {
  it('equals 6', () => {
    expect(DECIMALS).toBe(6);
  });
});

describe('formatAmount', () => {
  it('formats whole number correctly', () => {
    // 1_000_000 units with 6 decimals = 1.000000 -> trimmed to "1"
    expect(formatAmount(1_000_000n)).toBe('1');
  });

  it('formats fractional amount', () => {
    // 1_500_000 units = 1.5
    expect(formatAmount(1_500_000n)).toBe('1.5');
  });

  it('formats negative amount', () => {
    expect(formatAmount(-1_000_000n)).toBe('-1');
  });

  it('formats zero', () => {
    expect(formatAmount(0n)).toBe('0');
  });

  it('respects minFrac parameter', () => {
    // 2 minFrac decimals: 1 USDC = "1.00"
    expect(formatAmount(1_000_000n, 6, 2, 2)).toBe('1.00');
  });

  it('adds thousands separator for large amounts', () => {
    // 1_000_000_000_000 units with 6 decimals = 1,000,000
    expect(formatAmount(1_000_000_000_000n)).toBe('1,000,000');
  });
});

describe('formatUSDCAmount', () => {
  it('formats bigint USDC with 6 decimals', () => {
    expect(formatUSDCAmount(10_000_000n)).toBe('10');
  });

  it('formats string input', () => {
    expect(formatUSDCAmount('10')).toBe('10');
  });

  it('returns fallback dash for empty string', () => {
    expect(formatUSDCAmount('')).toBe('');
  });

  it('formats fractional USDC', () => {
    expect(formatUSDCAmount(1_500_000n)).toBe('1.5');
  });
});

describe('formatUSDCAmount2dp', () => {
  it('formats with exactly 2 decimal places', () => {
    expect(formatUSDCAmount2dp(1_000_000n)).toBe('1.00');
  });

  it('rounds to 2 decimals', () => {
    // 1_234_567 / 1e6 = 1.234567 -> rounds to 1.23
    expect(formatUSDCAmount2dp(1_234_567n)).toBe('1.23');
  });

  it('formats zero as "0.00"', () => {
    expect(formatUSDCAmount2dp(0n)).toBe('0.00');
  });
});

describe('formatUSDCAmountExact', () => {
  it('keeps at least 2 decimals for round amounts', () => {
    expect(formatUSDCAmountExact(2_000_000n)).toBe('2.00');
    expect(formatUSDCAmountExact(1_000_000n)).toBe('1.00');
  });

  it('shows the dust (3rd-6th decimals) when present', () => {
    expect(formatUSDCAmountExact(2_104_600n)).toBe('2.1046');
    expect(formatUSDCAmountExact(2_100_000n)).toBe('2.10');
    expect(formatUSDCAmountExact(1n)).toBe('0.000001');
  });

  it('handles zero and negatives', () => {
    expect(formatUSDCAmountExact(0n)).toBe('0.00');
    expect(formatUSDCAmountExact(-2_500_000n)).toBe('-2.50');
  });

  it('accepts a decimal string and returns it verbatim when unparseable', () => {
    expect(formatUSDCAmountExact('abc')).toBe('abc');
  });
});

describe('parseUsdcAmount', () => {
  it('parses whole and decimal amounts to 6-decimal units', () => {
    expect(parseUsdcAmount('1')).toBe(1_000_000n);
    expect(parseUsdcAmount('2.5')).toBe(2_500_000n);
    expect(parseUsdcAmount('0.000001')).toBe(1n);
  });

  it('treats comma as the decimal separator (AR/EU convention)', () => {
    expect(parseUsdcAmount('5,5')).toBe(5_500_000n);
  });

  it('truncates beyond 6 decimals (no rounding → cero dust)', () => {
    expect(parseUsdcAmount('1.0000009')).toBe(1_000_000n);
    expect(parseUsdcAmount('1.2345678')).toBe(1_234_567n);
  });

  it('supports a leading dot and integer-only input', () => {
    expect(parseUsdcAmount('.5')).toBe(500_000n);
    expect(parseUsdcAmount('100')).toBe(100_000_000n);
  });

  it('returns null for empty or invalid input', () => {
    expect(parseUsdcAmount('')).toBeNull();
    expect(parseUsdcAmount('abc')).toBeNull();
    expect(parseUsdcAmount('1.2.3')).toBeNull();
  });
});

describe('normalizeErrorMessage', () => {
  it('extracts message from Error object', () => {
    const err = new Error('Something went wrong');
    expect(normalizeErrorMessage(err)).toBe('Something went wrong');
  });

  it('returns string input as-is when not JSON', () => {
    expect(normalizeErrorMessage('plain error')).toBe('plain error');
  });

  it('extracts message from JSON string', () => {
    const json = JSON.stringify({ message: 'server error' });
    expect(normalizeErrorMessage(json)).toBe('server error');
  });

  it('returns null for null input', () => {
    expect(normalizeErrorMessage(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(normalizeErrorMessage(undefined)).toBeNull();
  });

  it('converts unknown type to string', () => {
    expect(normalizeErrorMessage(42)).toBe('42');
  });
});

describe('getScoreNumber', () => {
  it('parses a plain integer string', () => {
    expect(getScoreNumber('3')).toBe(3);
  });

  it('parses a decimal string', () => {
    expect(getScoreNumber('3.5')).toBe(3.5);
  });

  it('handles comma decimal separator', () => {
    expect(getScoreNumber('1,5')).toBe(1.5);
  });

  it('returns 0 for null', () => {
    expect(getScoreNumber(null)).toBe(0);
  });

  it('returns 0 for undefined', () => {
    expect(getScoreNumber(undefined)).toBe(0);
  });

  it('returns 0 for empty string', () => {
    expect(getScoreNumber('')).toBe(0);
  });

  it('returns 0 for non-numeric string', () => {
    expect(getScoreNumber('N/A')).toBe(0);
  });

  it('extracts the first number from a mixed string', () => {
    expect(getScoreNumber('Score: 4.2')).toBe(4.2);
  });
});

describe('getLevelInfoFromXp', () => {
  it('returns level 1 for 0 XP', () => {
    const info = getLevelInfoFromXp(0);
    expect(info.level).toBe(1);
    expect(info.totalXp).toBe(0);
    expect(info.xpInLevel).toBe(0);
    expect(info.xpToNextLevel).toBe(XP_PER_LEVEL);
    expect(info.progressInLevel).toBe(0);
  });

  it('returns level 2 after enough XP to level up once', () => {
    const info = getLevelInfoFromXp(XP_PER_LEVEL);
    expect(info.level).toBe(2);
    expect(info.xpInLevel).toBe(0);
    expect(info.xpToNextLevel).toBe(XP_PER_LEVEL);
  });

  it('calculates progress within a level', () => {
    const info = getLevelInfoFromXp(XP_PER_LEVEL + Math.floor(XP_PER_LEVEL / 2));
    expect(info.level).toBe(2);
    expect(info.progressInLevel).toBeCloseTo(0.5, 1);
  });

  it('caps at MAX_LEVEL', () => {
    const xpBeyondMax = MAX_LEVEL * XP_PER_LEVEL + 1000;
    const info = getLevelInfoFromXp(xpBeyondMax);
    expect(info.level).toBe(MAX_LEVEL);
    expect(info.progressInLevel).toBe(1);
    expect(info.xpToNextLevel).toBe(0);
  });

  it('floors negative XP to 0', () => {
    const info = getLevelInfoFromXp(-50);
    expect(info.level).toBe(1);
    expect(info.totalXp).toBe(0);
  });
});
