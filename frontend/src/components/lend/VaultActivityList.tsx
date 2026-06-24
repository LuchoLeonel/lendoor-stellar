'use client'

import * as React from "react"
import { useVaultActivities } from "@/hooks/stats/useVaultActivities"
import { UsdcIcon } from "@/components/icons/UsdcIcon"
import { formatUsdcFromBigIntString } from "@/lib/format"

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

type Props = { refreshSignal?: number }

export function VaultActivityList({ refreshSignal }: Props) {
  const {
    items,
    loading,
    loadingMore,
    error,
    loadMore,
    hasMore,
  } = useVaultActivities(refreshSignal)

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    const nearBottom =
      el.scrollTop + el.clientHeight >= el.scrollHeight - 24

    if (nearBottom && hasMore && !loadingMore && !loading) {
      loadMore()
    }
  }

  if (loading) {
    return (
      <div className="py-4 text-xs text-gray-500 text-center">
        Cargando actividad…
      </div>
    )
  }

  if (error) {
    return (
      <div className="py-4 text-xs text-red-500 text-center">
        Error al cargar actividad: {error}
      </div>
    )
  }

  if (!items.length) {
    return (
      <div className="py-4 text-xs text-gray-500 text-center">
        Sin depósitos/retiros recientes
      </div>
    )
  }

  return (
    <div
      onScroll={onScroll}
      style={{
        maxHeight: "350px",
        overflowY: "auto",
        WebkitOverflowScrolling: "touch",
      }}
      className="show-scrollbar pr-1.5 divide-y divide-gray-100 pb-2"
    >
      {items.map((a) => {
        const amountDisplay = formatUsdcFromBigIntString(a.assets)
        const isDeposit = a.type === "DEPOSIT"
        const uiType = isDeposit ? "DEPÓSITO" : "RETIRO"

        return (
          <div
            key={a.id}
            className="px-0 py-3 sm:py-2.5"
          >
            <div className="flex items-center justify-between">
              {/* Left */}
              <div className="flex items-center gap-2">
                <span
                  className={`px-1.5 py-[1px] rounded-full font-medium text-[10px] ${
                    isDeposit
                      ? "bg-green-100 text-green-700"
                      : "bg-orange-100 text-orange-700"
                  }`}
                >
                  {uiType}
                </span>
  
                <span className="text-xs text-gray-600">
                  {shortAddr(a.account)}
                </span>
              </div>
  
              {/* Right */}
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