// components/reactbits/FadeIn.tsx
// Lightweight fade-in + scale animation for splash screens.
// Inspired by ReactBits FadeContent but without GSAP dependency.
"use client";

import * as React from "react";

interface FadeInProps {
  children: React.ReactNode;
  /** Delay before animation starts (ms) */
  delay?: number;
  /** Animation duration (ms) */
  duration?: number;
  /** Also apply a scale-up effect */
  scale?: boolean;
  /** Also apply a blur-to-clear effect */
  blur?: boolean;
  /** Additional className */
  className?: string;
}

export default function FadeIn({
  children,
  delay = 0,
  duration = 800,
  scale = true,
  blur = false,
  className = "",
}: FadeInProps) {
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    const timer = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);

  return (
    <div
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible
          ? "scale(1) translateY(0)"
          : `scale(${scale ? 0.5 : 1}) translateY(${scale ? "20px" : "0"})`,
        filter: blur ? (visible ? "blur(0px)" : "blur(12px)") : undefined,
        transition: `opacity ${duration}ms cubic-bezier(0.16, 1, 0.3, 1), transform ${duration}ms cubic-bezier(0.16, 1, 0.3, 1), filter ${duration}ms cubic-bezier(0.16, 1, 0.3, 1)`,
        willChange: "opacity, transform, filter",
      }}
    >
      {children}
    </div>
  );
}
