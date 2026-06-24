import { create } from "zustand";

type CreditState = {
  creditScoreDisplay: string | null;
  creditScoreRaw: number | null;

  // Spec 028 — high-water-mark optimistic values.
  // Set by useRepay after a successful on-chain repay tx, before the
  // backend has updated the on-chain credit score/limit. Cleared by
  // useCreditLine when on-chain catches up (or by TTL expiry).
  optimisticScoreRaw: number | null;
  optimisticLimitRaw: bigint | null; // 6-decimal USDC base units
  optimisticUntil: number | null; // epoch ms; auto-clear when expired

  setCreditScoreDisplay: (value: string | null) => void;
  setCreditScoreRaw: (value: number | null) => void;

  // Spec 028 — HWM setter: only writes if new value is null OR >= optimistic
  // floor. Used by callers that read on-chain or backend (useCreditLine poll,
  // useRepay backend response, useRepaymentRecovery). Prevents stale on-chain
  // value from "undoing" the optimistic UI update during the catch-up window.
  setCreditScoreRawHwm: (value: number | null) => void;

  setOptimistic: (args: {
    scoreRaw: number;
    limitRaw: bigint;
    untilMs: number;
  }) => void;
  clearOptimistic: () => void;

  reset: () => void;
};

export const useCreditStore = create<CreditState>((set, get) => ({
  creditScoreDisplay: null,
  creditScoreRaw: null,
  optimisticScoreRaw: null,
  optimisticLimitRaw: null,
  optimisticUntil: null,

  setCreditScoreDisplay: (value) => set({ creditScoreDisplay: value }),
  setCreditScoreRaw: (value) => set({ creditScoreRaw: value }),

  setCreditScoreRawHwm: (value) => {
    const state = get();

    // TTL expired → drop optimistic, allow regular writes
    if (state.optimisticUntil != null && Date.now() > state.optimisticUntil) {
      set({
        creditScoreRaw: value,
        optimisticScoreRaw: null,
        optimisticLimitRaw: null,
        optimisticUntil: null,
      });
      return;
    }

    // No optimistic floor → regular write
    if (state.optimisticScoreRaw == null) {
      set({ creditScoreRaw: value });
      return;
    }

    // Optimistic floor active.
    // - If incoming value is null (e.g. logout/reset) → still write null but
    //   ALSO clear optimistic, since a null score means we no longer have a
    //   trustworthy state.
    if (value == null) {
      set({
        creditScoreRaw: null,
        optimisticScoreRaw: null,
        optimisticLimitRaw: null,
        optimisticUntil: null,
      });
      return;
    }

    // - If on-chain caught up (value >= optimistic) → write & clear optimistic
    if (value >= state.optimisticScoreRaw) {
      set({
        creditScoreRaw: value,
        optimisticScoreRaw: null,
        optimisticLimitRaw: null,
        optimisticUntil: null,
      });
      return;
    }

    // - Otherwise on-chain still behind → keep optimistic visible, don't pisar
    set({ creditScoreRaw: state.optimisticScoreRaw });
  },

  setOptimistic: ({ scoreRaw, limitRaw, untilMs }) =>
    set({
      optimisticScoreRaw: scoreRaw,
      optimisticLimitRaw: limitRaw,
      optimisticUntil: untilMs,
      // Reflect the optimistic floor immediately on the visible field.
      creditScoreRaw: scoreRaw,
    }),

  clearOptimistic: () =>
    set({
      optimisticScoreRaw: null,
      optimisticLimitRaw: null,
      optimisticUntil: null,
    }),

  reset: () =>
    set({
      creditScoreDisplay: null,
      creditScoreRaw: null,
      optimisticScoreRaw: null,
      optimisticLimitRaw: null,
      optimisticUntil: null,
    }),
}));
