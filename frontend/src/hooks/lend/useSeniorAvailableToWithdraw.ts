'use client'

import * as React from 'react'

type Options = { pollMs?: number }

type Diagnosis = 'ok' | 'no-liquidity-or-balance' | 'unknown'

/**
 * Hook stub: antes leía maxWithdraw del EVault senior.
 * Ahora está desactivado y solo devuelve placeholders para no disparar RPCs
 * ni mostrar banners de error mientras no usemos tranches/senior.
 */
export function useSeniorAvailableToWithdraw(_: Options = {}) {
  const [diagnosis] = React.useState<Diagnosis>('unknown')

  return {
    rawUSDC: null as bigint | null,
    uiAmount: null as number | null,
    decimals: 6,
    display: '—',            // antes: "X.XX USDC"
    loading: false,
    refresh: async () => {}, // no hace nada por ahora
    diagnosis,
  }
}