// src/components/kpi/BackingTVV.tsx
'use client'

import * as React from 'react'
import { InfoTip } from '@/components/common/InfoTooltip'
import { useTranslation } from '@/i18n/useTranslation'

type BackingTVVKPIProps = {
  /** Valor a mostrar, ej: "10.4M" */
  value: string
  /** Label del KPI (por defecto i18n) */
  label?: string
  /** Contenido custom del tooltip (si no pasás, usa el default) */
  tooltipContent?: React.ReactNode
  /** Clases extra para el contenedor (ej: col-span) */
  containerClassName?: string
  /** Clases extra para el valor (color/tipografía) */
  valueClassName?: string
}

export function BackingTVVKPI({
  value,
  label,
  tooltipContent,
  containerClassName = 'col-span-2',
  valueClassName = '',
}: BackingTVVKPIProps) {
  const { t } = useTranslation()

  const effectiveLabel =
    label ?? t('kpi.backingTvv.label')

  const defaultTooltip = (
    <div>
      <div className="font-semibold">
        {t('kpi.backingTvv.tooltip.title')}
      </div>
      <ul className="mt-2 list-none pl-0 space-y-2 text-[11px] leading-snug">
        <li>{t('kpi.backingTvv.tooltip.line1')}</li>
        <li>{t('kpi.backingTvv.tooltip.line2')}</li>
        <li>{t('kpi.backingTvv.tooltip.line3')}</li>
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
        {value}
      </div>
    </div>
  )
}
