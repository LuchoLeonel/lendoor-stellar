import { type ReactNode } from "react"

interface MarqueeProps {
  children: ReactNode
  speed?: number
  direction?: "left" | "right"
  pauseOnHover?: boolean
  className?: string
}

export function Marquee({
  children,
  speed = 30,
  direction = "left",
  pauseOnHover = false,
  className = "",
}: MarqueeProps) {
  const animDir = direction === "left" ? "normal" : "reverse"

  return (
    <div
      className={`overflow-hidden ${pauseOnHover ? "[&:hover_.marquee-track]:pause" : ""} ${className}`}
      style={{ maskImage: "linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%)" }}
    >
      <div
        className="marquee-track flex gap-8 w-max"
        style={{
          animation: `marquee-scroll ${speed}s linear infinite`,
          animationDirection: animDir,
        }}
      >
        <div className="flex gap-8 shrink-0">{children}</div>
        <div className="flex gap-8 shrink-0" aria-hidden>{children}</div>
      </div>
    </div>
  )
}
