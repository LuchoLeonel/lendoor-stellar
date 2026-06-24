import { create } from "zustand";

type LoanStatsState = {
  loansCount: number | null;
  closedLoansCount: number | null;
  loansOnTimeCount: number | null;
  // Spec 055 — count of loans with closeTxHash IS NULL + open/defaulted/in_grace status.
  // Drives the phone-verify bypass: if openLoansCount > 0 the user owes money and
  // must be able to reach the RepayPanel regardless of phone verification status.
  openLoansCount: number | null;
  onTimePercent: number | null;
  loanStatsLoading: boolean;
  setLoansCount: (value: number | null) => void;
  setClosedLoansCount: (value: number | null) => void;
  setLoansOnTimeCount: (value: number | null) => void;
  setOpenLoansCount: (value: number | null) => void;
  setOnTimePercent: (value: number | null) => void;
  setLoanStatsLoading: (value: boolean) => void;

  // Spec 028 — HWM setters. Only write if value >= current (or current is null).
  // Used by backend response handlers so a stale read doesn't undo the
  // optimistic increment we applied immediately after the on-chain repay.
  setLoansCountHwm: (value: number | null) => void;
  setClosedLoansCountHwm: (value: number | null) => void;
  setLoansOnTimeCountHwm: (value: number | null) => void;

  reset: () => void;
};

function maxOrNull(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(a, b);
}

export const useLoanStatsStore = create<LoanStatsState>((set, get) => ({
  loansCount: null,
  closedLoansCount: null,
  loansOnTimeCount: null,
  openLoansCount: null,
  onTimePercent: null,
  loanStatsLoading: false,

  setLoansCount: (value) => set({ loansCount: value }),
  setClosedLoansCount: (value) => set({ closedLoansCount: value }),
  setLoansOnTimeCount: (value) => set({ loansOnTimeCount: value }),
  setOpenLoansCount: (value) => set({ openLoansCount: value }),
  setOnTimePercent: (value) => set({ onTimePercent: value }),
  setLoanStatsLoading: (value) => set({ loanStatsLoading: value }),

  setLoansCountHwm: (value) =>
    set({ loansCount: maxOrNull(get().loansCount, value) }),
  setClosedLoansCountHwm: (value) =>
    set({ closedLoansCount: maxOrNull(get().closedLoansCount, value) }),
  setLoansOnTimeCountHwm: (value) =>
    set({ loansOnTimeCount: maxOrNull(get().loansOnTimeCount, value) }),

  reset: () =>
    set({
      loansCount: null,
      closedLoansCount: null,
      loansOnTimeCount: null,
      openLoansCount: null,
      onTimePercent: null,
      loanStatsLoading: false,
    }),
}));
