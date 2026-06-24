import { useState, useEffect } from "react"
import { AnimatePresence, motion } from "framer-motion"

interface RotatingTextProps {
  texts: string[]
  interval?: number
  className?: string
}

export function RotatingText({
  texts,
  interval = 2500,
  className = "",
}: RotatingTextProps) {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => {
      setIndex((prev) => (prev + 1) % texts.length)
    }, interval)
    return () => clearInterval(timer)
  }, [texts.length, interval])

  return (
    <span className={`relative inline-grid overflow-hidden ${className}`}>
      {/* Hidden copies of every text to reserve the widest width */}
      {texts.map((t) => (
        <span key={t} className="invisible col-start-1 row-start-1" aria-hidden>
          {t}
        </span>
      ))}
      {/* Visible animated text on top */}
      <span className="col-start-1 row-start-1">
        <AnimatePresence mode="wait">
          <motion.span
            key={texts[index]}
            initial={{ y: "100%", opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "-100%", opacity: 0 }}
            transition={{ duration: 0.35, ease: [0.25, 0.4, 0.25, 1] }}
            className="inline-block"
          >
            {texts[index]}
          </motion.span>
        </AnimatePresence>
      </span>
    </span>
  )
}
