'use client'

import { useMemo } from "react"
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  Tooltip,
} from "recharts"
import { useDailyProtocolStats } from "@/hooks/stats/useDailyProtocolStats"
import { formatCountFromBigIntString } from "@/lib/format"

type MetricKey = "loansOriginated" | "uniqueBorrowers" | "principalOriginated" | "interestRepaid"

type MetricMeta = {
  title: string
  subtitle: string
  format: "count" | "usdc"
}

const LABELS: Record<MetricKey, MetricMeta> = {
  loansOriginated: {
    title: "Préstamos originados",
    subtitle: "Eventos de préstamo acumulados",
    format: "count",
  },
  uniqueBorrowers: {
    title: "Prestatarios únicos",
    subtitle: "Nuevos prestatarios acumulados",
    format: "count",
  },
  principalOriginated: {
    title: "Principal originado",
    subtitle: "Volumen total prestado",
    format: "usdc",
  },
  interestRepaid: {
    title: "Interés generado",
    subtitle: "Revenue acumulado del protocolo",
    format: "usdc",
  },
}

const ORANGE = "#F46A06"

function shortDate(unixSec: number) {
  const d = new Date(unixSec * 1000)
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function formatValue(value: number, fmt: "count" | "usdc") {
  if (fmt === "usdc") {
    const usdc = value / 1e6
    if (!Number.isFinite(usdc)) return "—"
    return `$${usdc.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
  return formatCountFromBigIntString(String(value))
}

export function CumulativeMetricCard({
  metric = "loansOriginated",
  compact = true,
}: {
  metric?: MetricKey
  compact?: boolean
}) {
  const { items, loading, error } = useDailyProtocolStats()

  const chartData = useMemo(() => {
    let running = 0
    return items.map((d) => {
      const v = Number(d[metric] ?? 0)
      running += Number.isFinite(v) ? v : 0
      return {
        dayStart: Number(d.dayStart),
        label: shortDate(Number(d.dayStart)),
        value: running,
      }
    })
  }, [items, metric])

  const latestValue =
    chartData.length > 0 ? chartData[chartData.length - 1].value : 0

  const { title, subtitle, format: fmt } = LABELS[metric]

  return (
    <div className={compact ? "space-y-1" : "bg-card rounded-2xl border border-border/40 shadow-sm px-4 py-3 space-y-1"}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] text-muted-foreground">{title}</p>

          <p className={compact ? "text-xl font-semibold tracking-tight" : "text-2xl font-semibold tracking-tight"}>
            {loading ? "—" : formatValue(latestValue, fmt)}
          </p>

          {!compact && (
            <p className="text-xs text-gray-500">{subtitle}</p>
          )}
        </div>
      </div>

      <div className={compact ? "h-[120px] overflow-x-hidden touch-pan-y" : "h-[150px] overflow-x-hidden touch-pan-y"}>
        {error ? (
          <div className="text-xs text-red-500">
            Error al cargar estadísticas diarias
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={chartData}
              margin={{ top: 4, right: 6, left: 6, bottom: 0 }}
            >
              <defs>
                <linearGradient id={`lendoorOrangeFill-${metric}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={ORANGE} stopOpacity={0.35} />
                  <stop offset="70%" stopColor={ORANGE} stopOpacity={0.10} />
                  <stop offset="100%" stopColor={ORANGE} stopOpacity={0} />
                </linearGradient>
              </defs>

              <XAxis dataKey="label" tick={false} axisLine={false} tickLine={false} />

              <Tooltip
                cursor={false}
                contentStyle={{
                  borderRadius: 12,
                  border: "1px solid #f1f1f1",
                  boxShadow: "0 6px 18px rgba(0,0,0,0.06)",
                  fontSize: 11,
                }}
                labelStyle={{ fontSize: 10, color: "#6b7280" }}
                formatter={(v: number) => [
                  formatValue(Number(v), fmt),
                  "Acumulado",
                ]}
              />

              <Area
                type="monotone"
                dataKey="value"
                stroke={ORANGE}
                strokeWidth={2.5}
                fill={`url(#lendoorOrangeFill-${metric})`}
                fillOpacity={1}
                dot={false}
                activeDot={{ r: 3 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
