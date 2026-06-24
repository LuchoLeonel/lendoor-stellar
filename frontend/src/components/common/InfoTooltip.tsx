// components/common/InfoTip.tsx
"use client";

import * as React from "react";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import * as Popover from "@radix-ui/react-popover";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/i18n/useTranslation";

type InfoTipProps = {
  label: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  children?: React.ReactNode;
  triggerClassName?: string;
  iconClassName?: string;
  /** visual style for the panel */
  variant?: "default" | "light";
  /** extra classes for the floating panel (e.g., your font) */
  contentClassName?: string;
  sideOffset?: number;
  /** hide the default icon if you don't pass children */
  showIcon?: boolean;
  /** only show the icon on hover (desktop-only); ignored on touch */
  hoverOnly?: boolean;
  /** force behavior; 'auto' picks popover on touch, tooltip on desktop */
  mode?: "auto" | "tooltip" | "popover";
}

/** Robust touch detector (works on mobile & most webviews). */
function useIsTouchLike() {
  const [isTouch, setIsTouch] = React.useState(false);
  React.useEffect(() => {
    const mq =
      typeof window !== "undefined"
        ? window.matchMedia("(pointer: coarse)")
        : null;
    const calc = () =>
      !!(mq?.matches ||
        (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0));
    setIsTouch(calc());
    if (!mq) return;
    const handler = () => setIsTouch(calc());
    mq.addEventListener?.("change", handler);
    return () => mq.removeEventListener?.("change", handler);
  }, []);
  return isTouch;
}

export function InfoTip({
  label,
  side = "bottom",
  align = "center",
  children,
  triggerClassName,
  iconClassName,
  variant = "light",
  contentClassName,
  sideOffset = 6,
  showIcon = true,
  hoverOnly = false,
  mode = "auto",
}: InfoTipProps) {
  const isTouch = useIsTouchLike();
  const usePopover = mode === "popover" || (mode === "auto" && isTouch);
  const { t } = useTranslation();

  // Base + variants for the floating panel
  const contentBase =
    "max-w-[320px] text-xs leading-snug rounded-md shadow-md border px-3 py-2 pt-4 z-50 mono-text";
  const variants: Record<NonNullable<InfoTipProps["variant"]>, string> = {
    default: "bg-popover text-popover-foreground border-border",
    light: "bg-white text-neutral-900 border-primary/60 dark:border-primary/70",
  };
  const panelClasses = cn(contentBase, variants[variant], contentClassName);

  const ariaLabel = t("common.infoTip.ariaLabel");

  /**
   * Default trigger button (focusable & tappable).
   * NOTE: On touch devices there is no hover, so `hoverOnly` is ignored
   * to ensure the trigger remains visible and accessible.
   */
  const defaultTrigger = (
    <button
      type="button"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center justify-center",
        "h-4 w-4 rounded-full border border-border/60 text-muted-foreground/80",
        "bg-transparent hover:bg-muted/40",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        // Hide on hover-only, but ONLY when using tooltip (desktop). On touch we keep it visible.
        !usePopover && hoverOnly
          ? "opacity-0 group-hover:opacity-100 transition-opacity"
          : "",
        triggerClassName,
      )}
    >
      {showIcon && (
        <Info
          className={cn("h-3 w-3", iconClassName)}
          aria-hidden="true"
        />
      )}
    </button>
  );

  // If consumer passes a custom trigger via `children`, we use it as-is.
  // Otherwise we use our default, making it keyboard/touch friendly.
  const triggerNode = children ? (
    <>{children}</>
  ) : hoverOnly && !usePopover ? (
    // For hoverOnly we need a `.group` wrapper to reveal the icon on hover
    <span className="group inline-flex items-center">{defaultTrigger}</span>
  ) : (
    defaultTrigger
  );

  if (usePopover) {
    // Touch/mobile/webview path: toggletip via Popover (tap to open/close).
    return (
      <Popover.Root>
        <Popover.Trigger asChild>{triggerNode}</Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side={side}
            align={align}
            sideOffset={sideOffset}
            className={panelClasses}
          >
            {label}
            {/* Arrow styling to match your tooltip look & feel */}
            <Popover.Arrow className="bg-white dark:bg-primary fill-current z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px]" />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    );
  }

  // Desktop path: real tooltip (hover/focus).
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>{triggerNode}</TooltipTrigger>
        <TooltipContent
          side={side}
          align={align}
          sideOffset={sideOffset}
          className={panelClasses}
        >
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default InfoTip;
