// src/components/borrow/CreditPerformanceStrip.tsx
"use client";

import * as React from "react";
import { Card } from "@/components/ui/card";
import { TrendingUp, Target, Award } from "lucide-react";
import { useLoanStatsStore } from "@/stores/loanStatsStore";
import { useGamificationStore } from "@/stores/gamificationStore";
import { useTranslation } from "@/i18n/useTranslation";

function formatInt(value: number | null | undefined): string {
  const n =
    typeof value === "number" && Number.isFinite(value)
      ? Math.floor(value)
      : 0;
  return n.toString();
}

function formatPercent(value: number | null | undefined): string {
  const n =
    typeof value === "number" && Number.isFinite(value)
      ? Math.round(value)
      : 0;
  return `${n}%`;
}

function MiniStatCard(props: {
  icon: React.ReactNode;
  value: string;
  label: string;
}) {
  const { icon, value, label } = props;

  return (
    <Card
      className="
        flex flex-1 flex-col items-center justify-center
        gap-1.5
        rounded-xl
        border border-border/60
        bg-card
        px-2 py-1.5
        sm:px-3 sm:py-2
      "
    >
      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted/60">
        {icon}
      </div>
      <div className="text-[1rem] font-semibold leading-tight tabular-nums">
        {value}
      </div>
      <div className="text-[10px] leading-tight text-muted-foreground">
        {label}
      </div>
    </Card>
  );
}

export function CreditPerformanceStrip() {
  const loansCount = useLoanStatsStore((s) => s.loansCount);
  const onTimePercent = useLoanStatsStore((s) => s.onTimePercent);
  const achievementsCount = useGamificationStore((s) => s.achievementsCount);
  const { t } = useTranslation();

  const totalLoans = loansCount ?? 0;
  const effectiveOnTimePercent =
    typeof onTimePercent === "number" && Number.isFinite(onTimePercent)
      ? onTimePercent
      : 0;
  const effectiveAchievements = achievementsCount ?? 0;

  const loansLabel = formatInt(totalLoans);
  const onTimeLabel = formatPercent(effectiveOnTimePercent);
  const achievementsLabel = formatInt(effectiveAchievements);

  return (
    <div className="w-full max-w-md mx-auto px-4 mb-3">
      <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
        <MiniStatCard
          icon={<TrendingUp className="h-4 w-4 text-orange-500" />}
          value={loansLabel}
          label={t("borrow.performance.loans")}
        />
        <MiniStatCard
          icon={<Target className="h-4 w-4 text-emerald-600" />}
          value={onTimeLabel}
          label={t("borrow.performance.onTime")}
        />
        <MiniStatCard
          icon={<Award className="h-4 w-4 text-amber-500" />}
          value={achievementsLabel}
          label={t("borrow.performance.achievements")}
        />
      </div>
    </div>
  );
}

export default CreditPerformanceStrip;
