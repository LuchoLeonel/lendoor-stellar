// app/lend/page.tsx
"use client";

import { LendMarket } from "@/components/lend/LendMarket";

export default function LendPage() {
  return (
    <div className="relative min-h-[calc(100dvh-4rem)] overflow-x-hidden">
      <div className="relative z-10 container mx-auto w-full max-w-3xl">
        <LendMarket />
      </div>
    </div>
  );
}