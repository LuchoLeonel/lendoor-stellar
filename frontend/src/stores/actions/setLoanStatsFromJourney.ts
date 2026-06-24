import { useLoanStatsStore } from "@/stores/loanStatsStore";
import { useGamificationStore } from "@/stores/gamificationStore";

function safeNonNegative(v: number | null | undefined): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return 0;
  return v;
}

export function setLoanStatsFromJourney(
  total?: number | null,
  closed?: number | null,
  onTime?: number | null,
  // Spec 055 — count of loans the user can still repay on-chain
  // (closeTxHash IS NULL + open/defaulted/in_grace). Powers the
  // phone-verify bypass in Borrow.tsx.
  open?: number | null,
  xpValue?: number | null,
  achievementsValue?: number | null,
  // Spec 028 — opt-in HWM mode. When true, the three "ever-increasing"
  // counters (total/closed/onTime) are written with setXxxHwm so an
  // optimistic increment applied right after a repay survives a stale
  // backend response. Note: `openLoansCount` is intentionally NOT HWM-gated
  // — repaying DECREMENTS it, so HWM would block the optimistic update.
  useHwm = false,
): void {
  const totalSafe = safeNonNegative(total);
  const closedSafe = safeNonNegative(closed);
  const onTimeSafe = safeNonNegative(onTime);
  const openSafe = safeNonNegative(open);

  let pct = 0;
  if (closedSafe > 0 && onTimeSafe > 0) {
    pct = (onTimeSafe / closedSafe) * 100;
    pct = Math.max(0, Math.min(100, pct));
  }

  const loanStats = useLoanStatsStore.getState();
  if (useHwm) {
    loanStats.setLoansCountHwm(totalSafe);
    loanStats.setClosedLoansCountHwm(closedSafe);
    loanStats.setLoansOnTimeCountHwm(onTimeSafe);
  } else {
    loanStats.setLoansCount(totalSafe);
    loanStats.setClosedLoansCount(closedSafe);
    loanStats.setLoansOnTimeCount(onTimeSafe);
  }
  loanStats.setOpenLoansCount(openSafe);
  loanStats.setOnTimePercent(pct);

  const gamification = useGamificationStore.getState();

  if (typeof xpValue === "number" && Number.isFinite(xpValue)) {
    gamification.setXp(Math.max(0, xpValue));
  }

  if (
    typeof achievementsValue === "number" &&
    Number.isFinite(achievementsValue)
  ) {
    gamification.setAchievementsCount(
      Math.max(0, Math.floor(achievementsValue)),
    );
  }
}
