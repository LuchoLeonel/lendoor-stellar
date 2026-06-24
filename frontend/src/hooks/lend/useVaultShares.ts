'use client'

import * as React from 'react'
import { useContracts } from '@/providers/ContractsProvider'
import { safeRead } from '@/lib/safeRead'
import { formatAmount } from '@/lib/utils'

export function useVaultShares(pollMs: number = 10_000) {
  const { evault, connectedAddress, usdcDecimals } = useContracts()

  const [raw, setRaw] = React.useState<bigint | null>(null)
  const [display, setDisplay] = React.useState<string>('—')

  const [loading, setLoading] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState(false)

  const hasLoadedRef = React.useRef(false)

  const decimals = typeof usdcDecimals === 'number' ? usdcDecimals : 6

  const read = React.useCallback(async () => {
    if (!evault || !connectedAddress) {
      // ✅ acá sí es razonable limpiar si no hay wallet
      setRaw(null)
      setDisplay('—')
      setLoading(false)
      return
    }

    if (!hasLoadedRef.current) setLoading(true)
    else setRefreshing(true)

    try {
      const r: bigint = await safeRead(
        () => (evault as unknown as { balanceOf(addr: string): Promise<bigint> }).balanceOf(connectedAddress),
        0n,
        'vault:balanceOf',
      )

      setRaw(r)
      const pretty = formatAmount(r, decimals, 0, 4)
      setDisplay(pretty)

      hasLoadedRef.current = true
    } catch (e) {
      console.error('[useVaultShares] read error', e)
      // ✅ NO resetear en error → evita flicker
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [evault, connectedAddress, decimals])

  React.useEffect(() => {
    void read()
    if (!pollMs || pollMs <= 0) return
    const id = setInterval(() => void read(), pollMs)
    return () => clearInterval(id)
  }, [read, pollMs])

  return {
    raw,
    display,
    loading,
    refreshing,
    refresh: read,
  }
}