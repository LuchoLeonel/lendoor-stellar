// src/components/borrow/CreditScoreShowcase.tsx
"use client";

import * as React from "react";
import { Trophy } from "lucide-react";
import { useCreditStore } from "@/stores/creditStore";
import { useLoanStatsStore } from "@/stores/loanStatsStore";
import { MAX_SCORE } from "@/lib/constants";
import { reputationScore } from "@/lib/reputationScore";
import { useTranslation } from "@/i18n/useTranslation";

// Tier limits for level info display
const TIER_LIMITS: Record<number, number> = {
  1: 1, 2: 3, 3: 4, 4: 6, 5: 8, 6: 10, 7: 12, 8: 15, 9: 18, 10: 22, 11: 25,
};

function CreditScoreShowcase() {
  const creditScoreRaw = useCreditStore((s) => s.creditScoreRaw);
  const loansOnTimeCount = useLoanStatsStore((s) => s.loansOnTimeCount);
  const { t } = useTranslation();

  // ---------- SCORE ----------
  const hasScore =
    typeof creditScoreRaw === "number" && Number.isFinite(creditScoreRaw);

  const score = hasScore ? Math.max(0, creditScoreRaw as number) : 0;

  // ---------- Reputation score ----------
  const repScore = reputationScore(loansOnTimeCount ?? 0);

  // Progress bar based on reputation score
  const pctBase = (repScore / MAX_SCORE) * 100;
  const targetPct = Math.max(0, Math.min(100, Math.round(pctBase)));

  // Bounce visual del número de score
  const [scoreBump, setScoreBump] = React.useState(false);
  const prevScoreRef = React.useRef<number | null>(null);

  // Simple progress state (no level-up animation needed)
  const [displayProgress, setDisplayProgress] = React.useState(0);
  const prevProgressRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    let timeoutScoreBump: number | undefined;

    // ====== SCORE: detectar cambio para arriba ======
    if (!hasScore) {
      prevScoreRef.current = null;
      setScoreBump(false);
    } else {
      const prevScore = prevScoreRef.current;
      prevScoreRef.current = score;

      if (prevScore !== null && score > prevScore) {
        setScoreBump(true);
        timeoutScoreBump = window.setTimeout(
          () => setScoreBump(false),
          420,
        );
      }
    }

    // ====== Progress bar ======
    if (prevProgressRef.current === null) {
      prevProgressRef.current = targetPct;
      setDisplayProgress(targetPct);
    } else {
      prevProgressRef.current = targetPct;
      setDisplayProgress(targetPct);
    }

    return () => {
      if (timeoutScoreBump) window.clearTimeout(timeoutScoreBump);
    };
  }, [targetPct, hasScore, score]);

  // Evitar que se vea una rayita 1px cuando hay poquito progreso
  const effectiveDisplayProgress =
    displayProgress > 0 && displayProgress < 4
      ? 4
      : displayProgress;

  // Level info for display below bar
  const limitUsdc = TIER_LIMITS[score] ?? TIER_LIMITS[1];

  return (
    <div className="mx-auto mb-4 w-full max-w-md px-4">
      <div className="rounded-2xl border-2 border-border/60 bg-muted px-4 py-3.5 shadow-sm sm:px-5 sm:py-4">
        {/* Fila superior */}
        <div className="flex items-start justify-between gap-3">
          {/* Izquierda: icono + score */}
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-background shadow-sm">
              <Trophy className="h-4 w-4 text-amber-500" />
            </div>

            <div>
              <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
                {t("borrow.score.header")}
              </div>

              <div className="mt-1 flex items-end gap-2">
                <span
                  className={
                    "tabular-nums text-[1.9rem] font-semibold leading-none transform transition-transform duration-300" +
                    (scoreBump
                      ? " scale-110 text-amber-500 drop-shadow-[0_0_10px_rgba(245,158,11,0.75)]"
                      : "")
                  }
                >
                  {repScore > 0 ? repScore : hasScore ? 0 : "—"}
                </span>

                {/* Chip: score / MAX_SCORE */}
                <span className="mb-0.5 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                  <span className="inline-flex items-center gap-1">
                    <span className="text-[10px] text-amber-700/90">
                      / {MAX_SCORE}
                    </span>
                  </span>
                </span>
              </div>

              <p className="mt-1 text-[11px] text-muted-foreground">
                {t("borrow.score.description")}
              </p>
            </div>
          </div>

          {/* Derecha: badge Early user (por ahora hardcode) */}
          <div className="flex flex-row items-start gap-1 self-start">
            <span className="mt-1 inline-flex items-center whitespace-nowrap rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600">
              {t("borrow.score.earlyUserBadge")}
            </span>
          </div>
        </div>

        {/* Barra de XP */}
        <div className="mt-4">
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-background">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
              style={{
                width: `${effectiveDisplayProgress}%`,
              }}
            />
          </div>

          <div className="mt-2 flex items-center text-[11px] leading-snug">
            <span className="ml-1.5 font-medium">
              Nivel {score} · ${limitUsdc} USDC
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CreditScoreShowcase;
