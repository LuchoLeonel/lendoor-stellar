// src/components/kpi/AvailableToWithdraw.tsx
'use client'

import * as React from 'react'
import { InfoTip } from '@/components/common/InfoTooltip'
import { useTranslation } from '@/i18n/useTranslation'

type AvailableToWithdrawKPIProps = {
  value: string
  label?: string
  tooltipContent?: React.ReactNode
  containerClassName?: string
  valueClassName?: string
}

export function AvailableToWithdrawKPI({
  value,
  label,
  tooltipContent,
  containerClassName = 'col-span-2',
  valueClassName = 'text-base font-bold',
}: AvailableToWithdrawKPIProps) {
  const { t } = useTranslation()

  const effectiveLabel =
    label ?? t('kpi.availableToWithdraw.label')

  const defaultTooltip = (
    <div>
      <div className="font-semibold">
        {t('kpi.availableToWithdraw.tooltip.title')}
      </div>
      <ul className="mt-2 list-none pl-0 space-y-2 text-[11px] leading-snug">
        <li>{t('kpi.availableToWithdraw.tooltip.line1')}</li>
        <li>{t('kpi.availableToWithdraw.tooltip.line2')}</li>
        <li>{t('kpi.availableToWithdraw.tooltip.line3')}</li>
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
      <div className={`leading-none ${valueClassName}`}>{value}</div>
    </div>
  )
}
