'use client'

import { useEffect, useState, useCallback, useRef } from "react"
import { fetchSubgraph } from "@/lib/fetchSubgraph"
import { LATEST_LOAN_ACTIVITIES } from "@/lib/queries"
import { BACKEND_URL } from "@/lib/constants"

type Activity = {
  id: string
  type: "OPEN" | "CLOSE"
  borrower: string
  principal?: string | null
  amountDue?: string | null
  paid?: string | null
  interest?: string | null
  blockTimestamp: string
  txHash: string
}

// Spec 081 — subgraph fallback. If the subgraph's last indexed block is more
// than this many seconds behind real time, also fetch from the backend to fill
// the gap. Set to 1h: shorter triggers backend even on minor delays; longer
// leaves users staring at stale activity for too long.
const FALLBACK_THRESHOLD_SEC = 60 * 60

type SubgraphResp = {
  loanActivities: Activity[]
  _meta?: { block?: { timestamp?: string } }
}

const LATEST_WITH_META = LATEST_LOAN_ACTIVITIES.replace(
  "loanActivities(",
  "_meta { block { timestamp } } loanActivities(",
)

async function fetchBackendFallback(
  afterTs: number,
  first: number,
  skip: number,
): Promise<Activity[]> {
  const url = `${BACKEND_URL}/public-stats/recent-loan-activities?after=${afterTs}&first=${first}&skip=${skip}`
  const res = await fetch(url)
  if (!res.ok) return []
  const json = await res.json()
  return (json?.loanActivities ?? []) as Activity[]
}

function dedupeByTxHash(items: Activity[]): Activity[] {
  const seen = new Set<string>()
  const out: Activity[] = []
  for (const it of items) {
    // Same physical event = same (type, txHash). Two different events can share
    // a txHash only when an open and a close land in the same tx, which is
    // why we key on type too.
    const key = `${it.type}:${it.txHash}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(it)
  }
  return out
}

export function useLoanActivities(refreshSignal?: number) {
  const [items, setItems] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [skip, setSkip] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  // Backend fallback paginates on its OWN cursor — it advances by how many backend
  // rows we've already shown, NOT by the subgraph's count. A stale subgraph returns
  // 0 rows, so keying the backend skip to the subgraph (the old bug) pinned it at
  // skip=0 and re-fetched the same page forever → "loads and loads, nothing new".
  const backendSkipRef = useRef(0)

  const PAGE = 10

  const load = useCallback(async (reset = false) => {
    try {
      if (reset) setLoading(true); else setLoadingMore(true)
      setError(null)

      const nextSkip = reset ? 0 : skip
      const backendSkip = reset ? 0 : backendSkipRef.current

      const data = await fetchSubgraph<SubgraphResp>(
        LATEST_WITH_META,
        { first: PAGE, skip: nextSkip },
      )

      const subgraphItems = data?.loanActivities ?? []
      const subgraphLastTs = Number(data?._meta?.block?.timestamp ?? 0)
      const now = Math.floor(Date.now() / 1000)
      const subgraphLag = subgraphLastTs > 0 ? now - subgraphLastTs : 0
      const fallbackActive = subgraphLag > FALLBACK_THRESHOLD_SEC && subgraphLastTs > 0

      let merged: Activity[] = subgraphItems
      let backendCount = 0

      // Only consult the backend when the subgraph is materially behind real
      // time. When the subgraph catches up, this branch never fires and the
      // hook behaves exactly like before.
      if (fallbackActive) {
        // Ask backend for events AFTER the subgraph's last known block, using
        // the backend's own advancing cursor so each page yields NEW rows.
        const backendItems = await fetchBackendFallback(
          subgraphLastTs,
          PAGE,
          backendSkip,
        )
        backendCount = backendItems.length
        backendSkipRef.current = backendSkip + backendItems.length

        // Merge: backend rows (newer, > lastTs) first, then subgraph rows
        // (<= lastTs). Dedupe by (type, txHash) for the brief window where the
        // DB marks a close before the chain confirms and both carry it.
        merged = dedupeByTxHash([...backendItems, ...subgraphItems])
          .sort((a, b) => Number(b.blockTimestamp) - Number(a.blockTimestamp))
          .slice(0, PAGE)
      }

      if (reset) setItems(merged)
      else setItems(prev => dedupeByTxHash([...prev, ...merged]))

      setSkip(nextSkip + subgraphItems.length)
      // More rows exist while EITHER source still fills a full page. In fallback
      // mode we walk the backend's after-lastTs gap first, then the subgraph history.
      setHasMore(
        fallbackActive
          ? backendCount === PAGE || subgraphItems.length === PAGE
          : subgraphItems.length === PAGE,
      )
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error"
      setError(msg)
    } finally {
      if (reset) setLoading(false); else setLoadingMore(false)
    }
  }, [skip])

  useEffect(() => {
    setSkip(0)
    setHasMore(true)
    backendSkipRef.current = 0
    load(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal])

  const loadMore = () => {
    if (!hasMore || loading || loadingMore) return
    load(false)
  }

  return { items, loading, loadingMore, error, hasMore, loadMore }
}
