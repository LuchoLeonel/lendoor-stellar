// Spec 040 — display-gating tests for useRepayPreflight.
//
// Covers the 4 loan stages defined in specs/040-mora-display-gating/spec.md:
//   1. Pre-due (NOW < dueAt)
//   2. In 24h grace (dueAt < NOW < dueAt + 24h)
//   3. Mora active (dueAt + 24h < NOW < dueAt + 16d)
//   4. Default real (NOW > dueAt + 16d)
//
// For each stage:
//  - isMoraAccruingAt() returns the correct boolean.
//  - computeDisplaySubBase() returns static value (= accruedAmountDue × 10)
//    pre-grace, and a value that grows with elapsed time post-grace.
//  - formatUsdcSubBase() formats with 2 decimals when caller passes 2,
//    7 decimals when caller passes 7.
import { describe, it, expect } from 'vitest';
import {
  _computeDisplaySubBase,
  _isMoraAccruingAt,
  _formatUsdcSubBase,
} from '../useRepayPreflight';
import type { RepayPreflightPayload } from '@shared/types/api';

const ONE_HOUR = 3600;
const ONE_DAY = 86400;
const FIVE_PCT_PER_MO_WAD = 19290123457n;

function makePayload(opts: {
  /** chainNow (unix sec) — by default = serverNow. */
  chainNow: number;
  /** dueAt (unix sec). gracePeriod = 24h. */
  dueAt: number;
  /** stored amountDue in USDC base units (1e-6 USDC). */
  amountDue: bigint;
  /** ratePerSecWad. Default = 5%/mo (active spec 024 rate). */
  ratePerSecWad?: bigint;
  /** lastAccrued (unix sec). Default = chainNow (no accrueLate yet). */
  lastAccruedTs?: number;
}): RepayPreflightPayload {
  const grace = ONE_DAY;
  const lateStart = opts.dueAt + grace;
  const rate = opts.ratePerSecWad ?? FIVE_PCT_PER_MO_WAD;
  return {
    wallet: '0xtest',
    principal: 25_000_000n,
    storedAmountDueBefore: opts.amountDue,
    accruedAmountDue: opts.amountDue,
    lastAccruedTs: opts.lastAccruedTs ?? opts.chainNow,
    ratePerSecWad: rate,
    baseFeeBps: 467,
    dueAt: opts.dueAt,
    gracePeriod: grace,
    lateStart,
    serverNowUnix: opts.chainNow,
    chainNowUnix: opts.chainNow,
    perDayDelta: 0,
    daysLate: 0,
    daysToDefault: 0,
    isDefaulted: false,
    accrueLateCalled: false,
    accrueLateSkippedReason: null,
  };
}

describe('spec 040 — mora display gating', () => {
  // -- 1. Pre-due ---------------------------------------------------
  describe('stage: pre-due (NOW < dueAt)', () => {
    const NOW = 1_700_000_000; // arbitrary unix sec
    const payload = makePayload({
      chainNow: NOW,
      dueAt: NOW + 5 * ONE_DAY, // due in 5 days
      amountDue: 25_870_000n, // $25.87
    });

    it('isMoraAccruing = false', () => {
      expect(_isMoraAccruingAt(payload, NOW * 1000)).toBe(false);
    });

    it('display is static (= accruedAmountDue × 10) regardless of tickNow', () => {
      const t0 = _computeDisplaySubBase(payload, NOW * 1000);
      const t60s = _computeDisplaySubBase(payload, (NOW + 60) * 1000);
      const t1h = _computeDisplaySubBase(payload, (NOW + ONE_HOUR) * 1000);
      const expected = 25_870_000n * 10n;
      expect(t0).toBe(expected);
      expect(t60s).toBe(expected);
      expect(t1h).toBe(expected);
    });

    it('formatUsdcSubBase(2 decimals) returns "$25.87"', () => {
      const v = _computeDisplaySubBase(payload, NOW * 1000);
      expect(_formatUsdcSubBase(v, 2)).toBe('25.87');
    });
  });

  // -- 2. In 24h grace ----------------------------------------------
  describe('stage: in 24h grace (dueAt < NOW < dueAt + 24h)', () => {
    const NOW = 1_700_000_000;
    const payload = makePayload({
      chainNow: NOW,
      dueAt: NOW - 12 * ONE_HOUR, // due 12h ago, still in grace
      amountDue: 25_870_000n,
    });

    it('isMoraAccruing = false', () => {
      expect(_isMoraAccruingAt(payload, NOW * 1000)).toBe(false);
    });

    it('display is still static — no accrual yet', () => {
      const t0 = _computeDisplaySubBase(payload, NOW * 1000);
      const t1h = _computeDisplaySubBase(payload, (NOW + ONE_HOUR) * 1000);
      // Both are in the grace window; should not change.
      const expected = 25_870_000n * 10n;
      expect(t0).toBe(expected);
      expect(t1h).toBe(expected);
    });
  });

  // -- 3. Mora active ----------------------------------------------
  describe('stage: mora active (dueAt + 24h < NOW < dueAt + 16d)', () => {
    const NOW = 1_700_000_000;
    const payload = makePayload({
      chainNow: NOW,
      dueAt: NOW - 3 * ONE_DAY, // 3 days past due (well past 24h grace)
      amountDue: 25_870_000n,
      // lastAccrued lo dejamos en chainNow (default) → desde NOW.
      // El cálculo debería usar max(lastAccrued, lateStart). lateStart = NOW - 2*ONE_DAY.
      // Como lastAccrued (= chainNow) > lateStart, accrualFrom = lastAccrued.
      // Para un test claro, el delta a NOW+0 es 0.
    });

    it('isMoraAccruing = true', () => {
      expect(_isMoraAccruingAt(payload, NOW * 1000)).toBe(true);
    });

    it('display grows with elapsed time', () => {
      const t0 = _computeDisplaySubBase(payload, NOW * 1000);
      const t10s = _computeDisplaySubBase(payload, (NOW + 10) * 1000);
      const t1h = _computeDisplaySubBase(payload, (NOW + ONE_HOUR) * 1000);
      // Strictly monotonic.
      expect(t10s).toBeGreaterThan(t0);
      expect(t1h).toBeGreaterThan(t10s);
    });

    it('formatUsdcSubBase(7 decimals) shows full precision', () => {
      const v = _computeDisplaySubBase(payload, (NOW + 60) * 1000);
      const formatted = _formatUsdcSubBase(v, 7);
      expect(formatted).toMatch(/^\d+\.\d{7}$/);
    });
  });

  // -- 4. Default real ---------------------------------------------
  describe('stage: default real (NOW > dueAt + 16d)', () => {
    const NOW = 1_700_000_000;
    const payload = makePayload({
      chainNow: NOW,
      dueAt: NOW - 20 * ONE_DAY,
      amountDue: 25_870_000n,
    });

    it('isMoraAccruing = true', () => {
      expect(_isMoraAccruingAt(payload, NOW * 1000)).toBe(true);
    });

    it('display tickeable as in mora-active', () => {
      const t0 = _computeDisplaySubBase(payload, NOW * 1000);
      const t60s = _computeDisplaySubBase(payload, (NOW + 60) * 1000);
      expect(t60s).toBeGreaterThan(t0);
    });
  });

  // -- Edge: ratePerSecWad = 0 (mora desactivada) --------------------
  describe('edge: ratePerSecWad = 0 (mora not enabled for this wallet)', () => {
    const NOW = 1_700_000_000;
    const payload = makePayload({
      chainNow: NOW,
      dueAt: NOW - 5 * ONE_DAY, // way past grace
      amountDue: 25_870_000n,
      ratePerSecWad: 0n,
    });

    it('isMoraAccruing = false even when post-grace', () => {
      expect(_isMoraAccruingAt(payload, NOW * 1000)).toBe(false);
    });

    it('display stays static', () => {
      const t0 = _computeDisplaySubBase(payload, NOW * 1000);
      const t1h = _computeDisplaySubBase(payload, (NOW + ONE_HOUR) * 1000);
      expect(t0).toBe(t1h);
    });
  });

  // -- Edge: transición pre→post grace en el mismo render ------------
  describe('edge: crossing lateStart between renders', () => {
    const NOW = 1_700_000_000;
    const payload = makePayload({
      chainNow: NOW,
      dueAt: NOW + 100 - ONE_DAY, // lateStart = NOW + 100s
      amountDue: 25_870_000n,
    });

    it('static at NOW (pre-grace), tickeable at NOW + 200s (post-grace)', () => {
      expect(_isMoraAccruingAt(payload, NOW * 1000)).toBe(false);
      expect(_isMoraAccruingAt(payload, (NOW + 200) * 1000)).toBe(true);
      const tPre = _computeDisplaySubBase(payload, NOW * 1000);
      const tPost = _computeDisplaySubBase(payload, (NOW + 200) * 1000);
      expect(tPost).toBeGreaterThan(tPre);
    });
  });

  // -- Format unit tests --------------------------------------------
  describe('formatUsdcSubBase', () => {
    it('formats with 2 decimals (truncates without rounding)', () => {
      // 25.87654321 → 25.87 (truncate, not round)
      expect(_formatUsdcSubBase(258_765_432n, 2)).toBe('25.87');
    });

    it('formats with 7 decimals', () => {
      expect(_formatUsdcSubBase(258_700_000n, 7)).toBe('25.8700000');
      expect(_formatUsdcSubBase(258_765_432n, 7)).toBe('25.8765432');
    });

    it('handles zero correctly', () => {
      expect(_formatUsdcSubBase(0n, 2)).toBe('0.00');
      expect(_formatUsdcSubBase(0n, 7)).toBe('0.0000000');
    });

    it('handles small fractions correctly', () => {
      // 5 sub-base units = 0.0000005 USDC. With 7 decimals shown,
      // matches exactly. With 2 decimals, truncates to 0.00.
      expect(_formatUsdcSubBase(5n, 7)).toBe('0.0000005');
      expect(_formatUsdcSubBase(5n, 2)).toBe('0.00');
    });
  });
});
