'use client'

import * as React from 'react'

type Options = { pollMs?: number }

/**
 * Stub del exchange rate senior.
 * Antes leía convertToAssets() del EVault; ahora solo devuelve placeholders
 * para no disparar RPCs ni mostrar banners de error.
 */
export function useSeniorExchangeRate(_: Options = {}) {
  const [rate] = React.useState<number | null>(null)

  const display = '—'
  const loading = false

  const refresh = React.useCallback(async () => {
    // no-op por ahora
  }, [])

  return {
    rate,      // null
    display,   // "—"
    loading,   // false
    refresh,   // función vacía
  }
}