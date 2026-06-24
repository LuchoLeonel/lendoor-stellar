import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { fetchSubgraph } from "@/lib/fetchSubgraph"
import { VAULT_ACTIVITIES } from "@/lib/queries"

type Activity = {
    id: string
    type: "DEPOSIT" | "WITHDRAW" | string
    account: string
    assets: string
    shares?: string | null
    blockTimestamp: string
    txHash: string
  }

type ActivitiesData = { vaultActivities: Activity[] }

const STEP = 20
const INITIAL = 20
const MAX_SAFE = 200

export function useVaultActivities(refreshSignal?: number) {
  const [items, setItems] = useState<Activity[]>([])
  const [limit, setLimit] = useState(INITIAL)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // para saber si es el primer fetch real
  const didFirstLoad = useRef(false)

  const run = useCallback(async (currentLimit: number, isMore = false) => {
    try {
      if (isMore) setLoadingMore(true)
      else setLoading(true)

      setError(null)

      const data = await fetchSubgraph<ActivitiesData>(
        VAULT_ACTIVITIES(currentLimit)
      )

      const next = data.vaultActivities ?? []

      setItems((prev) => {
        if (!isMore || !prev.length) return next

        // merge + dedupe por id
        const map = new Map<string, Activity>()
        for (const p of prev) map.set(p.id, p)
        for (const n of next) map.set(n.id, n)

        // mantenemos orden desc por blockTimestamp
        return Array.from(map.values()).sort(
          (a, b) => Number(b.blockTimestamp) - Number(a.blockTimestamp)
        )
      })

      didFirstLoad.current = true
    } catch (e: unknown) {
      setError(e?.message ?? "Unknown error")
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [])

  useEffect(() => {
    const isMore = limit !== INITIAL && didFirstLoad.current
    run(limit, isMore)
  }, [limit, refreshSignal, run])

  const loadMore = useCallback(() => {
    setLimit((prev) => {
      const next = Math.min(prev + STEP, MAX_SAFE)
      return next === prev ? prev : next
    })
  }, [])

  const refetch = useCallback(() => {
    run(limit, false)
  }, [limit, run])

  // hasMore más realista:
  const hasMore = useMemo(() => {
    if (limit >= MAX_SAFE) return false
    // si The Graph devolvió menos que el límite pedido, probablemente ya no hay más
    return items.length >= limit
  }, [items.length, limit])

  return {
    items,
    loading,
    loadingMore,
    error,
    limit,
    hasMore,
    loadMore,
    refetch,
  }
}