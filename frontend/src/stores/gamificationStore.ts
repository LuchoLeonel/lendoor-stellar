import { create } from "zustand";
import type { AchievementSummary } from "@shared/types/achievement";
import type { ReputationGainPayload } from "@shared/types/api";

type GamificationState = {
  xp: number | null;
  achievementsCount: number | null;
  latestAchievements: AchievementSummary[] | null;
  /**
   * Spec 023 — pending reputation-points celebration from the last on-time
   * repayment. Populated by useRepay.ts / useRepaymentRecovery.ts when the
   * inform-repayment response carries a non-null `reputationGain` with
   * `delta > 0`. Consumed by AchievementDialog.tsx → RepGainDialog branch.
   * Cleared on dialog close.
   */
  pendingRepGain: ReputationGainPayload | null;
  setXp: (value: number | null) => void;
  setAchievementsCount: (value: number | null) => void;
  setLatestAchievements: (value: AchievementSummary[] | null) => void;
  setPendingRepGain: (value: ReputationGainPayload | null) => void;
  reset: () => void;
};

export const useGamificationStore = create<GamificationState>((set) => ({
  xp: null,
  achievementsCount: null,
  latestAchievements: null,
  pendingRepGain: null,

  setXp: (value) => set({ xp: value }),
  setAchievementsCount: (value) => set({ achievementsCount: value }),
  setLatestAchievements: (value) => set({ latestAchievements: value }),
  setPendingRepGain: (value) => set({ pendingRepGain: value }),

  reset: () =>
    set({
      xp: null,
      achievementsCount: null,
      latestAchievements: null,
      pendingRepGain: null,
    }),
}));
