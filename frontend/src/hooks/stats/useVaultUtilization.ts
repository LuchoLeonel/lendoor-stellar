// hooks/lend/useVaultUtilization.ts
'use client'

import { useEffect, useMemo, useState } from "react"
import { fetchSubgraph } from "@/lib/fetchSubgraph"
import { LATEST_UTIL_SNAPSHOT } from "@/lib/queries"

type Snap = {
  cash: string
  totalBorrows: string
  blockTimestamp: string
}

type Data = { vaultStatusSnapshots: Snap[] }

export function useVaultUtilization() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [snap, setSnap] = useState<Snap | null>(null)

  useEffect(() => {
    let alive = true

    async function run() {
      try {
        setLoading(true)
        setError(null)

        const data = await fetchSubgraph<Data>(LATEST_UTIL_SNAPSHOT)
        const latest = data?.vaultStatusSnapshots?.[0] ?? null

        if (!alive) return
        setSnap(latest)
      } catch (e: unknown) {
        if (!alive) return
        setError(e?.message ?? "Unknown error")
      } finally {
        if (alive) setLoading(false)
      }
    }

    run()
    return () => {
      alive = false
    }
  }, [])

  const { utilizationPct, utilizationRatio, cashUsd, borrowsUsd } = useMemo(() => {
    if (!snap) {
      return {
        utilizationPct: null as number | null,
        utilizationRatio: null as number | null,
        cashUsd: null as number | null,
        borrowsUsd: null as number | null,
      }
    }

    // Subgraph values are in USDC base units (6 decimals) as strings.
    const cash = Number(snap.cash)
    const borrows = Number(snap.totalBorrows)
    const denom = cash + borrows

    // Spec 039 — surface raw USD amounts so VaultPanel can render Cash idle
    // and Total borrowed cards next to the existing utilization bar.
    const cashUsd = Number.isFinite(cash) ? cash / 1_000_000 : null
    const borrowsUsd = Number.isFinite(borrows) ? borrows / 1_000_000 : null

    if (!Number.isFinite(denom) || denom <= 0) {
      return { utilizationPct: 0, utilizationRatio: 0, cashUsd, borrowsUsd }
    }

    const ratio = borrows / denom
    const pct = Math.max(0, Math.min(100, ratio * 100))

    return { utilizationPct: pct, utilizationRatio: ratio, cashUsd, borrowsUsd }
  }, [snap])

  return {
    loading,
    error,
    snap,
    utilizationPct,
    utilizationRatio,
    cashUsd,
    borrowsUsd,
  }
}