import { useRef, useState, type ReactNode, type MouseEvent } from "react"

interface SpotlightButtonProps {
  children: ReactNode
  className?: string
  onClick?: () => void
  disabled?: boolean
}

export function SpotlightButton({
  children,
  className = "",
  onClick,
  disabled,
}: SpotlightButtonProps) {
  const ref = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [isHovering, setIsHovering] = useState(false)

  const handleMouseMove = (e: MouseEvent<HTMLButtonElement>) => {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    setPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
  }

  return (
    <button
      ref={ref}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      onClick={onClick}
      disabled={disabled}
      className={`relative overflow-hidden ${className}`}
      style={{
        background: isHovering
          ? `radial-gradient(120px circle at ${pos.x}px ${pos.y}px, rgba(var(--spotlight-rgb), 0.1), transparent 60%)`
          : undefined,
      }}
    >
      {children}
    </button>
  )
}
