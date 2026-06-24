// hooks/useVaultApy15d.ts
import { useEffect, useMemo, useState } from "react"
import { fetchSubgraph } from "@/lib/fetchSubgraph"
import { LATEST_SNAPSHOT, PAST_SNAPSHOT } from "@/lib/queries"
import { SECONDS_PER_DAY, unixNow } from "@/lib/subgraph"
import {
  calcSharePrice,
  calcApyFromPrices,
  project30dFromApy,
} from "@/lib/apyMath"

type Snapshot = {
  blockTimestamp: string
  totalShares: string
  cash: string
  totalBorrows: string
}

type LatestData = { vaultStatusSnapshots: Snapshot[] }
type PastData = { vaultStatusSnapshots: Snapshot[] }

export function useVaultApy15d() {
  const [latest, setLatest] = useState<Snapshot | null>(null)
  const [past, setPast] = useState<Snapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true

    async function run() {
      try {
        setLoading(true)
        setError(null)

        const now = unixNow()
        const cutoff = String(now - 15 * SECONDS_PER_DAY)

        const [latestData, pastData] = await Promise.all([
          fetchSubgraph<LatestData>(LATEST_SNAPSHOT),
          fetchSubgraph<PastData>(PAST_SNAPSHOT(cutoff)),
        ])

        const latestSnap = latestData.vaultStatusSnapshots?.[0] ?? null
        const pastSnap = pastData.vaultStatusSnapshots?.[0] ?? null

        if (!alive) return
        setLatest(latestSnap)
        setPast(pastSnap)
      } catch (e: unknown) {
        if (!alive) return
        setError(e.message ?? "Unknown error")
      } finally {
        if (alive) setLoading(false)
      }
    }

    run()

    // refresco cada 5 min (ajustá a gusto)
    const id = setInterval(run, 5 * 60 * 1000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])

  const result = useMemo(() => {
    if (!latest || !past) {
      return {
        apy15d: null as number | null,
        expected30d: null as number | null,
        priceNow: null as number | null,
        pricePast: null as number | null,
        daysUsed: 15,
      }
    }

    const priceNow = calcSharePrice(latest)
    const pricePast = calcSharePrice(past)

    // Si el pool fuese más nuevo que 15d, podrías usar un fallback:
    // const daysUsed = Math.max(1, Math.floor((Number(latest.blockTimestamp) - Number(past.blockTimestamp)) / SECONDS_PER_DAY))
    const daysUsed = 15

    const apy15d = calcApyFromPrices(priceNow, pricePast, daysUsed)
    const expected30d = project30dFromApy(apy15d)

    return { apy15d, expected30d, priceNow, pricePast, daysUsed }
  }, [latest, past])

  return {
    ...result,
    latest,
    past,
    loading,
    error,
  }
}