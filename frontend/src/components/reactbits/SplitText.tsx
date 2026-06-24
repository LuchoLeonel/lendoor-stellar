import { motion, type Variants } from "framer-motion"

interface SplitTextProps {
  text: string
  className?: string
  delay?: number
  /** Duration per character animation */
  charDuration?: number
  /** Stagger between characters */
  stagger?: number
}

const containerVariants: Variants = {
  hidden: {},
  visible: (stagger: number) => ({
    transition: {
      staggerChildren: stagger,
    },
  }),
}

const charVariants: Variants = {
  hidden: {
    opacity: 0,
    y: 20,
    filter: "blur(8px)",
  },
  visible: (duration: number) => ({
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: {
      duration,
      ease: [0.25, 0.4, 0.25, 1],
    },
  }),
}

export function SplitText({
  text,
  className = "",
  delay = 0,
  charDuration = 0.4,
  stagger = 0.03,
}: SplitTextProps) {
  const words = text.split(" ")

  return (
    <motion.span
      className={`inline-block ${className}`}
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      custom={stagger}
      style={{ transitionDelay: `${delay}s` }}
    >
      {words.map((word, wi) => (
        <span key={wi} className="inline-block whitespace-nowrap">
          {word.split("").map((char, ci) => (
            <motion.span
              key={`${wi}-${ci}`}
              className="inline-block"
              variants={charVariants}
              custom={charDuration}
            >
              {char}
            </motion.span>
          ))}
          {wi < words.length - 1 && <span className="inline-block">&nbsp;</span>}
        </span>
      ))}
    </motion.span>
  )
}
