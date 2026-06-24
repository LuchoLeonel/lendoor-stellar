// src/components/borrow/CoolDownPanel.tsx
"use client";

import * as React from "react";
import { Timer } from "lucide-react";
import { useTranslation } from "@/i18n/useTranslation";
type CooldownPanelProps = {
  cooldownUntil: Date | null;
  cooldownSecondsLeft: number | null;
};

function getInitialRemainingMs(
  cooldownUntil: Date | null,
  cooldownSecondsLeft: number | null,
): number {
  if (typeof cooldownSecondsLeft === "number" && cooldownSecondsLeft > 0) {
    return cooldownSecondsLeft * 1000;
  }
  if (cooldownUntil) {
    return Math.max(0, cooldownUntil.getTime() - Date.now());
  }
  return 0;
}

export function CooldownPanel({
  cooldownUntil,
  cooldownSecondsLeft,
}: CooldownPanelProps) {
  const { t } = useTranslation();

  const [remainingMs, setRemainingMs] = React.useState(() =>
    getInitialRemainingMs(cooldownUntil, cooldownSecondsLeft),
  );

  React.useEffect(() => {
    setRemainingMs(getInitialRemainingMs(cooldownUntil, cooldownSecondsLeft));
  }, [cooldownUntil, cooldownSecondsLeft]);

  React.useEffect(() => {
    if (!cooldownUntil && (cooldownSecondsLeft == null || cooldownSecondsLeft <= 0)) return;
    if (remainingMs <= 0) return;

    const id = setInterval(() => {
      setRemainingMs((prev) => {
        if (cooldownUntil) return Math.max(0, cooldownUntil.getTime() - Date.now());
        const next = prev - 1000;
        return next > 0 ? next : 0;
      });
    }, 1000);

    return () => clearInterval(id);
  }, [cooldownUntil, cooldownSecondsLeft, remainingMs]);

  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const hasTime = totalSeconds > 0;
  const pad2 = (n: number) => n.toString().padStart(2, "0");

  return (
    <div className="flex flex-col items-center text-center px-6">
      {/* Icon */}
      <div
        className="flex h-14 w-14 items-center justify-center rounded-2xl mb-5"
        style={{ backgroundColor: '#fef3e8' }}
      >
        <Timer className="h-6 w-6 text-primary" />
      </div>

      {/* Title */}
      <h3 className="text-[18px] font-bold text-foreground leading-tight">
        {t("borrow.cooldown.title")}
      </h3>

      <p className="mt-2 text-[13px] leading-snug text-muted-foreground max-w-[280px]">
        {t("borrow.cooldown.description")}
      </p>

      {/* Countdown */}
      {hasTime ? (
        <div
          className="mt-6 w-full rounded-2xl px-5 py-5"
          style={{
            background: 'linear-gradient(160deg, #0c1017 0%, #151c28 40%, #1a2435 100%)',
            border: '1px solid rgba(255,255,255,0.07)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.20)',
          }}
        >
          <p className="text-[10px] uppercase tracking-[0.15em] font-medium mb-3" style={{ color: 'rgba(255,255,255,0.40)' }}>
            {t("borrow.cooldown.countdownHeader")}
          </p>

          {/* Timer display */}
          <div className="flex items-center justify-center gap-3">
            {days > 0 && (
              <div className="flex flex-col items-center">
                <span className="text-[32px] font-bold tabular-nums leading-none text-white">{days}</span>
                <span className="mt-1 text-[10px] text-white/40">días</span>
              </div>
            )}
            {days > 0 && <span className="text-[24px] font-light text-white/20 pb-3">:</span>}
            <div className="flex flex-col items-center">
              <span className="text-[32px] font-bold tabular-nums leading-none text-white">{pad2(hours)}</span>
              <span className="mt-1 text-[10px] text-white/40">hs</span>
            </div>
            <span className="text-[24px] font-light text-white/20 pb-3">:</span>
            <div className="flex flex-col items-center">
              <span className="text-[32px] font-bold tabular-nums leading-none text-white">{pad2(minutes)}</span>
              <span className="mt-1 text-[10px] text-white/40">min</span>
            </div>
            <span className="text-[24px] font-light text-white/20 pb-3">:</span>
            <div className="flex flex-col items-center">
              <span className="text-[32px] font-bold tabular-nums leading-none" style={{ color: '#F97415' }}>{pad2(seconds)}</span>
              <span className="mt-1 text-[10px] text-white/40">seg</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-6 rounded-2xl bg-emerald-50/60 border border-emerald-200/50 px-5 py-4 w-full">
          <p className="text-[14px] font-semibold text-emerald-700 text-center">
            {t("borrow.cooldown.readyMessage")}
          </p>
        </div>
      )}
    </div>
  );
}
