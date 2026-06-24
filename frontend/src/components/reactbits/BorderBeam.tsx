import { type ReactNode } from "react"

interface BorderBeamProps {
  children: ReactNode
  duration?: number
  colorFrom?: string
  colorTo?: string
  className?: string
}

export function BorderBeam({
  children,
  duration = 6,
  colorFrom = "var(--primary)",
  colorTo = "var(--chart-2)",
  className = "",
}: BorderBeamProps) {
  return (
    <div className={`relative rounded-xl ${className}`}>
      <div className="absolute -inset-px rounded-xl overflow-hidden" style={{ padding: "1px" }}>
        <div
          className="absolute inset-0"
          style={{
            background: `conic-gradient(from 0deg, transparent 0%, transparent 25%, ${colorFrom} 35%, ${colorTo} 45%, transparent 55%, transparent 100%)`,
            animation: `star-rotate ${duration}s linear infinite`,
          }}
        />
        <div className="absolute inset-px rounded-xl bg-background" />
      </div>
      <div className="relative h-full">{children}</div>
    </div>
  )
}
