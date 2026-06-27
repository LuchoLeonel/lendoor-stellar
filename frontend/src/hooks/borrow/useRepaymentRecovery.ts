import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useAccount } from 'wagmi'

import { useTranslation } from '@/i18n/useTranslation'
import { useApi } from '@/hooks/useApi'
import { useBorrower } from '@/providers/BorrowerProvider'
import { useWallet } from '@/providers/WalletProvider'
import { ApiError } from '@/lib/api'
import { normalizeWalletAddress } from '@/lib/wallet-address'
import { retryWithBackoff } from '@/lib/retryWithBackoff'
import {
  clearStale,
  getPendingForWallet,
  removePending,
  updatePending,
} from '@/lib/repaymentQueue'
import {
  clearStaleLoanOpens,
  getPendingOpensForWallet,
  removePendingOpen,
  updatePendingOpen,
} from '@/lib/loanOpenQueue'
import { useGamificationStore } from '@/stores/gamificationStore'

const MAX_ATTEMPTS_BEFORE_WARNING = 15

function isNonRetryableStatus(err: unknown): boolean {
  return err instanceof ApiError && err.status >= 400 && err.status < 500
}

export function useRepaymentRecovery(): void {
  const { address } = useAccount()
  const { mode, primaryWallet } = useWallet()
  const walletAddress = normalizeWalletAddress(
    mode === 'stellar' ? primaryWallet?.address : address,
    mode,
  )

  const { t } = useTranslation()
  const api = useApi()
  const {
    refreshLoanStats,
    setCreditScoreRaw,
    setCreditScoreRawHwm,
    setCreditScoreDisplay,
    setXp,
    setLatestAchievements,
  } = useBorrower()
  const setPendingRepGain = useGamificationStore((s) => s.setPendingRepGain)

  const runningRef = useRef(false)

  useEffect(() => {
    if (!walletAddress) return
    if (runningRef.current) return
    runningRef.current = true

    const run = async () => {
      try {
        // --- Recover pending repayments ---
        clearStale()

        const pendingRepayments = getPendingForWallet(walletAddress)
        const sortedRepayments = [...pendingRepayments].sort((a, b) => a.createdAt - b.createdAt)

        for (const entry of sortedRepayments) {
          try {
            const data = await retryWithBackoff(
              () =>
                api.informRepayment({
                  walletAddress: entry.walletAddress,
                  amountPaidHuman: entry.amountPaidHuman,
                  txHash: entry.txHash ?? undefined,
                }),
              {
                maxAttempts: 3,
                shouldRetry: (err) => !isNonRetryableStatus(err),
              },
            )

            removePending(entry.id)

            if (data) {
              if (typeof data.score === 'number' && Number.isFinite(data.score)) {
                const s = Math.max(0, data.score)
                // Spec 028 — HWM (same as useRepay): the recovery path may
                // come back later with a stale value if the user already
                // saw the optimistic update. The HWM setter prevents that
                // from rolling back the visible score.
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

              // Spec 023 — surface the reputation-points celebration even on
              // the recovery path so a user who completed the chain tx while
              // the frontend was offline still sees the dialog next session.
              if (data.reputationGain && data.reputationGain.delta > 0) {
                setPendingRepGain(data.reputationGain)
              }
            }

            toast.success(t('hooks.useRepay.toast.syncRecovered.title'), {
              description: t('hooks.useRepay.toast.syncRecovered.desc'),
            })

            await refreshLoanStats(walletAddress)
          } catch (e) {
            if (e instanceof ApiError && e.status === 404) {
              removePending(entry.id)
              await refreshLoanStats(walletAddress)
              continue
            }

            const newAttempts = entry.attempts + 1
            updatePending(entry.id, {
              attempts: newAttempts,
              lastAttemptAt: Date.now(),
            })

            if (newAttempts >= MAX_ATTEMPTS_BEFORE_WARNING) {
              toast.warning(t('hooks.useRepay.toast.syncFailed.title'), {
                description: t('hooks.useRepay.toast.syncFailed.desc'),
                duration: Infinity,
              })
            }

            console.error('[useRepaymentRecovery] failed to sync pending repayment', entry.id, e)
          }
        }

        // --- Recover pending loan opens ---
        clearStaleLoanOpens()

        const pendingOpens = getPendingOpensForWallet(walletAddress)
        const sortedOpens = [...pendingOpens].sort((a, b) => a.createdAt - b.createdAt)

        for (const entry of sortedOpens) {
          try {
            await retryWithBackoff(
              () =>
                api.informOpen({
                  walletAddress: entry.walletAddress,
                  amountHuman: entry.amountHuman,
                  tenorDays: entry.tenorDays,
                  txHash: entry.txHash ?? undefined,
                }),
              {
                maxAttempts: 3,
                shouldRetry: (err) => !isNonRetryableStatus(err),
              },
            )

            removePendingOpen(entry.id)

            toast.success(t('hooks.useBorrow.toast.syncRecovered.title'), {
              description: t('hooks.useBorrow.toast.syncRecovered.desc'),
            })

            await refreshLoanStats(walletAddress)
          } catch (e) {
            const newAttempts = entry.attempts + 1
            updatePendingOpen(entry.id, {
              attempts: newAttempts,
              lastAttemptAt: Date.now(),
            })

            console.error('[useRepaymentRecovery] failed to sync pending loan open', entry.id, e)
          }
        }
      } finally {
        runningRef.current = false
      }
    }

    run()
  }, [
    walletAddress,
    api,
    refreshLoanStats,
    setCreditScoreRaw,
    setCreditScoreRawHwm,
    setCreditScoreDisplay,
    setXp,
    setLatestAchievements,
    t,
  ])
}
