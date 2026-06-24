// src/components/common/ConfirmationDialog.tsx
"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

export type ConfirmationDialogVariant = "default" | "destructive";

export type ConfirmationDialogDetail = {
  label: string;
  value: string;
};

export type ConfirmationDialogProps = {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  description?: string;
  /** Summary rows shown in the detail card */
  details?: ConfirmationDialogDetail[];
  confirmLabel: string;
  cancelLabel: string;
  /** Controls confirm button color. 'destructive' → red. Default → primary */
  variant?: ConfirmationDialogVariant;
  /** Disable the confirm button while processing */
  confirming?: boolean;
};

export function ConfirmationDialog({
  open,
  onConfirm,
  onCancel,
  title,
  description,
  details,
  confirmLabel,
  cancelLabel,
  variant = "default",
  confirming = false,
}: ConfirmationDialogProps) {
  // Extract the main amount from details (first detail with "USDC")
  const mainAmount = details?.find((d) => d.value.includes("USDC"));
  const otherDetails = details?.filter((d) => d !== mainAmount);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !confirming) onCancel(); }}>
      <DialogContent
        className="max-w-[340px] rounded-2xl p-0 overflow-hidden"
        closeClassName="hidden"
        onInteractOutside={(e) => { e.preventDefault(); }}
      >
        <DialogDescription className="sr-only">{description}</DialogDescription>

        <div className="px-6 pt-6 pb-5">
          {/* Title */}
          <h3 className="text-[17px] font-bold text-foreground text-center">
            {title}
          </h3>

          {description && (
            <p className="mt-1 text-[13px] text-muted-foreground text-center">
              {description}
            </p>
          )}

          {/* Hero amount */}
          {mainAmount && (
            <div className="mt-5 text-center">
              <p className="text-[11px] uppercase tracking-widest font-medium text-muted-foreground/70 mb-1">
                {mainAmount.label}
              </p>
              <p className="text-[32px] font-bold tabular-nums tracking-tight text-foreground leading-none">
                {mainAmount.value.replace(" USDC", "")}
                <span className="text-[16px] font-medium text-muted-foreground ml-1.5">USDC</span>
              </p>
            </div>
          )}

          {/* Other details */}
          {otherDetails && otherDetails.length > 0 && (
            <div className="mt-4 rounded-xl bg-muted/30 border border-border/40 px-4 py-3 space-y-2">
              {otherDetails.map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between gap-3">
                  <span className="text-[12px] text-muted-foreground">{label}</span>
                  <span className="text-[12px] font-semibold text-foreground tabular-nums">{value}</span>
                </div>
              ))}
            </div>
          )}

          {/* Buttons */}
          <div className="mt-5 space-y-2">
            <button
              type="button"
              onClick={onConfirm}
              disabled={confirming}
              className={cn(
                "w-full h-[48px] rounded-2xl text-[15px] font-semibold flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50",
                variant === "destructive"
                  ? "bg-red-600 text-white"
                  : "bg-primary text-white"
              )}
              style={{
                boxShadow: variant === "destructive"
                  ? '0 4px 16px rgba(220,38,38,0.25)'
                  : '0 4px 16px rgba(249,116,21,0.25)',
              }}
            >
              {confirming ? <Loader2 className="h-5 w-5 animate-spin" /> : confirmLabel}
            </button>

            <button
              type="button"
              onClick={onCancel}
              disabled={confirming}
              className="w-full h-[44px] text-[14px] font-medium text-muted-foreground transition-colors disabled:opacity-40"
            >
              {cancelLabel}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
