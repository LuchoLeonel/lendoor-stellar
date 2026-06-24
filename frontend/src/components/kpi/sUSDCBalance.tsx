// src/components/kpi/sUSDCBalance.tsx
'use client'

import * as React from 'react'
import { InfoTip } from '@/components/common/InfoTooltip'
import { useLender } from '@/providers/LenderProvider'
import { useTranslation } from '@/i18n/useTranslation'

type Props = {
  label?: string
  tokenSymbol?: string
  tooltipContent?: React.ReactNode
  containerClassName?: string
  valueClassName?: string
  pollMs?: number
}

export function SusdcBalanceKPI({
  label,
  tokenSymbol,
  tooltipContent,
  containerClassName = 'col-span-1',
  valueClassName = 'text-green-600',
}: Props) {
  const { susdcDisplay } = useLender()
  const { t } = useTranslation()

  const effectiveTokenSymbol =
    tokenSymbol ?? 'sUSDC'

  const effectiveLabel =
    label ?? t('kpi.susdcBalance.label', { token: effectiveTokenSymbol })

  const defaultTooltip = (
    <div>
      <div className="font-semibold">
        {t('kpi.susdcBalance.tooltip.title', {
          token: effectiveTokenSymbol,
        })}
      </div>
      <ul className="mt-2 list-none pl-0 space-y-2 text-[11px] leading-snug">
        <li>
          {t('kpi.susdcBalance.tooltip.line1', {
            token: effectiveTokenSymbol,
          })}
        </li>
        <li>{t('kpi.susdcBalance.tooltip.line2')}</li>
        <li>
          {t('kpi.susdcBalance.tooltip.line3', {
            token: effectiveTokenSymbol,
          })}
        </li>
        <li>{t('kpi.susdcBalance.tooltip.line4')}</li>
      </ul>
    </div>
  )

  return (
    <div
      className={`${containerClassName} h-14 px-3 py-1 rounded-lg border border-border/50 bg-card shadow-sm flex flex-col items-center justify-center`}
    >
      <div className="flex items-center justify-center gap-1 mb-2">
        <span className="text-xs text-muted-foreground">
          {effectiveLabel}
        </span>
        <InfoTip
          contentClassName="font-display text-[11px] leading-snug"
          label={tooltipContent ?? defaultTooltip}
        />
      </div>
      <div className={`text-sm font-bold leading-none ${valueClassName}`}>
        {susdcDisplay}
      </div>
    </div>
  )
}
