// components/layout/HeaderUsdcArea.tsx
"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Plus, ArrowDownToLine, ArrowUpFromLine, ArrowRight } from "lucide-react";

import { useContracts } from "@/providers/ContractsProvider";
import { useUsdcBalance } from "@/hooks/useUsdcBalance";
import { useWallet } from "@/providers/WalletProvider";

import { LemonFundsDialogs } from "@/components/common/LemonFundsDialogs";
import { useTranslation } from "@/i18n/useTranslation";

/**
 * Pill de balance USDC.
 * El botón de depósito/retiro solo aparece si es Lemon mini-app.
 */
export function HeaderUsdcArea() {
  const { ready } = useContracts();
  const { display } = useUsdcBalance(10_000);

  const { mode } = useWallet();
  const isLemon = mode === "lemon";
  const showLemonControls = isLemon;

  const [chooserOpen, setChooserOpen] = React.useState(false);
  const [openDeposit, setOpenDeposit] = React.useState(false);
  const [openWithdraw, setOpenWithdraw] = React.useState(false);

  const { t } = useTranslation();

  if (!ready) {
    return (
      <div className="h-8 sm:h-10 w-24 sm:w-40 rounded-md border border-primary/20 bg-muted/40 animate-pulse" />
    );
  }

  const openDepositFlow = () => {
    setChooserOpen(false);
    setOpenDeposit(true);
  };

  const openWithdrawFlow = () => {
    setChooserOpen(false);
    setOpenWithdraw(true);
  };

  return (
    <>
      {/* Pill + (solo Lemon) */}
      <div className="inline-flex items-center gap-1.5 rounded-full bg-white shadow-md border border-border/30 px-3 py-2">
        <img src="/usdc.svg" alt="USDC" className="h-5 w-5 shrink-0" />
        <span className="text-[14px] font-bold text-foreground">
          {display} USDC
        </span>

        {showLemonControls && (
          <button
            type="button"
            onClick={() => setChooserOpen(true)}
            className="ml-0.5 h-8 w-8 rounded-full bg-primary flex items-center justify-center shrink-0"
            aria-label="Gestionar fondos"
          >
            <Plus className="h-4 w-4 text-white" strokeWidth={3} />
          </button>
        )}
      </div>

      {/* Bottom sheet chooser: slides from bottom, no X, swipe-down-to-close */}
      {showLemonControls && (
        <BalanceSheet
          open={chooserOpen}
          onOpenChange={setChooserOpen}
          t={t}
          onDeposit={openDepositFlow}
          onWithdraw={openWithdrawFlow}
        />
      )}

      {/* Dialogs de depósito/retiro compartidos */}
      {showLemonControls && (
        <LemonFundsDialogs
          openDeposit={openDeposit}
          onOpenDepositChange={setOpenDeposit}
          openWithdraw={openWithdraw}
          onOpenWithdrawChange={setOpenWithdraw}
          enabled={isLemon}
          depositDescription={t("common.headerUsdc.depositDescription")}
          withdrawDescription={t("common.headerUsdc.withdrawDescription")}
        />
      )}
    </>
  );
}

// --------------------------------------------------------------------------
// Balance bottom-sheet
// --------------------------------------------------------------------------
//
// Slides up from bottom, ~half screen, no X button. Closes via:
//   - tap on the opaque overlay (Radix native)
//   - swipe-down gesture on the sheet (custom touch handler below)
//   - swipe-down on the drag handle
//
// We use DialogPrimitive directly instead of our shared DialogContent so we
// can fully own the animation + skip the built-in X close button.

export interface BalanceSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  t: (key: string) => string;
  onDeposit: () => void;
  onWithdraw: () => void;
}

// Exported so the swipe-close behavior + option clicks can be unit-tested
// in isolation without mocking the entire HeaderUsdcArea wiring.
export function BalanceSheet({ open, onOpenChange, t, onDeposit, onWithdraw }: BalanceSheetProps) {
  // Swipe-down-to-close gesture state. We track both the sheet itself
  // AND the opaque overlay (users expect downward drag anywhere to close).
  const [dragY, setDragY] = React.useState(0);
  const startYRef = React.useRef<number | null>(null);
  const CLOSE_THRESHOLD_PX = 80;

  const onTouchStart = (e: React.TouchEvent) => {
    startYRef.current = e.touches[0].clientY;
    setDragY(0);
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (startYRef.current == null) return;
    const dy = e.touches[0].clientY - startYRef.current;
    // Only track downward drag (positive dy). Upward: clamp to 0.
    setDragY(Math.max(0, dy));
  };
  const onTouchEnd = () => {
    if (dragY > CLOSE_THRESHOLD_PX) {
      onOpenChange(false);
    }
    startYRef.current = null;
    setDragY(0);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        {/* Opaque overlay — tap or downward drag anywhere closes the sheet.
            We share the same touch handlers as the sheet so the user can
            flick down on the dimmed background too. Radix will still
            dismiss on tap if the drag never crosses the threshold. */}
        <DialogPrimitive.Overlay
          data-testid="balance-sheet-overlay"
          className={
            "fixed inset-0 z-50 bg-black/50 " +
            "data-[state=open]:animate-in data-[state=closed]:animate-out " +
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 " +
            "duration-500"
          }
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        />

        <DialogPrimitive.Content
          data-testid="balance-sheet"
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className={
            "fixed bottom-0 left-0 right-0 z-50 " +
            "rounded-t-3xl bg-background shadow-2xl border-t border-border/30 " +
            // Slower + ease-out curve so the slide-up is clearly perceptible
            // (prior duration-300 felt jarring, felt like a pop rather than
            // a deliberate slide).
            "data-[state=open]:animate-in data-[state=closed]:animate-out " +
            "data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom " +
            "duration-500 ease-out"
          }
          style={{
            // Follow the finger while dragging; transform resets after release
            transform: dragY > 0 ? `translateY(${dragY}px)` : undefined,
            transition: dragY > 0 ? "none" : undefined,
            // Adds ~10vh of cushion at the bottom — sheet sits 10% higher
            // on screen than content alone would require.
            paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 10vh + 0.75rem)",
          }}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-2" data-testid="balance-sheet-handle">
            <div className="h-1.5 w-10 rounded-full bg-border" />
          </div>

          {/* Header */}
          <div className="px-6 pt-2 pb-4">
            <DialogPrimitive.Title className="text-[18px] font-bold text-foreground leading-tight">
              {t("common.headerUsdc.dialogTitle")}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="text-[13px] text-muted-foreground mt-1.5 leading-snug">
              {t("common.headerUsdc.dialogDescription")}
            </DialogPrimitive.Description>
          </div>

          {/* Options */}
          <div className="px-5 space-y-2.5">
            <button
              type="button"
              data-testid="balance-sheet-deposit"
              className="w-full flex items-center gap-4 rounded-2xl px-4 py-4 text-left transition-all hover:bg-muted/50 active:scale-[0.98]"
              style={{ border: "1px solid #e5e7eb" }}
              onClick={onDeposit}
            >
              <div
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
                style={{ backgroundColor: "rgba(249,116,21,0.1)" }}
              >
                <ArrowDownToLine className="h-5 w-5" style={{ color: "#F97415" }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-semibold text-foreground leading-tight">
                  {t("common.headerUsdc.depositCta")}
                </p>
                <p className="text-[12px] text-muted-foreground mt-0.5 leading-snug">
                  {t("common.headerUsdc.depositDescription")}
                </p>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/50" />
            </button>

            <button
              type="button"
              data-testid="balance-sheet-withdraw"
              className="w-full flex items-center gap-4 rounded-2xl px-4 py-4 text-left transition-all hover:bg-muted/50 active:scale-[0.98]"
              style={{ border: "1px solid #e5e7eb" }}
              onClick={onWithdraw}
            >
              <div
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
                style={{ backgroundColor: "rgba(99,102,241,0.1)" }}
              >
                <ArrowUpFromLine className="h-5 w-5" style={{ color: "#6366f1" }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-semibold text-foreground leading-tight">
                  {t("common.headerUsdc.withdrawCta")}
                </p>
                <p className="text-[12px] text-muted-foreground mt-0.5 leading-snug">
                  {t("common.headerUsdc.withdrawDescription")}
                </p>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/50" />
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
