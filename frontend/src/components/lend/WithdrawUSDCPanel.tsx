// src/components/lend/WithdrawUSDCPanel.tsx
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { InfoTip } from '@/components/common/InfoTooltip'
import { CenteredAmountInput } from '@/components/lend/CenteredAmountInput'
import { AvailableToWithdrawKPI } from '@/components/kpi/AvailableToWithdraw'
import { SusdcBalanceKPI } from '@/components/kpi/sUSDCBalance'
import { USDCExchangeRateKPI } from '@/components/kpi/ExchangeRatesUSDC'
import { useWithdrawUSDC } from '@/hooks/lend/useWithdrawUSDC'
import { useLender } from '@/providers/LenderProvider'
import { useTranslation } from '@/i18n/useTranslation'
import { ConfirmationDialog } from '@/components/common/ConfirmationDialog'
import { TransactionProgress, TxState } from '@/components/common/TransactionProgress'
import * as React from 'react'

type WithdrawPanelProps = {
  isLoggedIn: boolean
  loadingNetwork: boolean
  onConnect: () => void
  onWithdraw: (amount: string) => void
  // ej: "AVAILABLE: $0" – si no viene, usamos traducción base
  availableLabel?: string
}

export function WithdrawUSDCPanel({
  isLoggedIn,
  loadingNetwork,
  onConnect,
  onWithdraw,
  availableLabel,
}: WithdrawPanelProps) {
  const [amount, setAmount] = useState('')
  const [isExpanded, setIsExpanded] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [txState, setTxState] = React.useState<TxState>('idle')
  const [txError, setTxError] = React.useState<string | undefined>(undefined)
  const { submit: submitWithdraw, submitting } = useWithdrawUSDC()
  const { seniorWithdrawAvailableDisplay: seniorAvail } = useLender()
  const { t } = useTranslation()

  const executeWithdraw = async () => {
    if (!isLoggedIn) return onConnect()
    if (!amount) return
    setTxState('pending')
    setTxError(undefined)
    try {
      const ok = await submitWithdraw(amount)
      if (ok) {
        setTxState('confirmed')
        onWithdraw?.(amount)
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
      ? t('lend.withdraw.cta.connect')
      : t('lend.withdraw.cta.withdraw')

  // Disable withdraw if amount empty or submitting
  const isDisabled = !amount || submitting

  const effectiveAvailableLabel =
    availableLabel ??
    t('lend.withdraw.availableDefault', { symbol: '$' })

  return (
    <>
      {/* KPIs */}
      <div className="grid grid-cols-4 gap-2 w-full mx-auto min-w-0">
        <USDCExchangeRateKPI />
        <AvailableToWithdrawKPI value={`${seniorAvail}`} />
        <SusdcBalanceKPI />
      </div>

      <Card className="p-4 border-2 border-border/50">
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs text-muted-foreground font-mono">
            {t('lend.withdraw.headerManageLiquidity')}
          </span>
        </div>

        <form onSubmit={onSubmit} className="w-full">
          <CenteredAmountInput value={amount} onChange={setAmount} />
          <div className="mt-1 mb-4 text-xs text-muted-foreground text-center">
            {effectiveAvailableLabel}
            {seniorAvail}
          </div>

          {/* botón full width */}
          <Button
            type="submit"
            disabled={isDisabled}
            className="mt-3 w-full bg-primary hover:bg-primary/90 text-primary-foreground py-3 cursor-pointer text-base font-semibold disabled:opacity-60"
          >
            {cta}
          </Button>
        </form>

        <div className="space-y-2 mb-4">
          <div className="flex justify-between items-center">
            <span className="text-xs text-muted-foreground">
              {t('lend.withdraw.txCostLabel')}{' '}
              <InfoTip
                label={t('lend.withdraw.txCostTooltip')}
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
                <span className="text-xs">🏦</span>
              </div>
              <span className="text-sm font-medium">
                {t('lend.withdraw.info.title')}
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
              <div className="text-xs text-muted-foreground">
                {t('lend.withdraw.info.body')}
              </div>
            </div>
          )}
        </div>
      </Card>

      <ConfirmationDialog
        open={confirmOpen}
        onConfirm={() => {
          setConfirmOpen(false)
          void executeWithdraw()
        }}
        onCancel={() => setConfirmOpen(false)}
        title={t('common.confirmDialog.withdraw.title')}
        description={t('common.confirmDialog.withdraw.description')}
        details={[
          {
            label: t('common.confirmDialog.withdraw.labelAmount'),
            value: `${amount} USDC`,
          },
        ]}
        confirmLabel={t('common.confirmDialog.withdraw.confirm')}
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
