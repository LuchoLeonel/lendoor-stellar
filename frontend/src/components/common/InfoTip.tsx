"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { Info } from "lucide-react";

interface InfoTipProps {
  text: string;
  size?: number;
  side?: "top" | "bottom";
  align?: "center" | "end" | "start";
}

export function InfoTip({ text, size = 14, side = "top", align = "center" }: InfoTipProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <TooltipPrimitive.Provider delayDuration={0}>
      <TooltipPrimitive.Root open={open} onOpenChange={setOpen}>
        <TooltipPrimitive.Trigger asChild>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(v => !v);
            }}
            className="inline-flex items-center justify-center rounded-full transition-colors"
            style={{
              width: size + 8,
              height: size + 8,
              color: open ? "#F97415" : "#9ca3af",
            }}
            aria-label="Más información"
          >
            <Info style={{ width: size, height: size }} />
          </button>
        </TooltipPrimitive.Trigger>

        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            align={align}
            sideOffset={8}
            collisionPadding={12}
            className="z-[99999] max-w-[260px] rounded-2xl px-4 py-3 text-[13px] leading-snug shadow-lg animate-in fade-in-0 zoom-in-95"
            style={{
              backgroundColor: "#1e293b",
              color: "#f1f5f9",
            }}
            onPointerDownOutside={() => setOpen(false)}
          >
            <p>{text}</p>
            <TooltipPrimitive.Arrow
              width={12}
              height={6}
              style={{ fill: "#1e293b" }}
            />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
