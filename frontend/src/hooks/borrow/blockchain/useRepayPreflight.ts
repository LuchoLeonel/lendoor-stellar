'use client'

/**
 * Spec 024 B.3 — live-ticking repay preflight hook.
 *
 * Wraps the spec 024 A.4 backend endpoint (`POST /loan/repay/preflight`)
 * and produces a 1-second-tick projection of the user's amountDue. The
 * projection uses the same formula the contract applies internally
 * (`previewLoanWithLate` semantics), so what the user sees on screen
 * matches what the contract pulls at tx time within sub-cent drift.
 *
 * Live-counter math (matches LoanManagerV3.previewLoanWithLate):
 *   elapsed     = nowChainEstimate - lastAccruedTs
 *   extraLateNum = (rateWad × elapsed × storedAmountDueBefore) / 1e18
 *   display     = accruedAmountDue + extraLateNum
 *
 * Where `nowChainEstimate` advances locally each tick (= chainNowUnix +
 * (Date.now()/1000 - serverNowUnix)), so we don't need a fresh chain
 * read every second — only when the user clicks "Pagar" (handled by
 * useRepay; see B.1).
 *
 * Refresh strategy:
 * - Fetch on mount when `enabled=true`.
 * - Re-fetch on `refresh()` call (e.g. user back-navigation).
 * - Optional periodic re-fetch at 60s cadence (rate-limit-friendly:
 *   spec 024 §4.4.1 recommends max 1 fetch per 10s; backend throttles
 *   at 6/min/wallet).
 *
 * Outputs:
 * - `payload` — full RepayPreflightPayload (BigInt-typed)
 * - `displayRaw` — current ticking amountDue, in USDC base units (bigint)
 * - `displayHuman` — same value formatted to 5 decimals (e.g. "11.40286")
 * - `perDayDelta` — $/day at current debt level (number)
 * - `magnitudePct` — display / principal × 100 (number, e.g. 100.34)
 * - `daysToDefault` — number, 0 if already past 16d threshold
 * - `loading`, `error`, `refresh` — standard async state.
 */

import * as React from 'react'

import { useApi } from '@/hooks/useApi'
import { ApiError } from '@/lib/api'
import type { RepayPreflightPayload } from '@shared/types/api'

interface UseRepayPreflightOptions {
  walletAddress: string | null
  /** Only fetch when there's an active loan to preflight. */
  enabled: boolean
  /** Optional auto-refresh cadence in ms. Default off (manual `refresh()`). */
  autoRefreshMs?: number
}

interface UseRepayPreflightResult {
  payload: RepayPreflightPayload | null
  displayRaw: bigint | null
  displayHuman: string | null
  perDayDelta: number | null
  magnitudePct: number | null
  daysToDefault: number | null
  /**
   * Spec 040 — true iff the on-chain `previewLoanWithLate` would
   * currently include any late-fee delta (i.e. NOW >= lateStart AND
   * ratePerSecWad > 0). Drives display decimals, ticker activity, and
   * any "incluye mora" / "vencido" UI affordance. Single source of
   * truth so the badges/colors don't drift from the number itself.
   */
  isMoraAccruing: boolean
  loading: boolean
  error: Error | null
  refresh: () => Promise<void>
}

/** WAD unit (1e18) for the rate-per-second computation. */
const WAD_BIGINT = 10n ** 18n

/**
 * Spec 031 — sub-base display precision.
 *
 * USDC has 6 decimals on chain, so each "base unit" = 1e-6 USDC. At
 * 5%/mo the per-second accrual on a $24 loan is ~4.6e-7 USDC = under
 * one base unit per second. Rounding to base units in the display
 * means the UI shows the same number for ~2 seconds straight.
 *
 * To make the ticker visibly move, we compute the display in
 * sub-base units: 1 sub-base unit = 1e-7 USDC = 0.1 USDC base units.
 * That gives one extra decimal of resolution and the per-second
 * accrual becomes ~5 sub-base units per second on a $24 loan.
 *
 * `displayRaw` (exposed for back-compat / magnitude calc) stays in
 * base units. `displaySubBase` is internal and used only for
 * `displayHuman` formatting at 7 decimals.
 */
const SUB_BASE_DECIMALS = 7
const SUB_BASE_PER_USDC = 10n ** BigInt(SUB_BASE_DECIMALS) // 1e7

/**
 * Spec 040 — format the sub-base amountDue with a variable number of
 * decimals.
 *
 *  - Pre-grace (mora not accruing yet): 2 decimals — the value is static
 *    until lateStart, so showing 7 decimals would imply something is
 *    changing when it isn't. Same precision as a normal USDC balance.
 *  - Post-grace (mora active): 7 decimals — the per-second accrual is
 *    sub-base unit, so we need the extra precision for the live ticker
 *    to show motion.
 */
export function _formatUsdcSubBase(rawSubBase: bigint, decimals: number): string {
  return formatUsdcSubBase(rawSubBase, decimals)
}

function formatUsdcSubBase(rawSubBase: bigint, decimals: number): string {
  const intPart = rawSubBase / SUB_BASE_PER_USDC
  const fracPart = rawSubBase % SUB_BASE_PER_USDC
  const fracStr = fracPart.toString().padStart(SUB_BASE_DECIMALS, '0')
  if (decimals >= SUB_BASE_DECIMALS) {
    return `${intPart.toString()}.${fracStr}`
  }
  // Truncate (don't round) to the requested decimals — same convention
  // as borrowedDisplay in useCreditLine: never overstate what the
  // contract will pull.
  const truncated = fracStr.slice(0, decimals)
  return `${intPart.toString()}.${truncated}`
}

/**
 * Spec 040 — single source of truth for "is mora accruing right now?".
 * Used to gate display decimals, ticker interval, and (downstream)
 * any "incluye mora" / "vencido" badges.
 *
 * Mirrors `previewLoanWithLate` on-chain: only true when
 * `nowChain >= lateStart` AND `ratePerSecWad > 0`. Caller must pass the
 * client-side projection of nowChain (chainNowUnix + localElapsedMs).
 */
export function _isMoraAccruingAt(
  payload: RepayPreflightPayload,
  nowMs: number,
): boolean {
  return isMoraAccruingAt(payload, nowMs)
}

function isMoraAccruingAt(
  payload: RepayPreflightPayload,
  nowMs: number,
): boolean {
  if (payload.ratePerSecWad === 0n) return false
  const serverNowMs = payload.serverNowUnix * 1000
  const chainEstimateMs = payload.chainNowUnix * 1000 + (nowMs - serverNowMs)
  const lateStartMs = payload.lateStart * 1000
  return chainEstimateMs >= lateStartMs
}

/**
 * Compute the projected `display` raw amountDue at a given local time,
 * in sub-base USDC units (1 unit = 1e-7 USDC).
 *
 * Mirrors LoanManagerV3.previewLoanWithLate but keeps:
 *  - One extra decimal of precision (sub-base) so the 7th visible
 *    decimal of the human-readable display can change.
 *  - Millisecond-level resolution in `tLate` so the integer-floor
 *    of `extraSubBase` advances by ~1 unit per ~210ms on a $24
 *    loan (instead of jumping by 4-5 every full second when we
 *    floored elapsed to whole seconds).
 *
 * Math:
 *   extraSubBase = (rateWad × elapsedMs × storedAmountDueBefore) / 1e20
 *   (1e20 = 1e18 [WAD] × 1000 [s→ms] × 1/10 [base→sub-base])
 *
 * NOTE: floor of `accruedAmountDue * 10` is by definition ≥ chain
 * storage `amountDue × 10`, so the displayed value is never less
 * than what the contract will pull at tx time (within sub-cent
 * drift).
 */
const MS_TO_SUB_BASE_DIVISOR = 10n ** 20n // 1e20 = WAD × 1000 / 10
export function _computeDisplaySubBase(
  payload: RepayPreflightPayload,
  nowMs: number,
): bigint {
  return computeDisplaySubBase(payload, nowMs)
}

function computeDisplaySubBase(
  payload: RepayPreflightPayload,
  nowMs: number,
): bigint {
  const serverNowMs = payload.serverNowUnix * 1000
  const chainNowMs = payload.chainNowUnix * 1000
  const localElapsedMs = nowMs - serverNowMs
  const chainEstimateMs = chainNowMs + localElapsedMs
  const lastAccruedMs = payload.lastAccruedTs * 1000
  // accruedAmountDue is in base units (1e-6); shift to sub-base (1e-7).
  const accruedSubBase = payload.accruedAmountDue * 10n
  if (payload.ratePerSecWad === 0n) {
    return accruedSubBase
  }

  // Mora only accrues AFTER lateStart (= dueAt + gracePeriod, typically
  // 24h post-due). Before that, the contract's previewLoanWithLate keeps
  // amountDue static, and the live ticker must mirror that — otherwise a
  // user that just took a loan sees the debt growing immediately, which
  // is wrong (mora is a late-fee, not interest from origination).
  //
  // Spec 024 sets lateRatePerSecWad > 0 from the moment of borrow (the
  // rate is configured per-wallet, not per-loan-state), so the previous
  // check `ratePerSecWad > 0` was insufficient — we also need to gate on
  // chain time vs lateStart.
  const lateStartMs = payload.lateStart * 1000
  if (chainEstimateMs < lateStartMs) {
    return accruedSubBase
  }

  // Once past lateStart, count elapsed from max(lastAccrued, lateStart)
  // so we never charge for time before the grace period ended.
  const accrualFromMs = Math.max(lastAccruedMs, lateStartMs)
  const elapsedMs = Math.max(0, chainEstimateMs - accrualFromMs)
  if (elapsedMs === 0) {
    return accruedSubBase
  }

  const extraSubBase =
    (payload.ratePerSecWad *
      BigInt(elapsedMs) *
      payload.storedAmountDueBefore) /
    MS_TO_SUB_BASE_DIVISOR
  return accruedSubBase + extraSubBase
}

export function useRepayPreflight(
  opts: UseRepayPreflightOptions,
): UseRepayPreflightResult {
  const { walletAddress, enabled, autoRefreshMs } = opts
  const api = useApi()

  const [payload, setPayload] = React.useState<RepayPreflightPayload | null>(
    null,
  )
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<Error | null>(null)
  const [tickNow, setTickNow] = React.useState<number>(() => Date.now())

  const fetchPreflight = React.useCallback(async () => {
    if (!walletAddress || !enabled) return
    setLoading(true)
    setError(null)
    try {
      const p = await api.preflightRepayment({ walletAddress })
      setPayload(p)
    } catch (e) {
      // Don't surface 404 (= no active loan) as an error — it's expected
      // when the user has no debt.
      if (e instanceof ApiError && e.status === 404) {
        setPayload(null)
      } else {
        setError(e instanceof Error ? e : new Error(String(e)))
      }
    } finally {
      setLoading(false)
    }
  }, [api, walletAddress, enabled])

  // Initial fetch + refetch on dep changes.
  React.useEffect(() => {
    if (!enabled || !walletAddress) {
      setPayload(null)
      return
    }
    void fetchPreflight()
  }, [enabled, walletAddress, fetchPreflight])

  // Optional auto-refresh.
  React.useEffect(() => {
    if (!autoRefreshMs || !enabled || !walletAddress) return
    const id = setInterval(() => {
      void fetchPreflight()
    }, autoRefreshMs)
    return () => clearInterval(id)
  }, [autoRefreshMs, enabled, walletAddress, fetchPreflight])

  // Spec 031 §2.1 — refetch on tab visibility / focus.
  //
  // Without this, a user that opens the panel BEFORE an external state
  // change (e.g. an operator activating mora via spec 025 CLI) will
  // see a stale `accruedAmountDue` until they navigate away and back.
  // The display ends up showing a value lower than chain truth, which
  // breaks the visual contract with the user.
  //
  // The backend endpoint is throttled at 6/min/wallet (spec 024 A.4),
  // so this can't accidentally hammer it — at worst the user gets a
  // 429 back, which we ignore.
  React.useEffect(() => {
    if (!enabled || !walletAddress) return
    const onFocus = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      void fetchPreflight()
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', onFocus)
      window.addEventListener('visibilitychange', onFocus)
      return () => {
        window.removeEventListener('focus', onFocus)
        window.removeEventListener('visibilitychange', onFocus)
      }
    }
    return
  }, [enabled, walletAddress, fetchPreflight])

  // Spec 031 — 200ms tick (was 1000ms).
  //
  // Rationale: at 1s ticking the integer-floor of sub-base accrual on
  // a $24 loan was jumping by 4-5 units per tick, so the visible 7th
  // decimal looked like "0 → 4 → 9 → 4 → 3 → 8" instead of moving
  // monotonically by 1. With 200ms ticking + ms-precision math, each
  // tick gains ~0.96 sub-base units → floor advances by exactly 1
  // most ticks, ~5 changes/sec. Smooth visual rhythm.
  //
  // 200ms × 1 React render = trivial cost; React is not bottlenecked
  // here.
  React.useEffect(() => {
    if (!payload || payload.ratePerSecWad === 0n) return
    // Pre-grace (NOW < lateStart) the display is static — no need to spin
    // a 200ms interval. Once we cross lateStart, the next preflight refresh
    // will refire this effect with updated chainNowUnix and the ticker
    // starts. Schedule a one-shot wakeup at lateStart so the user sees
    // the moment the ticker turns on without depending on autoRefresh.
    const chainNowMs = payload.chainNowUnix * 1000
    const lateStartMs = payload.lateStart * 1000
    if (chainNowMs < lateStartMs) {
      const msUntilLateStart = lateStartMs - chainNowMs
      const wakeup = setTimeout(() => setTickNow(Date.now()), msUntilLateStart + 100)
      return () => clearTimeout(wakeup)
    }
    const id = setInterval(() => setTickNow(Date.now()), 200)
    return () => clearInterval(id)
  }, [payload])

  const displaySubBase = React.useMemo(() => {
    if (!payload) return null
    return computeDisplaySubBase(payload, tickNow)
  }, [payload, tickNow])

  // Spec 040 — single source of truth for "is mora accruing right now".
  // Re-evaluated each tick so the moment we cross lateStart the UI
  // switches from 2-decimal static to 7-decimal ticking automatically.
  const isMoraAccruing = React.useMemo(() => {
    if (!payload) return false
    return isMoraAccruingAt(payload, tickNow)
  }, [payload, tickNow])

  // Back-compat: expose displayRaw in USDC base units (6 decimals)
  // by truncating sub-base. Used by magnitudePct calc.
  const displayRaw = React.useMemo(() => {
    if (displaySubBase == null) return null
    return displaySubBase / 10n
  }, [displaySubBase])

  const displayHuman = React.useMemo(() => {
    if (displaySubBase == null) return null
    // Spec 040 — 2 decimales pre-grace (display estático, igual que un
    // monto USDC normal); 7 decimales post-grace cuando el ticker está
    // mostrando la mora real-time.
    const decimals = isMoraAccruing ? SUB_BASE_DECIMALS : 2
    return formatUsdcSubBase(displaySubBase, decimals)
  }, [displaySubBase, isMoraAccruing])

  const perDayDelta = React.useMemo(() => {
    if (!payload) return null
    return payload.perDayDelta
  }, [payload])

  const magnitudePct = React.useMemo(() => {
    if (!payload || displayRaw == null) return null
    if (payload.principal === 0n) return null
    // (display / principal) × 100, with 2-decimal precision via bigint math
    const numerator = displayRaw * 10_000n
    const ratio = Number(numerator / payload.principal) / 100
    return ratio
  }, [payload, displayRaw])

  const daysToDefault = React.useMemo(() => {
    if (!payload) return null
    return payload.daysToDefault
  }, [payload])

  return {
    payload,
    displayRaw,
    displayHuman,
    perDayDelta,
    magnitudePct,
    daysToDefault,
    isMoraAccruing,
    loading,
    error,
    refresh: fetchPreflight,
  }
}
