'use client'

import * as React from 'react'
import { parseUnits, MaxUint256 } from 'ethers'
import { toast } from 'sonner'

/**
 * Spec 024 B.1 — penny-precision allowance buffer.
 *
 * USDC has 6 decimals on Celo, so $0.01 = 10_000 base units. We approve
 * `amount + PENNY_BUFFER_USDC_BASE` to cover sub-second mora drift
 * between the click ("display" value at the moment user signs) and the
 * tx execution moment (when the contract reads its own L.amountDue).
 *
 * Why $0.01 specifically (not 10%): a 10% buffer ($1 on a $10 loan) is
 * wasteful allowance the user has already pre-approved — even if the
 * vault never pulls the extra, the approval sits there. $0.01 is enough
 * to cover ~16h of mora growth on a $10 loan at 5%/mo (the spec 024
 * rate), well over any realistic sign-and-execute window.
 *
 * Why NOT MaxUint256 in approve: granting unbounded USDC spend is bad
 * UX (some wallets warn) and creates standing risk. The buffer here
 * is bounded and refreshed each repay attempt.
 */
const PENNY_BUFFER_USDC_BASE = 10_000n // $0.01 in 6-decimal USDC base units

/**
 * Spec 024 B.1 — MaxUint256 sentinel for `repay(amount, receiver)`.
 *
 * The custom Borrowing module checks: `if (amount != type(uint256).max
 * && amount != amountDue) revert MustRepayFullAmountDue()`. Passing
 * MaxUint256 short-circuits the strict-equality check — the contract
 * uses its own stored L.amountDue (just refreshed by the backend's
 * preflight call to accrueLate) as the actual pull amount.
 *
 * This eliminates the Lukas-style trap where the client-sent amount
 * mismatched stored amountDue (because preview grew per second but
 * storage didn't) and every repay attempt reverted.
 */
const REPAY_AMOUNT_SENTINEL = MaxUint256

import { useTranslation } from '@/i18n/useTranslation'
import { useContracts } from '@/providers/ContractsProvider'
import { useWallet } from '@/providers/WalletProvider'
import { useBorrower } from '@/providers/BorrowerProvider'
import { DECIMALS, formatAmount } from '@/lib/utils'
import { useApi } from '@/hooks/useApi'
import { ApiError } from '@/lib/api'
import { retryWithBackoff } from '@/lib/retryWithBackoff'
import { addPending, removePending, updatePending } from '@/lib/repaymentQueue'
import { useGamificationStore } from '@/stores/gamificationStore'
import { useLoanStatsStore } from '@/stores/loanStatsStore'
import { useCreditStore } from '@/stores/creditStore'
import { getTierForScore, getGroupLabelForScore } from '@/lib/tiers'
import { reputationScore } from '@/lib/reputationScore'
import { MAX_CREDIT_LEVEL, MAX_SCORE } from '@/lib/constants'
import type { InformRepaymentResponse } from '@shared/types/api'

import IEVault from '@/contracts/IEVault.json'
import { ERC20_ABI } from '@/abi/erc20'

function formatHumanFromRaw(raw: bigint, decimals: number): string {
  return formatAmount(raw, decimals, 2)
}

function isNonRetryableStatus(err: unknown): boolean {
  return err instanceof ApiError && err.status >= 400 && err.status < 500
}

export function useRepay() {
  const { t } = useTranslation()

  const {
    evaultAddress,
    usdc,
    usdcAddress,
    usdcDecimals,
    connectedAddress,
    sendContractTx,
    sendBatchContractTx,
    refresh,
  } = useContracts()

  const { primaryWallet } = useWallet()

  const userAddress: string | null =
    connectedAddress ?? primaryWallet?.address ?? null

  const walletAddress: string | null = userAddress
    ? userAddress.toLowerCase()
    : null

  const {
    refreshLoanStats,
    setCreditScoreRaw,
    setCreditScoreRawHwm,
    setCreditScoreDisplay,
    setXp,
    setLatestAchievements,
  } = useBorrower()
  const setPendingRepGain = useGamificationStore((s) => s.setPendingRepGain)
  const api = useApi()

  const [submitting, setSubmitting] = React.useState(false)

  // Spec 028 — apply optimistic state updates as soon as the on-chain tx
  // confirms, without waiting for inform-repayment. The ladder is
  // deterministic and reputationScore is shared with the backend, so the
  // numbers we compute here will match what the backend produces. If the
  // backend's response later differs, refreshLoanStats() reconciles.
  //
  // The credit/limit values use the high-water-mark (HWM) pattern: useCreditLine
  // can't pisar them on its next 15s poll because the on-chain side hasn't
  // caught up yet. Once on-chain catches up (~15s with spec 029 priority queue,
  // or up to 10 min via chain-sync as safety net), the HWM auto-clears.
  const applyOptimisticOnTimeUpdate = React.useCallback(() => {
    const stats = useLoanStatsStore.getState()
    const prevOnTime = stats.loansOnTimeCount ?? 0
    const prevTotal = stats.loansCount ?? 0
    const prevClosed = stats.closedLoansCount ?? 0
    const credit = useCreditStore.getState()
    const prevScore = credit.creditScoreRaw ?? 0

    const nextOnTime = prevOnTime + 1
    const nextScore = Math.min(MAX_CREDIT_LEVEL, prevScore + 1)
    const nextTier = getTierForScore(nextScore)
    // Limit on the contract is stored in 6-decimal USDC base units.
    const nextLimitRaw = parseUnits(String(nextTier.limitUsdc), 6)

    // RepGain: same formula as backend
    const repDelta = Math.max(
      0,
      reputationScore(nextOnTime) - reputationScore(prevOnTime),
    )

    const oldGroup = getGroupLabelForScore(prevScore)
    const newGroup = getGroupLabelForScore(nextScore)

    // Counters: visible immediately. They're store-only (not on-chain), so
    // the only way they could be pushed back is via refreshLoanStats() with
    // stale backend data — useRefreshLoanStats now uses HWM setters to avoid
    // that.
    stats.setLoansOnTimeCount(nextOnTime)
    stats.setLoansCount(prevTotal + 1)
    stats.setClosedLoansCount(prevClosed + 1)

    // HWM: score floor + limit floor.
    // setOptimistic also updates creditScoreRaw immediately so the badge UI
    // reflects the new score even before useCreditLine's next poll.
    // TTL of 15 minutes covers the worst-case chain-sync cycle.
    credit.setOptimistic({
      scoreRaw: nextScore,
      limitRaw: nextLimitRaw,
      untilMs: Date.now() + 15 * 60 * 1000,
    })
    setCreditScoreDisplay(`${nextScore}/${MAX_SCORE}`)

    if (repDelta > 0) {
      setPendingRepGain({
        delta: repDelta,
        scoreChanged: nextScore !== prevScore,
        groupChanged: newGroup !== oldGroup,
        newGroupLabel: newGroup !== oldGroup ? newGroup : null,
        newScore: nextScore,
      })
    }
  }, [setCreditScoreDisplay, setPendingRepGain])

  const applyOptimisticLateUpdate = React.useCallback(() => {
    const stats = useLoanStatsStore.getState()
    const prevTotal = stats.loansCount ?? 0
    const prevClosed = stats.closedLoansCount ?? 0
    stats.setLoansCount(prevTotal + 1)
    stats.setClosedLoansCount(prevClosed + 1)
  }, [])

  const submit = React.useCallback(
    async (
      amountInput: string,
      rawOverride: bigint | null = null,
      opts?: { wasOnTime?: boolean },
    ) => {
      if (!amountInput && rawOverride == null) {
        toast.error(t('hooks.useRepay.validation.enterAmount'))
        return false
      }

      console.info('[useRepay] submit', {
        amountInput,
        rawOverride: rawOverride ? rawOverride.toString() : null,
        evaultAddress,
        hasUsdc: !!usdc,
        usdcAddress,
        usdcDecimals,
        userAddress,
      })

      if (!evaultAddress || !usdc || !usdcAddress || !userAddress) {
        toast.error(t('hooks.useRepay.toast.missingSetup.title'), {
          description: t('hooks.useRepay.toast.missingSetup.desc'),
        })
        console.error('[useRepay] missing setup', {
          evaultAddress,
          hasUsdc: !!usdc,
          usdcAddress,
          userAddress,
        })
        return false
      }

      const decimals =
        typeof usdcDecimals === 'number' ? usdcDecimals : DECIMALS

      let amount: bigint
      let amountHumanForBackend: string

      try {
        if (rawOverride != null) {
          amount = rawOverride
          amountHumanForBackend = formatHumanFromRaw(amount, decimals)
        } else {
          const cleaned = amountInput.trim().replace(/,/g, '')
          amount = parseUnits(cleaned, decimals)
          amountHumanForBackend = cleaned
        }

        if (amount <= 0n) {
          toast.error(t('hooks.useRepay.validation.greaterThanZero'))
          return false
        }
      } catch (e) {
        console.error('[useRepay] parse amount error', e)
        toast.error(t('hooks.useRepay.validation.invalidFormat'))
        return false
      }

      /** Returns true if backend sync succeeded, false otherwise */
      const informBackend = async (
        txHash: string | null,
        optimisticRepGainApplied: boolean,
      ): Promise<boolean> => {
        if (!walletAddress) return false

        // 1) Enqueue before calling backend
        const pending = addPending({
          walletAddress,
          amountPaidHuman: amountHumanForBackend,
          txHash,
        })

        try {
          console.log('[useRepay] inform-repayment →', walletAddress, {
            amountPaidHuman: amountHumanForBackend,
          })

          // 2) Retry with backoff — don't retry 4xx (business errors)
          const data: InformRepaymentResponse = await retryWithBackoff(
            () =>
              api.informRepayment({
                walletAddress,
                amountPaidHuman: amountHumanForBackend,
                txHash: txHash ?? undefined,
              }),
            {
              maxAttempts: 3,
              shouldRetry: (err) => !isNonRetryableStatus(err),
            },
          )

          console.log('[useRepay] inform-repayment ok', data)

          // 3) Success — remove from queue
          removePending(pending.id)

          if (data) {
            if (typeof data.score === 'number' && Number.isFinite(data.score)) {
              const s = Math.max(0, data.score)
              // Spec 028 — HWM: backend can equal or surpass the optimistic
              // floor (catch-up), but never silently demote it (e.g. stale
              // cached response). The HWM setter handles both cases.
              setCreditScoreRawHwm(s)
              setCreditScoreDisplay(String(s))
            }

            if (typeof data.xp === 'number' && Number.isFinite(data.xp)) {
              setXp(Math.max(0, data.xp))
            }

            const newAchievements = Array.isArray(data.newAchievements)
              ? data.newAchievements.filter((a) => a && typeof a.code === 'string')
              : []

            if (newAchievements.length > 0) {
              setLatestAchievements(newAchievements)
            }

            // Spec 023 — RepGain celebration. Populate even when an achievement
            // fires; AchievementDialog's priority rule keeps the catalog dialog
            // visible and silently consumes this when it closes.
            // Spec 028 — skip if we already showed it optimistically; otherwise
            // the dialog could re-open after the user already dismissed it.
            if (
              !optimisticRepGainApplied &&
              data.reputationGain &&
              data.reputationGain.delta > 0
            ) {
              setPendingRepGain(data.reputationGain)
            }
          }

          await refreshLoanStats(walletAddress)
          return true
        } catch (e) {
          console.error('[useRepay] inform-repayment error', e)

          // 404 = loan already processed — treat as success
          if (e instanceof ApiError && e.status === 404) {
            removePending(pending.id)
            await refreshLoanStats(walletAddress)
            return true
          }

          // Total failure — keep in queue for recovery
          updatePending(pending.id, {
            attempts: pending.attempts + 1,
            lastAttemptAt: Date.now(),
          })

          return false
        }
      }

      setSubmitting(true)
      const tLoading = toast.loading(t('hooks.useRepay.toast.submitting'))

      // Spec 033 — force materialize accrueLate BEFORE signing repay.
      // The user's autoRefresh + mount preflight calls are read-only
      // (lazy mode), so storage may be up to ~15s stale. The contract's
      // `repay(MaxUint256)` reads storage at tx-mine time, so we MUST
      // materialize first to ensure the contract pulls the same amount
      // the user saw on screen.
      //
      // We also use the post-materialize `accruedAmountDue` as the
      // authoritative target for balance + allowance checks, so the
      // user gets a precise local pre-check (instead of a chain revert
      // if their balance drifted below storage).
      let repayAmount: bigint = amount
      try {
        const preflightRes = await api.preflightRepayment(
          { walletAddress: userAddress },
          { force: true },
        )
        if (preflightRes.accruedAmountDue > 0n) {
          repayAmount = preflightRes.accruedAmountDue
        }
        console.info('[useRepay] preflight force=true ok', {
          requested: amount.toString(),
          materialized: preflightRes.accruedAmountDue.toString(),
          accrueLateCalled: preflightRes.accrueLateCalled,
        })
      } catch (e) {
        // SAFE FALLBACK: if the preflight materialize call fails (network
        // blip, BigInt parse error on a malformed response, RPC hiccup),
        // do NOT block the user. Continue with the amount they already see
        // on screen (`amount`, already set as `repayAmount` default above).
        //
        // For pre-grace loans (NOT yet past dueAt): no mora has accrued —
        // the screen amount is exactly correct.
        //
        // For post-grace loans: storage may be stale by a few seconds. The
        // contract reads its own storage at tx mine time, so worst case is
        // a clean revert ("underpaid"), which is far better UX than a hard
        // block that prevents any payment.
        console.warn(
          '[useRepay] preflight force=true failed — falling back to screen amount',
          { amount: amount.toString(), error: e },
        )
        // Show a non-blocking info toast so the user knows we proceeded.
        // The `||` fallback string fires only if the i18n key isn't defined
        // (which i18next would otherwise return as the raw key string).
        try {
          toast.info(
            t('hooks.useRepay.toast.preflightFailed.title') ||
              'No pudimos actualizar la deuda. Procedemos con el monto en pantalla.',
          )
        } catch {
          // toast may not have .info — fall back to default
        }
        // repayAmount stays as `amount` (user's screen value).
      }

      try {
        const bal: bigint = await (usdc as unknown as { balanceOf(addr: string): Promise<bigint> }).balanceOf(userAddress)

        if (bal < repayAmount) {
          const humanBal = formatHumanFromRaw(bal, decimals)
          const humanAmount = formatHumanFromRaw(repayAmount, decimals)

          toast.dismiss(tLoading)
          toast.error(t('hooks.useRepay.toast.insufficientBalance.title'), {
            description: t('hooks.useRepay.toast.insufficientBalance.desc', {
              humanBal,
              humanAmount,
            }),
          })

          console.warn('[useRepay] saldo insuficiente', {
            bal: bal.toString(),
            amount: repayAmount.toString(),
            decimals,
          })

          return false
        }

        const allowance: bigint = await (usdc as unknown as { allowance(owner: string, spender: string): Promise<bigint> }).allowance(
          userAddress,
          evaultAddress,
        )

        // Spec 024 B.1 — approve target = repayAmount + $0.01 penny buffer.
        // After spec 033 we use the post-materialize accruedAmountDue
        // (repayAmount) instead of the stale-on-mount `amount` so the
        // allowance is sized exactly to what the contract will pull.
        const allowanceTarget = repayAmount + PENNY_BUFFER_USDC_BASE

        // ---- Caso 1: approve + repay ----
        if (allowance < allowanceTarget) {
          console.info('[useRepay] allowance < target, batch approve+repay', {
            allowance: allowance.toString(),
            allowanceTarget: allowanceTarget.toString(),
            amount: amount.toString(),
          })

          const txs = [
            {
              contractAddress: usdcAddress,
              abi: ERC20_ABI,
              functionName: 'approve',
              functionParams: [evaultAddress, allowanceTarget.toString()],
              value: '0',
            },
            {
              contractAddress: evaultAddress,
              abi: (IEVault as { abi: unknown[] }).abi ?? IEVault,
              functionName: 'repay',
              // Spec 024 B.1 — MaxUint256 sentinel; contract reads its own
              // stored amountDue. See REPAY_AMOUNT_SENTINEL docblock.
              functionParams: [REPAY_AMOUNT_SENTINEL.toString(), userAddress],
              value: '0',
            },
          ]

          const hashes = await sendBatchContractTx(txs)
          const txHash = hashes[hashes.length - 1] ?? null

          if (!txHash) {
            console.warn('[useRepay] batch sin txHash esperado', hashes)
          }

          // Spec 028 — apply optimistic UI updates immediately. The on-chain
          // tx is confirmed at this point; we don't wait for the backend.
          let optimisticRepGain = false
          if (opts?.wasOnTime) {
            applyOptimisticOnTimeUpdate()
            optimisticRepGain = true
          } else {
            applyOptimisticLateUpdate()
          }

          // Spec 026: backend now verifies via tx receipt + LoanClosed event,
          // so we can call inform-repayment immediately. The receipt is
          // available on RPC within ~1-2s of mining; retry handles the rare
          // miss.
          const synced = await informBackend(txHash, optimisticRepGain)

          if (synced) {
            toast.success(t('hooks.useRepay.toast.confirmedBatch.title'), {
              description: t('hooks.useRepay.toast.confirmedBatch.desc'),
            })
          } else {
            // Spec: chain tx SUCCEEDED; backend reconciliation pending. From the
            // user's POV their payment was confirmed (that's what they care
            // about), so we show success (green). useRepaymentRecovery handles
            // the eventual backend sync silently.
            toast.success(t('hooks.useRepay.toast.syncPending.title'), {
              description: t('hooks.useRepay.toast.syncPending.desc'),
            })
          }

          await refresh?.()
          return true
        }

        // ---- Caso 2: sólo repay ----
        console.info('[useRepay] allowance OK, single repay tx', {
          amount: amount.toString(),
          allowance: allowance.toString(),
        })

        const txHash = await sendContractTx({
          contractAddress: evaultAddress,
          abi: (IEVault as { abi: unknown[] }).abi ?? IEVault,
          functionName: 'repay',
          // Spec 024 B.1 — MaxUint256 sentinel; contract reads its own
          // stored amountDue.
          functionParams: [REPAY_AMOUNT_SENTINEL.toString(), userAddress],
          value: '0',
        })

        // Spec 028 — optimistic update applied here too (single-tx path).
        let optimisticRepGainSingle = false
        if (opts?.wasOnTime) {
          applyOptimisticOnTimeUpdate()
          optimisticRepGainSingle = true
        } else {
          applyOptimisticLateUpdate()
        }

        // Spec 026: backend verifies via receipt; no artificial wait needed.
        const synced = await informBackend(txHash, optimisticRepGainSingle)

        if (synced) {
          toast.success(t('hooks.useRepay.toast.confirmed.title'), {
            description: t('hooks.useRepay.toast.confirmed.desc'),
          })
        } else {
          // Same rationale as the batch path above: chain tx confirmed,
          // backend sync is eventual. Show success (green) — the user's
          // action succeeded from their POV.
          toast.success(t('hooks.useRepay.toast.syncPending.title'), {
            description: t('hooks.useRepay.toast.syncPending.desc'),
          })
        }

        await refresh?.()
        return true
      } catch (e: unknown) {
        console.error('[useRepay] repay tx failed', e)
        toast.error(t('hooks.useRepay.toast.failed.title'))
        return false
      } finally {
        toast.dismiss(tLoading)
        setSubmitting(false)
      }
    },
    [
      evaultAddress,
      usdc,
      usdcAddress,
      usdcDecimals,
      userAddress,
      walletAddress,
      sendContractTx,
      sendBatchContractTx,
      refresh,
      api,
      refreshLoanStats,
      setCreditScoreRaw,
      setCreditScoreRawHwm,
      setCreditScoreDisplay,
      setXp,
      setLatestAchievements,
      applyOptimisticOnTimeUpdate,
      applyOptimisticLateUpdate,
      t,
    ],
  )

  return { submit, submitting }
}
