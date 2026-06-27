'use client'

import * as React from "react"
import { useLoanActivities } from "@/hooks/stats/useLoanActivities"
import { UsdcIcon } from "@/components/icons/UsdcIcon"
import { formatUsdcFromBigIntString } from "@/lib/format"
import { transactionExplorerUrl } from "@/lib/utils"
import { useWallet } from "@/providers/WalletProvider"

function timeAgo(tsSec: number) {
  const now = Math.floor(Date.now() / 1000)
  const diff = Math.max(0, now - tsSec)

  if (diff < 60) return `hace ${diff}s`
  const mins = Math.floor(diff / 60)
  if (mins < 60) return `hace ${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `hace ${hrs}h`
  const days = Math.floor(hrs / 24)
  return `hace ${days}d`
}

function shortAddr(a: string) {
  if (!a) return "—"
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

type Props = {
  refreshSignal?: number
  maxHeight?: number
}

type LoanActivity = {
  id: string
  type: "OPEN" | "CLOSE" | "DEFAULT"
  borrower: string
  principal?: string | null
  amountDue?: string | null
  paid?: string | null
  interest?: string | null
  blockTimestamp: string
  txHash: string
}

export function BorrowRepayActivityList({
  refreshSignal,
  maxHeight = 420,
}: Props) {
  const { mode } = useWallet()
  const {
    items,
    loading,
    loadingMore,
    error,
    loadMore,
    hasMore,
  } = useLoanActivities(refreshSignal) as {
    items: LoanActivity[]
    loading: boolean
    loadingMore: boolean
    error: string | null
    loadMore: () => void
    hasMore: boolean
  }

  const scrollRef = React.useRef<HTMLDivElement>(null)

  // Infinite scroll
  const onScroll = () => {
    const el = scrollRef.current
    if (!el || !hasMore || loading || loadingMore) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) {
      loadMore()
    }
  }

  if (loading) {
    return (
      <div className="py-3 text-[11px] text-gray-500 text-center">
        Cargando actividad…
      </div>
    )
  }

  if (error) {
    return (
      <div className="py-3 text-[11px] text-red-500 text-center">
        Error al cargar actividad: {error}
      </div>
    )
  }

  if (!items.length) {
    return (
      <div className="py-3 text-[11px] text-gray-500 text-center">
        Sin préstamos/repagos recientes
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      style={{
        maxHeight: `${maxHeight}px`,
        overflowY: "auto",
        WebkitOverflowScrolling: "touch",
      }}
      className="show-scrollbar pr-1.5"
    >
      {items.map((a) => {
        const isOpen = a.type === "OPEN"
        const isClose = a.type === "CLOSE"

        const uiType = isOpen ? "PRÉSTAMO" : isClose ? "REPAGO" : "DEFAULT"

        const rawAmount =
          isOpen
            ? a.principal
            : isClose
            ? (a.paid ?? a.amountDue)
            : a.amountDue

        const amountDisplay = rawAmount
          ? formatUsdcFromBigIntString(rawAmount)
          : "—"

        const interestDisplay =
          a.interest ? formatUsdcFromBigIntString(a.interest) : null
        const explorerUrl = transactionExplorerUrl(a.txHash, mode)

        return (
          <div
            key={a.id}
            className="px-0 py-3 sm:py-2.5 border-b border-gray-100"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className={`px-1.5 py-[1px] rounded-full font-medium text-[10px] ${
                    isOpen
                      ? "bg-orange-100 text-orange-700"
                      : isClose
                      ? "bg-green-100 text-green-700"
                      : "bg-red-100 text-red-700"
                  }`}
                >
                  {uiType}
                </span>

                <span className="text-xs text-gray-600">
                  {shortAddr(a.borrower)}
                </span>
              </div>

              <div className="flex items-center justify-end gap-3 shrink-0">
                <span className="text-[11px] text-gray-500 whitespace-nowrap">
                  {timeAgo(Number(a.blockTimestamp))}
                </span>

                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold text-gray-900 tracking-tight">
                    ${amountDisplay}
                  </span>
                  <UsdcIcon size={14} />
                </div>
              </div>
            </div>

            {(isClose || explorerUrl) && (
              <div className="mt-1 flex items-center justify-between gap-3 text-[11px] text-gray-500">
                {isClose && interestDisplay ? (
                  <span>
                    Interés:{" "}
                    <span className="font-medium">${interestDisplay}</span>
                  </span>
                ) : (
                  <span />
                )}
                {explorerUrl && (
                  <a
                    href={explorerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-orange-600 hover:text-orange-700"
                  >
                    Ver tx
                  </a>
                )}
              </div>
            )}
          </div>
        )
      })}

      {loadingMore && (
        <div className="py-2 text-[11px] text-gray-400 text-center">
          Cargando más…
        </div>
      )}
    </div>
  )
}
