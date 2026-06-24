// src/components/lend/CenteredAmountInput.tsx
'use client'

import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from '@/i18n/useTranslation'

type Props = {
  value: string
  onChange: (next: string) => void
  symbol?: string
  className?: string
}

export function CenteredAmountInput({
  value,
  onChange,
  symbol = '$',
  className,
}: Props) {
  const measureRef = useRef<HTMLSpanElement>(null)
  const [px, setPx] = useState<number>(0)
  const { t } = useTranslation()

  const display = useMemo(() => (value?.length ? value : '0'), [value])

  useLayoutEffect(() => {
    const el = measureRef.current
    if (!el) return
    // Small padding so the caret doesn’t clip
    setPx(el.offsetWidth + 4)
  }, [display])

  return (
    <div className="w-full">
      {/* Relative w-fit wrapper keeps the whole amount centered; absolute badge won’t affect centering */}
      <div className="relative mx-auto w-fit">
        {/* Inline content that actually defines the centered width */}
        <div className="flex w-fit items-baseline gap-1">
          <span className="text-4xl font-bold text-primary">{symbol}</span>

          {/* Input with width driven by hidden measurer */}
          <div className="relative">
            <input
              inputMode="decimal"
              placeholder={t('lend.centeredAmountInput.placeholder')}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              style={{ width: px ? `${px}px` : '3ch', maxWidth: 'calc(100vw - 6rem)' }}
              className={[
                'bg-transparent outline-none border-none text-4xl font-bold text-primary',
                'text-left placeholder:text-primary/50 [font-variant-numeric:tabular-nums]',
                className ?? '',
              ].join(' ')}
              aria-label={t('lend.centeredAmountInput.ariaLabel')}
            />
            {/* Invisible measurer (same typography as input) */}
            <span
              ref={measureRef}
              className="
                pointer-events-none absolute left-0 top-0 invisible whitespace-pre
                text-4xl font-bold [font-variant-numeric:tabular-nums]
              "
            >
              {display}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
