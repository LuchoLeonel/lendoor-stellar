// src/components/kpi/ExchangeRatesUSDC.tsx
'use client'

import * as React from 'react'
import { InfoTip } from '@/components/common/InfoTooltip'
import { useLender } from '@/providers/LenderProvider'
import { useTranslation } from '@/i18n/useTranslation'

type Props = {
  label?: string
  baseSymbol?: string
  quoteSymbol?: string
  tooltipContent?: React.ReactNode
  containerClassName?: string
  valueClassName?: string
  pollMs?: number
  value?: string
}

export function USDCExchangeRateKPI({
  label,
  baseSymbol = 'sUSDC',
  quoteSymbol = 'USDC',
  tooltipContent,
  containerClassName = 'col-span-1',
  valueClassName = 'text-green-600',
}: Props) {
  const { seniorExchangeRateDisplay } = useLender()
  const { t } = useTranslation()

  const effectiveLabel =
    label ?? t('kpi.usdcRate.label', { base: baseSymbol, quote: quoteSymbol })

  const defaultTooltip = (
    <div>
      <div className="font-semibold">{effectiveLabel}</div>
      <ul className="mt-2 list-none pl-0 space-y-2 text-[11px] leading-snug">
        <li>{t('kpi.usdcRate.tooltip.line1')}</li>
        <li>
          {t('kpi.usdcRate.tooltip.line2', {
            base: baseSymbol,
            quote: quoteSymbol,
          })}
        </li>
        <li>{t('kpi.usdcRate.tooltip.line3')}</li>
      </ul>
    </div>
  )

  return (
    <div
      className={`${containerClassName} h-14 px-3 py-1 rounded-lg border border-border/50 bg-card shadow-sm flex flex-col items-center justify-center`}
    >
      <div className="flex items-center justify-center mb-2">
        <span className="text-xs text-muted-foreground">
          {effectiveLabel}
        </span>
        <InfoTip
          contentClassName="font-display text-[11px] leading-snug"
          label={tooltipContent ?? defaultTooltip}
        />
      </div>
      <div className={`text-sm font-bold leading-none ${valueClassName}`}>
        {seniorExchangeRateDisplay}
      </div>
    </div>
  )
}
