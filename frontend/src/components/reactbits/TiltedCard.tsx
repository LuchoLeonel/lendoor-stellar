import { useRef, type ReactNode, type MouseEvent } from "react"
import { motion, useMotionValue, useSpring } from "framer-motion"

interface TiltedCardProps {
  children: ReactNode
  className?: string
  tiltDegree?: number
}

export function TiltedCard({
  children,
  className = "",
  tiltDegree = 10,
}: TiltedCardProps) {
  const ref = useRef<HTMLDivElement>(null)

  const rotateX = useMotionValue(0)
  const rotateY = useMotionValue(0)

  const springX = useSpring(rotateX, { stiffness: 300, damping: 30 })
  const springY = useSpring(rotateY, { stiffness: 300, damping: 30 })

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width - 0.5
    const y = (e.clientY - rect.top) / rect.height - 0.5
    rotateX.set(-y * tiltDegree)
    rotateY.set(x * tiltDegree)
  }

  const handleMouseLeave = () => {
    rotateX.set(0)
    rotateY.set(0)
  }

  return (
    <motion.div
      ref={ref}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        rotateX: springX,
        rotateY: springY,
        transformPerspective: 800,
      }}
      className={className}
    >
      {children}
    </motion.div>
  )
}
