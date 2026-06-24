'use client'

import * as React from "react"
import { useVaultUtilization } from "@/hooks/stats/useVaultUtilization"

function fmt(n: number | null, digits = 2) {
  if (n == null || !Number.isFinite(n)) return "—"
  return n.toFixed(digits)
}

type Props = {
  variant?: "hero" | "compact"
}

export function VaultUtilizationBar({ variant = "hero" }: Props) {
  const { loading, error, utilizationPct } = useVaultUtilization()

  const pct = utilizationPct ?? 0
  const isCompact = variant === "compact"

  if (loading) {
    if (isCompact) {
      return (
        <>
          <p className="text-2xl md:text-3xl font-bold text-foreground font-mono">—</p>
          <div className="mt-2 h-1.5 rounded-full bg-muted" />
        </>
      )
    }
    return (
      <div className="bg-card rounded-2xl border border-border/40 p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">Utilización</p>
          <p className="text-2xl font-semibold">—</p>
        </div>
        <div className="mt-2 h-2 rounded-full bg-muted" />
      </div>
    )
  }

  if (error) {
    if (isCompact) {
      return <p className="text-xs text-red-500">Error: {error}</p>
    }
    return (
      <div className="bg-card rounded-2xl border border-border/40 p-4">
        <p className="text-xs text-muted-foreground">Utilización</p>
        <p className="mt-2 text-xs text-red-500">Error al cargar: {error}</p>
      </div>
    )
  }

  // Compact: no wrapper, just the number + bar (for use inside SpotlightCard)
  if (isCompact) {
    return (
      <>
        <p className="text-2xl md:text-3xl font-bold text-foreground font-mono">{fmt(pct)}%</p>
        <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
          />
        </div>
      </>
    )
  }

  // Hero: full card with wrapper
  return (
    <div className="bg-card rounded-2xl border border-border/40 p-4 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Utilización</p>
        <p className="text-2xl font-semibold text-foreground">{fmt(pct)}%</p>
      </div>

      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
        />
      </div>

      <p className="text-[11px] text-muted-foreground">
        Préstamos / (Efectivo + Préstamos)
      </p>
    </div>
  )
}
