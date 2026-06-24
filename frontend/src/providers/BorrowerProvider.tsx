// src/providers/BorrowerProvider.tsx
"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { useAccount } from "wagmi";

import type { AchievementSummary } from "@shared/types/achievement";

import { useAuthStore } from "@/stores/authStore";
import { useVerificationStore } from "@/stores/verificationStore";
import { useCreditStore } from "@/stores/creditStore";
import { useGamificationStore } from "@/stores/gamificationStore";
import { useLoanStatsStore } from "@/stores/loanStatsStore";
import { setLoanStatsFromJourney } from "@/stores/actions/setLoanStatsFromJourney";
import { useRefreshAccessToken } from "@/hooks/borrow/useRefreshAccessToken";
import { useRefreshLoanStats } from "@/hooks/borrow/useRefreshLoanStats";

export type { AchievementSummary };

type BorrowerContextType = {
  ready: boolean;
  authLoading: boolean;

  isVerified: boolean;
  setIsVerified: (value: boolean) => void;

  goToWaitlist: boolean;
  setGoToWaitlist: (value: boolean) => void;
  waitlistChecking: boolean;

  hasAcceptedTerms: boolean;
  setHasAcceptedTerms: (value: boolean) => void;

  accessToken: string | null;
  refreshAccessToken: () => Promise<string | null>;

  creditScoreDisplay: string | null;
  setCreditScoreDisplay: (value: string | null) => void;

  creditScoreRaw: number | null;
  setCreditScoreRaw: (value: number | null) => void;
  /** Spec 028 — high-water-mark setter; refuses writes below the optimistic floor. */
  setCreditScoreRawHwm: (value: number | null) => void;

  xp: number | null;
  setXp: (value: number | null) => void;

  achievementsCount: number | null;
  setAchievementsCount: (value: number | null) => void;

  latestAchievements: AchievementSummary[] | null;
  setLatestAchievements: (value: AchievementSummary[] | null) => void;

  loansCount: number | null;
  closedLoansCount: number | null;
  loansOnTimeCount: number | null;
  onTimePercent: number | null;
  loanStatsLoading: boolean;

  refreshLoanStats: (walletAddress?: string | null) => Promise<void>;

  setLoanStatsFromJourney: (
    total?: number | null,
    closed?: number | null,
    onTime?: number | null,
    open?: number | null,
    xp?: number | null,
    achievementsCount?: number | null,
  ) => void;
};

const BorrowerContext = createContext<BorrowerContextType | null>(null);

export function BorrowerProvider({ children }: { children: React.ReactNode }) {
  const { address } = useAccount();

  // Hooks that need React (wagmi, wallet provider)
  const refreshAccessToken = useRefreshAccessToken();
  const refreshLoanStats = useRefreshLoanStats(refreshAccessToken);

  // Read from Zustand stores
  const { accessToken, authLoading } = useAuthStore();
  const {
    isVerified,
    setIsVerified,
    goToWaitlist,
    setGoToWaitlist,
    hasAcceptedTerms,
    setHasAcceptedTerms,
  } = useVerificationStore();
  const {
    creditScoreDisplay,
    setCreditScoreDisplay,
    creditScoreRaw,
    setCreditScoreRaw,
    setCreditScoreRawHwm,
  } = useCreditStore();
  const {
    xp,
    setXp,
    achievementsCount,
    setAchievementsCount,
    latestAchievements,
    setLatestAchievements,
  } = useGamificationStore();
  const {
    loansCount,
    closedLoansCount,
    loansOnTimeCount,
    onTimePercent,
    loanStatsLoading,
  } = useLoanStatsStore();

  // Reset all stores on wallet change
  const prevWalletRef = useRef<string | null>(null);

  useEffect(() => {
    const current = address?.toLowerCase() || null;

    if (prevWalletRef.current === null) {
      prevWalletRef.current = current;

      // On initial mount, check if the stored token belongs to a different wallet.
      // This happens when the user reconnects with a different wallet after a page reload.
      if (current) {
        try {
          const tokenWallet = localStorage.getItem("lendoor:tokenWallet")?.toLowerCase();
          if (tokenWallet && tokenWallet !== current) {
            console.log("[Borrower] Stale token for wallet", tokenWallet, "but current is", current, "— clearing auth");
            useAuthStore.getState().clearAuth();
          }
        } catch { /* */ }
      }
      return;
    }

    if (prevWalletRef.current === current) return;

    console.log("[Borrower] Wallet changed, resetting borrower state", {
      from: prevWalletRef.current,
      to: current,
    });

    prevWalletRef.current = current;

    useAuthStore.getState().clearAuth();
    useVerificationStore.getState().reset();
    useCreditStore.getState().reset();
    useGamificationStore.getState().reset();
    useLoanStatsStore.getState().reset();
  }, [address]);

  const value: BorrowerContextType = useMemo(
    () => ({
      ready: true,
      authLoading,

      isVerified,
      setIsVerified,
      goToWaitlist,
      setGoToWaitlist,
      waitlistChecking: false,

      hasAcceptedTerms,
      setHasAcceptedTerms,

      accessToken,
      refreshAccessToken,

      creditScoreDisplay,
      setCreditScoreDisplay,
      creditScoreRaw,
      setCreditScoreRaw,
      setCreditScoreRawHwm,

      xp,
      setXp,
      achievementsCount,
      setAchievementsCount,
      latestAchievements,
      setLatestAchievements,

      loansCount,
      closedLoansCount,
      loansOnTimeCount,
      onTimePercent,
      loanStatsLoading,
      refreshLoanStats,
      setLoanStatsFromJourney,
    }),
    [
      authLoading,
      isVerified,
      setIsVerified,
      goToWaitlist,
      setGoToWaitlist,
      hasAcceptedTerms,
      setHasAcceptedTerms,
      accessToken,
      refreshAccessToken,
      creditScoreDisplay,
      setCreditScoreDisplay,
      creditScoreRaw,
      setCreditScoreRaw,
      setCreditScoreRawHwm,
      xp,
      setXp,
      achievementsCount,
      setAchievementsCount,
      latestAchievements,
      setLatestAchievements,
      loansCount,
      closedLoansCount,
      loansOnTimeCount,
      onTimePercent,
      loanStatsLoading,
      refreshLoanStats,
    ],
  );

  return (
    <BorrowerContext.Provider value={value}>
      {children}
    </BorrowerContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useBorrower() {
  const ctx = useContext(BorrowerContext);
  if (!ctx) {
    throw new Error("useBorrower must be used within <BorrowerProvider>");
  }
  return ctx;
}
