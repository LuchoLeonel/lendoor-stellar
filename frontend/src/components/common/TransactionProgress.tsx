// src/components/common/TransactionProgress.tsx
'use client'

import * as React from 'react'
import { Loader2, CheckCircle2, XCircle, X } from 'lucide-react'
import { useTranslation } from '@/i18n/useTranslation'

export type TxState = 'idle' | 'pending' | 'confirmed' | 'failed'

type Props = {
  state: TxState
  errorMessage?: string
  onDismiss: () => void
}

export function TransactionProgress({ state, errorMessage, onDismiss }: Props) {
  const { t } = useTranslation()

  const onDismissRef = React.useRef(onDismiss)
  onDismissRef.current = onDismiss

  React.useEffect(() => {
    if (state !== 'confirmed') return
    // Spec 034 — 4200ms (was 3500ms): more time to read on small
    // screens; matches the celebration's progress-bar fill animation
    // ratio (~3s fill + ~1.2s of "settled" before auto-dismiss).
    const id = setTimeout(() => onDismissRef.current(), 4200)
    return () => clearTimeout(id)
  }, [state])

  if (state === 'idle') return null

  // ---- CONFIRMED: fullscreen celebration ----
  if (state === 'confirmed') {
    return (
      <>
        <style>{`
          @keyframes celebrateFadeIn { from { opacity: 0; } to { opacity: 1; } }
          @keyframes celebrateBounce {
            0% { transform: scale(0.3); opacity: 0; }
            50% { transform: scale(1.1); opacity: 1; }
            70% { transform: scale(0.95); }
            100% { transform: scale(1); opacity: 1; }
          }
          @keyframes celebrateSlideUp {
            from { transform: translateY(12px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
          }
          @keyframes celebrateFill {
            from { width: 0%; }
            to { width: 100%; }
          }
          @keyframes celebratePulse {
            0% { transform: scale(1); opacity: 0.6; }
            100% { transform: scale(2.5); opacity: 0; }
          }
        `}</style>
        <div
          className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-white"
          style={{ animation: 'celebrateFadeIn 0.3s ease-out' }}
          onClick={onDismiss}
        >
          {/* Pulse ring behind check */}
          <div className="relative flex items-center justify-center mb-5">
            <div
              className="absolute h-20 w-20 rounded-full"
              style={{ backgroundColor: 'rgba(34,197,94,0.20)', animation: 'celebratePulse 2s ease-out infinite' }}
            />
            <div
              className="relative flex h-20 w-20 items-center justify-center rounded-full"
              style={{
                backgroundColor: 'rgba(34,197,94,0.10)',
                animation: 'celebrateBounce 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
              }}
            >
              <CheckCircle2 className="h-10 w-10 text-emerald-500" />
            </div>
          </div>

          <p
            className="text-[22px] font-bold text-foreground"
            style={{ animation: 'celebrateSlideUp 0.4s ease-out 0.3s both' }}
          >
            {t('txProgress.confirmed')}
          </p>

          <p
            className="mt-2 text-[14px] text-muted-foreground"
            style={{ animation: 'celebrateSlideUp 0.4s ease-out 0.5s both' }}
          >
            {t('txProgress.confirmedSubtitle')}
          </p>

          {/* Progress bar */}
          <div
            className="mt-6"
            style={{ animation: 'celebrateSlideUp 0.4s ease-out 0.7s both' }}
          >
            <div className="h-1 w-16 rounded-full bg-emerald-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-emerald-500"
                style={{ animation: 'celebrateFill 3s linear 0.7s both' }}
              />
            </div>
          </div>
        </div>
      </>
    )
  }

  // ---- PENDING: bottom toast ----
  if (state === 'pending') {
    return (
      <div
        style={{ bottom: 'calc(var(--tab-bar-h, 60px) + 12px)', animation: 'celebrateSlideUp 0.2s ease-out' }}
        className="fixed left-1/2 z-[60] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-2xl border shadow-lg"
        role="status"
      >
        <style>{`@keyframes celebrateSlideUp { from { transform: translateY(12px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`}</style>
        <div className="flex items-center gap-3 rounded-2xl border-orange-200 bg-orange-50 px-4 py-3.5">
          <Loader2 className="h-5 w-5 shrink-0 animate-spin text-orange-500" />
          <p className="text-sm font-medium text-orange-800">
            {t('txProgress.pending')}
          </p>
        </div>
      </div>
    )
  }

  // ---- FAILED: bottom toast ----
  return (
    <div
      style={{ bottom: 'calc(var(--tab-bar-h, 60px) + 12px)', animation: 'celebrateSlideUp 0.2s ease-out' }}
      className="fixed left-1/2 z-[60] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-2xl border shadow-lg"
      role="status"
    >
      <style>{`@keyframes celebrateSlideUp { from { transform: translateY(12px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`}</style>
      <div className="flex items-start gap-3 rounded-2xl border-red-200 bg-red-50 px-4 py-3.5">
        <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-red-800">{t('txProgress.failed')}</p>
          {errorMessage && <p className="mt-0.5 truncate text-xs text-red-600">{errorMessage}</p>}
        </div>
        <button type="button" onClick={onDismiss} className="ml-1 shrink-0 rounded-full p-2 min-h-[44px] min-w-[44px] flex items-center justify-center text-red-500 hover:bg-red-100">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
