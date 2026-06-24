// src/components/kpi/SrAPY.tsx
'use client'

import { InfoTip } from '@/components/common/InfoTooltip'
import { useLender } from '@/providers/LenderProvider'
import { useTranslation } from '@/i18n/useTranslation'

type Props = {
  label?: string
  tokenLabel?: string
  tooltipContent?: React.ReactNode
  containerClassName?: string
  valueClassName?: string
  pollMs?: number
  irmAddress?: `0x${string}` | null
}

export function SrApyKPI({
  label,
  tokenLabel,
  tooltipContent,
  containerClassName = 'col-span-1',
  valueClassName = 'text-green-600',
}: Props) {
  const { seniorApyDisplay } = useLender()
  const { t } = useTranslation()

  const effectiveTokenLabel =
    tokenLabel ?? t('kpi.srApy.tokenLabel')

  const effectiveLabel =
    label ?? t('kpi.srApy.label')

  const defaultTooltip = (
    <div>
      <div className="font-semibold">
        {t('kpi.srApy.tooltip.title', { tokenLabel: effectiveTokenLabel })}
      </div>
      <ul className="mt-2 list-none pl-0 space-y-2 text-[11px] leading-snug">
        <li>{t('kpi.srApy.tooltip.line1')}</li>
        <li>{t('kpi.srApy.tooltip.line2')}</li>
        <li>{t('kpi.srApy.tooltip.line3')}</li>
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
        {seniorApyDisplay ?? '—'}
      </div>
    </div>
  )
}
