'use client'

import { useEffect, useState } from "react"
import { fetchSubgraph } from "@/lib/fetchSubgraph"
import { PROTOCOL_STAT_QUERY } from "@/lib/queries"
import { BACKEND_URL } from "@/lib/constants"

// If the subgraph is unreachable (rate-limited) or its protocolStat is more than
// this stale, fall back to the backend's DB-computed equivalent (spec 081). The
// backend returns the identical subgraph shape + raw-USDC units.
const FALLBACK_THRESHOLD_SEC = 60 * 60

type ProtocolStat = {
  loansOriginated: string
  uniqueBorrowers: string
  principalOriginated: string
  principalRepaid: string
  interestRepaid: string
  lastUpdated: string
}

type Data = {
  protocolStat: ProtocolStat | null
}

export function useProtocolStat() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stat, setStat] = useState<ProtocolStat | null>(null)

  useEffect(() => {
    let alive = true

    async function run() {
      try {
        setLoading(true)
        setError(null)

        let sg: ProtocolStat | null = null
        try {
          const data = await fetchSubgraph<Data>(PROTOCOL_STAT_QUERY)
          sg = data?.protocolStat ?? null
        } catch {
          sg = null
        }

        const now = Math.floor(Date.now() / 1000)
        const lag = sg
          ? now - Number(sg.lastUpdated ?? 0)
          : Number.POSITIVE_INFINITY

        let next: ProtocolStat | null = sg
        if (sg && lag > FALLBACK_THRESHOLD_SEC) {
          // Subgraph stale but responding → COMPOSE: subgraph base + the DB's
          // delta AFTER the subgraph's last update. Never replace the whole
          // value (the DB and subgraph disagree by the DB↔chain drift, which
          // made the number jump down). Composing stays monotonic.
          try {
            const res = await fetch(
              `${BACKEND_URL}/public-stats/protocol-stat?after=${sg.lastUpdated}`,
            )
            if (res.ok) {
              const d = (await res.json())?.protocolStat
              if (d) {
                const add = (a: string, b: string) =>
                  String(Number(a ?? 0) + Number(b ?? 0))
                next = {
                  loansOriginated: add(sg.loansOriginated, d.loansOriginated),
                  uniqueBorrowers: add(sg.uniqueBorrowers, d.uniqueBorrowers),
                  principalOriginated: add(
                    sg.principalOriginated,
                    d.principalOriginated,
                  ),
                  principalRepaid: add(sg.principalRepaid, d.principalRepaid),
                  interestRepaid: add(sg.interestRepaid, d.interestRepaid),
                  lastUpdated: String(now),
                }
              }
            }
          } catch {
            // backend unreachable → keep the subgraph base as-is
          }
        } else if (!sg) {
          // Subgraph completely down → no base to compose onto, use the DB's
          // full cumulative (after=0).
          try {
            const res = await fetch(`${BACKEND_URL}/public-stats/protocol-stat`)
            if (res.ok) {
              const d = (await res.json())?.protocolStat
              if (d) next = d as ProtocolStat
            }
          } catch {
            // both sources down → leave null
          }
        }

        if (!alive) return
        setStat(next)
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

  return { loading, error, stat }
}