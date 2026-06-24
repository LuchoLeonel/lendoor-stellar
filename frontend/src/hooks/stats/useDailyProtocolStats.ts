'use client'

import { useEffect, useMemo, useState } from "react"
import { fetchSubgraph } from "@/lib/fetchSubgraph"
import { DAILY_PROTOCOL_STATS } from "@/lib/queries"
import { BACKEND_URL } from "@/lib/constants"

// Fall back to the backend's DB-computed daily series (spec 081) when the
// subgraph is unreachable or has stopped indexing. Same shape + raw-USDC units.
const FALLBACK_THRESHOLD_SEC = 60 * 60

type Daily = {
  id: string
  dayStart: string
  loansOriginated: string
  uniqueBorrowers: string
  principalOriginated: string
  principalRepaid: string
  interestRepaid: string
}

type Data = { dailyProtocolStats: Daily[] }

export function useDailyProtocolStats() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<Daily[]>([])

  useEffect(() => {
    let alive = true

    async function run() {
      try {
        setLoading(true)
        setError(null)

        let sg: Daily[] = []
        try {
          const data = await fetchSubgraph<Data>(DAILY_PROTOCOL_STATS)
          sg = data?.dailyProtocolStats ?? []
        } catch {
          sg = []
        }

        const now = Math.floor(Date.now() / 1000)
        const latestDay = sg.reduce(
          (m, d) => Math.max(m, Number(d.dayStart ?? 0)),
          0,
        )
        const stale = now - latestDay > 86400 + FALLBACK_THRESHOLD_SEC

        let series: Daily[] = sg
        if (sg.length > 0 && stale) {
          // Subgraph behind → COMPOSE: keep subgraph days BEFORE its last day,
          // then take the DB's complete days from that boundary onward (the
          // subgraph's last day may be partial, and newer days it never indexed).
          try {
            const res = await fetch(
              `${BACKEND_URL}/public-stats/daily-protocol-stats?after=${latestDay}`,
            )
            if (res.ok) {
              const dbDays = (await res.json())?.dailyProtocolStats
              if (Array.isArray(dbDays) && dbDays.length > 0) {
                series = [
                  ...sg.filter((d) => Number(d.dayStart) < latestDay),
                  ...(dbDays as Daily[]),
                ]
              }
            }
          } catch {
            // backend unreachable → keep subgraph series
          }
        } else if (sg.length === 0) {
          // Subgraph completely down → full DB series.
          try {
            const res = await fetch(
              `${BACKEND_URL}/public-stats/daily-protocol-stats`,
            )
            if (res.ok) {
              const dbDays = (await res.json())?.dailyProtocolStats
              if (Array.isArray(dbDays) && dbDays.length > 0) {
                series = dbDays as Daily[]
              }
            }
          } catch {
            // both down → empty
          }
        }

        if (!alive) return
        setItems(series)
      } catch (e: unknown) {
        if (!alive) return
        setError(e?.message ?? "Unknown error")
      } finally {
        if (alive) setLoading(false)
      }
    }

    run()
    return () => { alive = false }
  }, [])

  const hasData = useMemo(() => items.length > 0, [items])

  return { items, loading, error, hasData }
}