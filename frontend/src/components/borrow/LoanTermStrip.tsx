// src/components/borrow/LoanTermStrip.tsx
"use client";

import * as React from "react";
import { CalendarX2 } from "lucide-react";
import { useTranslation } from "@/i18n/useTranslation";

type LoanTermStripProps = {
  /** Días restantes hasta el vencimiento (puede ser < 0 si está vencido) */
  daysRemaining?: number | null;
  /** Progreso del término del préstamo (0–100 aprox) */
  progressPct?: number | null;
};

export function LoanTermStrip({
  daysRemaining,
  progressPct,
}: LoanTermStripProps) {
  const { t } = useTranslation();

  const hasTimingInfo =
    typeof daysRemaining === "number" &&
    Number.isFinite(daysRemaining) &&
    typeof progressPct === "number" &&
    Number.isFinite(progressPct);

  if (!hasTimingInfo) return null;

  const d = daysRemaining as number;
  const rawPct = progressPct as number;

  const safePct = Math.max(0, Math.min(120, rawPct)); // dejo un pequeño margen por si se pasa un poco

  // ---- Texto de tiempo ----
  let timeLabel: string;
  if (d > 1) {
    const count = Math.ceil(d);
    timeLabel = t("borrow.term.timeRemainingDays", { count });
  } else if (d > 0) {
    timeLabel = t("borrow.term.timeRemainingLessThanOne");
  } else if (d > -1) {
    timeLabel = t("borrow.term.timeDueToday");
  } else {
    const count = Math.abs(Math.floor(d));
    timeLabel = t("borrow.term.timeOverdueDays", { count });
  }

  const isOverdue = d < 0;
  const statusLabel = isOverdue
    ? t("borrow.term.statusOverdue")
    : t("borrow.term.statusOnTime");
  const statusClasses = isOverdue
    ? "bg-red-100 text-red-700 border border-red-200"
    : "bg-emerald-100 text-emerald-800 border border-emerald-200";

  // ---- Color de la barra según progreso / vencido ----
  let barClass =
    "bg-emerald-500"; // default: verde (recién empezado)

  if (isOverdue) {
    barClass = "bg-red-500";
  } else if (safePct >= 80) {
    barClass = "bg-orange-500"; // cerca de vencer
  } else if (safePct >= 50) {
    barClass = "bg-amber-400"; // mitad del camino
  }

  return (
    <div
      className={[
        "mx-auto mb-4 w-full max-w-md rounded-2xl border bg-card px-4 py-4 sm:px-5",
        isOverdue ? "border-red-200" : "border-border/40",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-3">
        {/* Izquierda: título + texto */}
        <div>
          <div className="text-[11px] mono-text uppercase tracking-[0.18em] text-foreground/70">
            {t("borrow.term.header")}
          </div>
          <div className={`mt-1 flex items-center gap-1.5 text-[12px] ${isOverdue ? "font-medium text-red-600" : "text-foreground/85"}`}>
            {isOverdue && <CalendarX2 className="h-3.5 w-3.5 shrink-0 text-red-500" />}
            {timeLabel}
          </div>
        </div>

        {/* Derecha: chip de estado */}
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${statusClasses}`}
        >
          {statusLabel}
        </span>
      </div>

      {/* Barra de progreso */}
      <div className="mt-3">
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-border/60">
          <div
            className={`h-full rounded-full transition-[width] duration-500 ease-out ${barClass}`}
            style={{ width: `${Math.min(100, safePct)}%` }}
          />
        </div>

        <div className="mt-2 flex items-center justify-between text-[11px] leading-snug">
          <span className="mono-text text-foreground/70">{t("borrow.term.progressStart")}</span>
          {isOverdue ? (
            <span className="mono-text font-semibold text-red-600">
              {t("borrow.term.progressOverdue")}
            </span>
          ) : (
            <span className="mono-text font-semibold text-foreground">
              {Math.round(safePct)}%
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
