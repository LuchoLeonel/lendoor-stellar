// src/hooks/lend/useWithdrawUSDC.ts
'use client'

import * as React from 'react'
import { parseUnits } from 'ethers'
import { toast } from 'sonner'

import { useContracts } from '@/providers/ContractsProvider'
import { DECIMALS } from '@/lib/utils'
import { useVaultShares } from '@/hooks/lend/useVaultShares'
import { useVaultStats } from '@/hooks/lend/useVaultStats'
import { useTranslation } from '@/i18n/useTranslation'

import IEVault from '@/contracts/IEVault.json'

const _errMsg = (e: unknown) => (e as Record<string, unknown>)?.shortMessage || (e as Record<string, unknown>)?.reason || (e as Record<string, unknown>)?.message || 'Transaction failed'

async function softWait(ms = 2500) {
  await new Promise((r) => setTimeout(r, ms))
}

export function useWithdrawUSDC() {
  const { t } = useTranslation()
  const { evault, evaultAddress, connectedAddress, sendContractTx, refresh, mode } = useContracts()

  // usamos los mismos datos que el card de "Your shares"
  const { raw: userSharesRaw } = useVaultShares()
  const { sharePrice } = useVaultStats()

  const [submitting, setSubmitting] = React.useState(false)

  // shares UI (7.1306, etc)
  const SHARE_DECIMALS = 6
  const userSharesUi =
    userSharesRaw != null ? Number(userSharesRaw) / 10 ** SHARE_DECIMALS : 0

  // available en USDC aprox: shares * sharePrice
  const availableUi =
    userSharesRaw != null && sharePrice != null
      ? userSharesUi * sharePrice
      : 0

  const submit = React.useCallback(
    async (amountInput: string) => {
      const amt = amountInput?.trim()
      if (!amt) return false

      if (!evault || !evaultAddress || !connectedAddress) {
        toast.error(t('common.lend.withdraw.setupError'))
        return false
      }

      const want = Number(amt.replace(',', '.'))
      if (!Number.isFinite(want) || want <= 0) {
        toast.error(t('common.lend.withdraw.invalidAmount'))
        return false
      }

      // comparamos contra lo que tenemos disponible
      if (want > availableUi + 1e-6) {
        toast.error(t('common.lend.withdraw.insufficientBalance'))
        return false
      }

      setSubmitting(true)
      const tLoading = toast.loading(t('common.lend.withdraw.submitting'))

      try {
        // convertimos UI → asset units
        const assets = parseUnits(amt.replace(',', '.'), DECIMALS)

        await sendContractTx({
          contractAddress: evaultAddress,
          abi: (IEVault as { abi: unknown[] }).abi ?? IEVault,
          functionName: 'withdraw',
          functionParams: [assets.toString(), connectedAddress, connectedAddress],
          value: '0',
        })

        if (mode === 'lemon') await softWait(3000)

        toast.success(t('common.lend.withdraw.confirmed'))
        await refresh?.()

        return true
      } catch (_e) {
        toast.error(t('common.lend.withdraw.failed'))
        return false
      } finally {
        toast.dismiss(tLoading)
        setSubmitting(false)
      }
    },
    [evault, evaultAddress, connectedAddress, sendContractTx, mode, availableUi, refresh, t],
  )

  return { submit, submitting, availableUi }
}