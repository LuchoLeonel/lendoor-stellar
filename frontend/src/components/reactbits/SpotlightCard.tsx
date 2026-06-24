import { useRef, useState, type ReactNode, type MouseEvent } from "react"

interface SpotlightCardProps {
  children: ReactNode
  className?: string
  spotlightColor?: string
}

export function SpotlightCard({
  children,
  className = "",
  spotlightColor,
}: SpotlightCardProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [isHovering, setIsHovering] = useState(false)

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    setPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
  }

  const defaultColor =
    spotlightColor || "rgba(var(--spotlight-rgb), 0.06)"

  return (
    <div
      ref={ref}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      className={`relative overflow-hidden rounded-xl border border-border bg-card transition-all shadow-sm ${className}`}
      style={{
        background: isHovering
          ? `radial-gradient(300px circle at ${pos.x}px ${pos.y}px, ${defaultColor}, transparent 60%)`
          : undefined,
      }}
    >
      {children}
    </div>
  )
}
