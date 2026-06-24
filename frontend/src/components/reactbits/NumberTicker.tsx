import { useRef, useEffect, useState } from "react"
import { motion, useSpring, useInView } from "framer-motion"

interface NumberTickerProps {
  value: number
  className?: string
  prefix?: string
  suffix?: string
}

function formatWithCommas(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")
}

export function NumberTicker({
  value,
  className = "",
  prefix = "",
  suffix = "",
}: NumberTickerProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const isInView = useInView(ref, { once: true, margin: "-50px" })
  const spring = useSpring(0, { stiffness: 60, damping: 20 })
  const [display, setDisplay] = useState("0")

  useEffect(() => {
    if (isInView) {
      spring.set(value)
    }
  }, [isInView, value, spring])

  useEffect(() => {
    const unsubscribe = spring.on("change", (v) => {
      setDisplay(formatWithCommas(Math.round(v)))
    })
    return unsubscribe
  }, [spring])

  return (
    <motion.span ref={ref} className={className}>
      {prefix}{display}{suffix}
    </motion.span>
  )
}
