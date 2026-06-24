// src/components/borrow/GamificationRoadmap.tsx
"use client";

import * as React from "react";
import {
  CheckCircle2,
  Crown,
  Globe,
  Info,
  Lock,
  Rocket,
  Shield,
  Sprout,
  Zap,
} from "lucide-react";
import { useCreditStore } from "@/stores/creditStore";
import { useLoanStatsStore } from "@/stores/loanStatsStore";
import { MAX_SCORE, MAX_CREDIT_LEVEL } from "@/lib/constants";
import { reputationScore } from "@/lib/reputationScore";
import { GridBackground } from "@/components/common/GridBackground";
import { TIERS, type TierDefinition, type TierState } from "@/lib/tiers";

// ---------------------------------------------------------------------------
// TIERS / TierDefinition / TierState come from @/lib/tiers (spec 023).
// This component uses Scheme B labels: Novato / Activo / Estable / Confiable
// / Referente / Leyenda. If you change the labels in tiers.ts, update the
// switch in TierIcon below to match.
// ---------------------------------------------------------------------------

function TierIcon({ groupLabel, className }: { groupLabel: string; className?: string }) {
  const cls = className ?? "h-5 w-5";
  switch (groupLabel) {
    case "Novato":    return <Sprout className={cls} />;
    case "Activo":    return <Rocket className={cls} />;
    case "Estable":   return <Globe  className={cls} />;
    case "Confiable": return <Shield className={cls} />;
    case "Referente": return <Zap    className={cls} />;
    case "Leyenda":   return <Crown  className={cls} />;
    default:          return <Sprout className={cls} />;
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatPill({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div
      className={[
        "flex flex-col items-center rounded-xl px-3 py-2 min-w-[80px]",
        muted ? "bg-muted/40" : "bg-background shadow-sm",
      ].join(" ")}
    >
      <span
        className={[
          "mono-text text-[9px] uppercase tracking-[0.16em] font-semibold",
          muted ? "text-muted-foreground/60" : "text-muted-foreground",
        ].join(" ")}
      >
        {label}
      </span>
      <span
        className={[
          "mt-0.5 text-[13px] font-semibold tabular-nums leading-tight",
          muted ? "text-muted-foreground/50" : "text-foreground",
        ].join(" ")}
      >
        {value}
      </span>
    </div>
  );
}

interface TierCardProps {
  tier: TierDefinition;
  state: TierState;
  repagosNeeded: number;
}

function TierCard({ tier, state, repagosNeeded }: TierCardProps) {
  const isCurrent = state === "current";
  const isPast    = state === "past";
  const isLocked  = state === "locked";

  return (
    <div
      className={[
        "relative rounded-2xl border-2 px-4 py-3.5 transition-all duration-200",
        isCurrent
          ? "border-primary/70 bg-card shadow-md"
          : isPast
            ? "border-border/40 bg-muted/30"
            : "border-border/40 bg-card/60",
      ].join(" ")}
    >
      {/* ---- "NIVEL ACTUAL" badge (current only) ---- */}
      {isCurrent && (
        <div className="absolute -top-3 left-4">
          <span className="mono-text inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.18em] text-primary-foreground shadow-sm">
            NIVEL ACTUAL
          </span>
        </div>
      )}

      {/* ---- Main row ---- */}
      <div className="flex items-center gap-3">
        {/* Emoji icon circle */}
        <div
          className={[
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl",
            isCurrent
              ? "bg-primary/10 shadow-sm"
              : isPast
                ? "bg-muted/60"
                : "bg-muted/40",
          ].join(" ")}
          aria-hidden="true"
        >
          {isLocked ? (
            <Lock className="h-4 w-4 text-muted-foreground/40" />
          ) : (
            <TierIcon
              groupLabel={tier.groupLabel}
              className={[
                "h-5 w-5",
                isCurrent ? "text-primary" : "text-muted-foreground/50",
              ].join(" ")}
            />
          )}
        </div>

        {/* Title + XP hint */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={[
                "text-[13px] font-semibold leading-tight truncate",
                isCurrent
                  ? "text-foreground"
                  : isPast
                    ? "text-muted-foreground"
                    : "text-muted-foreground/70",
              ].join(" ")}
            >
              {tier.name}
            </span>

            {/* Checkmark for past or current */}
            {(isCurrent || isPast) && (
              <CheckCircle2
                className={[
                  "h-4 w-4 shrink-0",
                  isCurrent ? "text-primary" : "text-emerald-500",
                ].join(" ")}
              />
            )}
          </div>

          {/* Repagos to unlock (locked tiers only) */}
          {isLocked && (
            <p className="mt-0.5 text-[11px] font-medium text-primary">
              {repagosNeeded} repago(s) más
            </p>
          )}

          {/* Unlocked label for past tiers */}
          {isPast && (
            <p className="mt-0.5 text-[11px] text-muted-foreground/60">
              Desbloqueado
            </p>
          )}
        </div>
      </div>

      {/* ---- Stat pills (always shown, grayed out when locked) ---- */}
      <div className="mt-3 flex items-center gap-2">
        <StatPill
          label="Tu Límite"
          value={`$${tier.limitUsdc} USDC`}
          muted={isLocked}
        />

        {/* Spacer + score badge */}
        <div className="ml-auto">
          <span
            className={[
              "mono-text inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest",
              isCurrent
                ? "bg-primary/10 text-primary"
                : isPast
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-muted/60 text-muted-foreground/50",
            ].join(" ")}
          >
            Score {tier.score}
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// XP Progress card
// ---------------------------------------------------------------------------

function XpProgressCard({
  repScore,
  progressPct,
}: {
  repScore: number;
  progressPct: number;
}) {
  return (
    <div className="mx-auto mb-3 w-full max-w-md px-4">
      <div className="rounded-2xl border-2 border-border/60 bg-card px-4 py-4 shadow-sm">
        {/* Header row */}
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="mono-text text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              TU REPUTACIÓN
            </p>
            <p className="mt-0.5 text-[22px] font-semibold tabular-nums leading-none">
              {repScore}
              <span className="ml-1 text-[13px] font-normal text-muted-foreground">
                / 1000
              </span>
            </p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-3">
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-background">
            <div
              className="h-full rounded-full transition-[width] duration-500 ease-out"
              style={{
                width: `${Math.max(0, Math.min(100, progressPct))}%`,
                backgroundColor: "#64748b",
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

function GamificationRoadmap() {
  const creditScoreRaw = useCreditStore((s) => s.creditScoreRaw);
  const loansOnTimeCount = useLoanStatsStore((s) => s.loansOnTimeCount);

  // ---- Derived values ----
  const hasScore =
    typeof creditScoreRaw === "number" && Number.isFinite(creditScoreRaw);
  const score = hasScore ? Math.max(1, Math.min(MAX_CREDIT_LEVEL, creditScoreRaw as number)) : 0;

  // ---- Reputation score ----
  const repScore = reputationScore(loansOnTimeCount ?? 0);
  const progressPct = Math.round((repScore / MAX_SCORE) * 100);

  // ---- Tier state helper ----
  function tierState(tier: TierDefinition): TierState {
    if (!hasScore) return "locked";
    if (tier.score === score) return "current";
    if (tier.score < score)  return "past";
    return "locked";
  }

  function repagosNeededForTier(tier: TierDefinition): number {
    return Math.max(0, (tier.score - 1) - (loansOnTimeCount ?? 0));
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-background">
      {/* Grid background */}
      <GridBackground />

      {/* Scrollable content */}
      <div className="relative z-10 pb-8 pt-2">
        {/* ---- Header ---- */}
        <div className="mx-auto mb-4 w-full max-w-md px-4">
          <div className="flex flex-col items-center gap-1 pt-4 text-center">
            <span className="text-5xl leading-none" aria-hidden="true">
              🏆
            </span>
            <h1 className="mt-2 text-[1.5rem] font-bold leading-tight">
              Tu Camino
            </h1>
            <p className="text-[13px] leading-snug text-muted-foreground">
              Cada pago a tiempo sube tu score y desbloquea nuevos niveles.
            </p>
          </div>
        </div>

        {/* ---- XP progress card ---- */}
        <XpProgressCard
          repScore={repScore}
          progressPct={progressPct}
        />

        {/* ---- Info note ---- */}
        <div className="mx-auto mb-4 w-full max-w-md px-4">
          <div className="flex items-start gap-2.5 rounded-xl bg-muted/60 px-4 py-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary/60" />
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              Tu score sube automáticamente cuando completás pagos a tiempo y acumulás
              suficiente XP. Cada nivel desbloquea un mayor límite de crédito.
            </p>
          </div>
        </div>

        {/* ---- Section label ---- */}
        <div className="mx-auto mb-2 w-full max-w-md px-4">
          <p className="mono-text text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            ESCALERA DE CRÉDITO
          </p>
        </div>

        {/* ---- Tier cards (scrollable list) ---- */}
        <div className="mx-auto w-full max-w-md space-y-3 px-4">
          {TIERS.map((tier) => {
            const state = tierState(tier);
            return (
              <TierCard
                key={tier.score}
                tier={tier}
                state={state}
                repagosNeeded={repagosNeededForTier(tier)}
              />
            );
          })}
        </div>

        {/* ---- Bottom motivational note ---- */}
        <div className="mx-auto mt-6 w-full max-w-md px-4">
          <div className="flex items-start gap-2.5 rounded-xl bg-primary/5 px-4 py-3">
            <span className="text-lg leading-none" aria-hidden="true">
              💡
            </span>
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              Los límites de crédito en USDC aumentan a medida que construís historial.
              Repagá siempre antes del vencimiento para maximizar tu XP.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default GamificationRoadmap;
