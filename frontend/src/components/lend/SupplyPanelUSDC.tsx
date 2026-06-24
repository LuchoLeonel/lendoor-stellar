// src/components/lend/SupplyPanelUSDC.tsx
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ChevronDown, ChevronUp, Info } from 'lucide-react'
import { InfoTip } from '@/components/common/InfoTooltip'
import { CenteredAmountInput } from '@/components/lend/CenteredAmountInput'
import { BackingTVVKPI } from '@/components/kpi/BackingTVV'
import { SrApyKPI } from '@/components/kpi/SrAPY'
import { SusdcBalanceKPI } from '@/components/kpi/sUSDCBalance'
import { useApproveAndDepositUSDC } from '@/hooks/lend/useApproveAndDepositUSDC'
import { useTranslation } from '@/i18n/useTranslation'
import { ConfirmationDialog } from '@/components/common/ConfirmationDialog'
import { TransactionProgress, TxState } from '@/components/common/TransactionProgress'
import * as React from 'react'

type SupplyPanelProps = {
  isLoggedIn: boolean
  loadingNetwork: boolean
  onConnect: () => void
  onSupply: (amount: string) => void
  // ej: "SUPPLY CAP $10.000" – si no viene, usamos una traducción por defecto
  supplyCapLabel?: string
}

export function SupplyPanelUSDC({
  isLoggedIn,
  loadingNetwork,
  onConnect,
  onSupply,
  supplyCapLabel,
}: SupplyPanelProps) {
  const [amount, setAmount] = useState('')
  const [isExpanded, setIsExpanded] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [txState, setTxState] = React.useState<TxState>('idle')
  const [txError, setTxError] = React.useState<string | undefined>(undefined)
  const { submit, submitting } = useApproveAndDepositUSDC()
  const { t } = useTranslation()

  const executeDeposit = async () => {
    if (!isLoggedIn) return onConnect()
    if (!amount) return
    setTxState('pending')
    setTxError(undefined)
    try {
      const ok = await submit(amount)
      if (ok) {
        setTxState('confirmed')
        onSupply?.(amount)
        setAmount('')
      } else {
        setTxState('failed')
      }
    } catch (err) {
      setTxState('failed')
      setTxError(err instanceof Error ? err.message : String(err))
    }
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!isLoggedIn) return onConnect()
    if (!amount) return
    setConfirmOpen(true)
  }

  const cta =
    !isLoggedIn && !loadingNetwork
      ? t('lend.supply.cta.connect')
      : t('lend.supply.cta.supply')
  const isDisabled = !amount || submitting

  const effectiveSupplyCapLabel =
    supplyCapLabel ?? t('lend.supply.supplyCapDefault', { amount: '$10.000' })

  return (
    <>
      <div className="grid grid-cols-4 gap-2 w-full mx-auto min-w-0">
        <SrApyKPI />
        <BackingTVVKPI value="10.4M" />
        <SusdcBalanceKPI />
      </div>

      <Card className="p-4 border-2 border-border/50">
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs text-muted-foreground font-mono">
            {t('lend.supply.headerEarnByLending')}
          </span>
        </div>

        <form onSubmit={onSubmit} className="w-full">
          <CenteredAmountInput value={amount} onChange={setAmount} />
          <div className="mt-1 mb-4 text-xs text-muted-foreground text-center">
            {effectiveSupplyCapLabel}
          </div>

          {/* botón full width */}
          <Button
            type="submit"
            disabled={isDisabled}
            className="mt-3 w-full bg-primary hover:bg-primary/90 text-primary-foreground py-3 cursor-pointer text-base font-semibold"
          >
            {cta}
          </Button>
        </form>

        <div className="space-y-2 mb-4">
          <div className="flex justify-between items-center">
            <span className="text-xs text-muted-foreground">
              {t('lend.supply.txCostLabel')}{' '}
              <InfoTip
                label={t('lend.supply.txCostTooltip')}
                variant="light"
              />
            </span>
            <span className="text-xs">-</span>
          </div>
        </div>

        {/* Collapsible Info */}
        <div className="border-top border-border pt-3">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center justify-between w-full text-left cursor-pointer min-h-[44px]"
          >
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-muted rounded flex items-center justify-center">
                <span className="text-xs">💧</span>
              </div>
              <span className="text-sm font-medium">
                {t('lend.supply.liquidityInfo.title')}
              </span>
            </div>
            {isExpanded ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </button>

          {isExpanded && (
            <div className="mt-3 space-y-3">
              <div className="text-xs font-medium text-muted-foreground">
                {t('lend.supply.liquidityInfo.assetsLabel')}
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs">
                    {t('lend.supply.liquidityInfo.assetsPair')}
                  </span>
                  <Info className="w-3 h-3 text-muted-foreground" />
                </div>
                <span className="text-xs">
                  {t('lend.supply.liquidityInfo.poolBacked')}
                </span>
              </div>
            </div>
          )}
        </div>
      </Card>

      <ConfirmationDialog
        open={confirmOpen}
        onConfirm={() => {
          setConfirmOpen(false)
          void executeDeposit()
        }}
        onCancel={() => setConfirmOpen(false)}
        title={t('common.confirmDialog.deposit.title')}
        description={t('common.confirmDialog.deposit.description')}
        details={[
          {
            label: t('common.confirmDialog.deposit.labelAmount'),
            value: `${amount} USDC`,
          },
        ]}
        confirmLabel={t('common.confirmDialog.deposit.confirm')}
        cancelLabel={t('common.confirmDialog.cancel')}
        confirming={submitting}
      />

      <TransactionProgress
        state={txState}
        errorMessage={txError}
        onDismiss={() => setTxState('idle')}
      />
    </>
  )
}
