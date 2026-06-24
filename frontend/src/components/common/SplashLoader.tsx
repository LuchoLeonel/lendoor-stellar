// components/common/SplashLoader.tsx
"use client";

import { GridBackground } from "@/components/common/GridBackground";
import DecryptedText from "@/components/reactbits/DecryptedText";
import BlurText from "@/components/reactbits/BlurText";
import FadeIn from "@/components/reactbits/FadeIn";

/**
 * Unified splash/loading screen for the Lendoor miniapp.
 * Shows the brand logo with a fade-in + scale animation, a decryption
 * text reveal, an orange arc spinner, and a blur-in status message.
 */
export function SplashLoader({ label }: { label: string }) {
  return (
    <div className="flex min-h-[calc(100vh-4rem)] w-full items-center justify-center bg-background relative overflow-hidden">
      {/* Subtle grid background */}
      <GridBackground />

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center">
        {/* Brand group — logo + name + spinner (tight 12px gaps) */}
        <div className="flex flex-col items-center">
          {/* Logo — fade in + scale up + blur clear */}
          <FadeIn delay={200} duration={1200} scale blur>
            <img
              src="/favicon.png"
              alt="Lendoor"
              className="h-16 w-16 object-contain"
            />
          </FadeIn>

          {/* Brand name — same fade-in then decryption reveal */}
          <FadeIn delay={500} duration={1200} scale blur className="mt-2">
            <div className="text-2xl font-bold text-primary mono-text tracking-wide">
              <DecryptedText
                text="LENDOOR"
                animateOn="view"
                speed={60}
                maxIterations={15}
                sequential
                revealDirection="center"
                characters="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789$#@&"
                className="text-primary"
                encryptedClassName="text-primary/40"
              />
            </div>
          </FadeIn>

          {/* Spinner — orange arc */}
          <FadeIn delay={900} duration={1200} scale blur className="mt-4">
            <div
              className="h-7 w-7 rounded-full border-[2.5px] border-primary/20 border-t-primary animate-spin"
              role="status"
              aria-label="Loading"
            />
          </FadeIn>
        </div>

        {/* Status text — separated from brand group */}
        <div className="mt-6">
          <BlurText
            key={label}
            text={label}
            delay={80}
            animateBy="words"
            direction="bottom"
            stepDuration={0.3}
            className="text-sm text-muted-foreground tracking-wide justify-center"
          />
        </div>
      </div>
    </div>
  );
}
