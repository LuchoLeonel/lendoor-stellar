import { useRef } from "react"
import { motion, useScroll, useTransform } from "framer-motion"

interface TextRevealProps {
  text: string
  className?: string
}

export function TextReveal({ text, className = "" }: TextRevealProps) {
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start 0.9", "start 0.25"],
  })

  const words = text.split(" ")
  const totalWords = words.length

  return (
    <div ref={ref} className={className}>
      <p className="text-2xl md:text-4xl font-bold leading-snug tracking-tight">
        {words.map((word, i) => (
          <Word key={i} word={word} index={i} total={totalWords} progress={scrollYProgress} isLast={i === totalWords - 1} />
        ))}
      </p>
    </div>
  )
}

function Word({
  word,
  index,
  total,
  progress,
  isLast,
}: {
  word: string
  index: number
  total: number
  progress: ReturnType<typeof useScroll>["scrollYProgress"]
  isLast: boolean
}) {
  const start = index / total
  const end = start + 1 / total

  const opacity = useTransform(progress, [start, end], [0.5, 1])
  const color = useTransform(
    progress,
    [start, end],
    ["#94a3b8", "#0f172a"]
  )

  return (
    <>
      <motion.span
        style={{
          opacity,
          color,
          willChange: "opacity, color",
        }}
        className="inline"
      >
        {word}
      </motion.span>
      {!isLast && " "}
    </>
  )
}
