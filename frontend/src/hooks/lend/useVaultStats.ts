'use client'

import * as React from 'react'
import { Contract, formatUnits } from 'ethers'
import { useContracts } from '@/providers/ContractsProvider'
import { safeRead } from '@/lib/safeRead'
import { formatAmount } from '@/lib/utils'

const EVAULT_ABI = [
  'function totalAssets() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function decimals() view returns (uint8)',
] as const

type Options = { pollMs?: number }

type VaultStats = {
  totalAssetsRaw: bigint | null
  totalSharesRaw: bigint | null
  totalAssetsDisplay: string
  sharePrice: number | null
  sharePriceDisplay: string
  loading: boolean           // ✅ solo para primera carga
  refreshing: boolean        // ✅ opcional, por si querés mostrar algo sutil
  refresh: () => Promise<void>
}

export function useVaultStats({ pollMs = 30_000 }: Options = {}): VaultStats {
  const { evault, evaultAddress, usdcDecimals } = useContracts()

  const [totalAssetsRaw, setTotalAssetsRaw] = React.useState<bigint | null>(null)
  const [totalSharesRaw, setTotalSharesRaw] = React.useState<bigint | null>(null)
  const [sharePrice, setSharePrice] = React.useState<number | null>(null)

  const [loading, setLoading] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState(false)

  const hasLoadedRef = React.useRef(false)

  const runner = React.useMemo(
    () => (evault as unknown as Record<string, unknown>)?.runner ?? (evault as unknown as Record<string, unknown>)?.provider ?? null,
    [evault],
  )

  const read = React.useCallback(async () => {
    if (!evaultAddress || !runner) return

    // ✅ solo mostramos loading duro la 1ra vez
    if (!hasLoadedRef.current) setLoading(true)
    else setRefreshing(true)

    try {
      const v = new Contract(evaultAddress, EVAULT_ABI as unknown as ethers.InterfaceAbi, runner)

      const assets: bigint = await safeRead(
        () => v.totalAssets(),
        0n,
        'vault:totalAssets',
      )

      const shares: bigint = await safeRead(
        () => v.totalSupply(),
        0n,
        'vault:totalSupply',
      )

      setTotalAssetsRaw(assets)
      setTotalSharesRaw(shares)

      const assetDec = typeof usdcDecimals === 'number' ? usdcDecimals : 6

      // ⚠️ si tus shares NO tienen los mismos decimales que USDC,
      // acá convendría leer decimals() del vault.
      if (shares > 0n) {
        const assetsNum = Number(formatUnits(assets, assetDec))
        const sharesNum = Number(formatUnits(shares, assetDec))
        const price = assetsNum / sharesNum
        setSharePrice(Number.isFinite(price) ? price : null)
      } else {
        setSharePrice(null)
      }

      hasLoadedRef.current = true
    } catch (e) {
      console.error('[useVaultStats] read error', e)
      // ✅ NO resetees a null acá (evita flicker)
      // mantené el último valor válido
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [evaultAddress, runner, usdcDecimals])

  React.useEffect(() => {
    void read()
  }, [read])

  React.useEffect(() => {
    if (!pollMs || pollMs <= 0) return
    const id = setInterval(() => void read(), pollMs)
    return () => clearInterval(id)
  }, [pollMs, read])

  const assetDec = typeof usdcDecimals === 'number' ? usdcDecimals : 6

  const totalAssetsDisplay =
    totalAssetsRaw == null
      ? '—'
      : formatAmount(totalAssetsRaw, assetDec, 2, 2)

  const sharePriceDisplay =
    sharePrice == null
      ? '—'
      : new Intl.NumberFormat(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 4,
        }).format(sharePrice)

  return {
    totalAssetsRaw,
    totalSharesRaw,
    totalAssetsDisplay,
    sharePrice,
    sharePriceDisplay,
    loading,
    refreshing,
    refresh: read,
  }
}