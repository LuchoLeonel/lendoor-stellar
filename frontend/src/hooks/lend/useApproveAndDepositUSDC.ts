'use client'

import * as React from 'react'
import { parseUnits } from 'ethers'
import { toast } from 'sonner'

import { useContracts } from '@/providers/ContractsProvider'
import { DECIMALS } from '@/lib/utils'
import { useTranslation } from '@/i18n/useTranslation'

// ABIs (web mode); Lemon mode ignores ABIs for writes internally.
import { ERC20_ABI } from '@/abi/erc20'
import IEVault from '@/contracts/IEVault.json'

const _err = (e: unknown) => (e as Record<string, unknown>)?.shortMessage || (e as Record<string, unknown>)?.reason || (e as Record<string, unknown>)?.message || 'Transaction failed'

/** Small delay after Lemon tx so reads can catch up (no signer/receipt there). */
async function softWait(ms = 2500) {
  await new Promise((r) => setTimeout(r, ms))
}

/**
 * Approve + deposit USDC into EVault:
 * - Parses input amount (uses usdcDecimals if available; fallback DECIMALS)
 * - Checks wallet USDC balance
 * - Ensures allowance (USDC.approve(EVault, amount))
 * - Calls EVault.deposit(amount, receiver) via sendContractTx
 * - Advances journey from 'deposit_usdc' -> 'deposit_susdc' on success
 */
export function useApproveAndDepositUSDC() {
  const { t } = useTranslation()
  const {
    mode,
    evault,
    evaultAddress,
    usdc,
    usdcAddress,
    usdcDecimals,
    connectedAddress,
    sendContractTx,
    refresh,
  } = useContracts()

  const [submitting, setSubmitting] = React.useState(false)

  const submit = React.useCallback(
    async (amountInput: string) => {
      if (!amountInput) return false
      console.log('[useApproveAndDepositUSDC] contracts state', {
        usdc,
        usdcAddress,
        evault,
        evaultAddress,
        connectedAddress,
      })
      if (!usdc || !usdcAddress || !evault || !evaultAddress || !connectedAddress) {
        toast.error(t('common.lend.deposit.setupError'))
        return false
      }

      // Parse amount (prefer on-chain token decimals when available)
      const decimals = typeof usdcDecimals === 'number' ? usdcDecimals : DECIMALS
      let assets: bigint
      try {
        assets = parseUnits(amountInput.trim(), decimals)
        if (assets <= 0n) {
          toast.error(t('common.lend.deposit.greaterThanZero'))
          return false
        }
      } catch {
        toast.error(t('common.lend.deposit.invalidFormat'))
        return false
      }

      setSubmitting(true)
      const tLoading = toast.loading(t('common.lend.deposit.submitting'))

      try {
        // 1) Balance check
        const bal: bigint = await (usdc as unknown as { balanceOf(addr: string): Promise<bigint> }).balanceOf(connectedAddress)
        if (bal < assets) {
          toast.dismiss(tLoading)
          toast.error(t('common.lend.deposit.insufficientBalance'))
          return false
        }

        // 2) Allowance (approve if needed)
        const allowance: bigint = await (usdc as unknown as { allowance(owner: string, spender: string): Promise<bigint> }).allowance(connectedAddress, evaultAddress)
        if (allowance < assets) {
          await sendContractTx({
            contractAddress: usdcAddress,
            abi: ERC20_ABI,
            functionName: 'approve',
            functionParams: [evaultAddress, assets.toString()],
            value: '0',
          })
          if (mode === 'lemon') await softWait(2000)
          toast.success(t('common.lend.deposit.approvalConfirmed'))
        }

        // 3) Deposit into EVault
        await sendContractTx({
          contractAddress: evaultAddress,
          abi: (IEVault as { abi: unknown[] }).abi ?? IEVault,
          functionName: 'deposit',
          functionParams: [assets.toString(), connectedAddress],
          value: '0',
        })
        if (mode === 'lemon') await softWait(2500)

        toast.success(t('common.lend.deposit.confirmed'))

        await refresh?.()
        return true
      } catch (_e) {
        /* intentionally ignored */
        toast.error(t('common.lend.deposit.failed'))
        return false
      } finally {
        toast.dismiss(tLoading)
        setSubmitting(false)
      }
    },
    [
      mode,
      usdc,
      usdcAddress,
      evault,
      evaultAddress,
      connectedAddress,
      usdcDecimals,
      sendContractTx,
      refresh,
      t,
    ],
  )

  return { submit, submitting }
}