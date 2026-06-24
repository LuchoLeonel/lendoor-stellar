import { useCallback } from "react";
import { useWallet } from "@/providers/WalletProvider";
import { useLoanStatsStore } from "@/stores/loanStatsStore";
import { useCreditStore } from "@/stores/creditStore";
import { useVerificationStore } from "@/stores/verificationStore";
import { setLoanStatsFromJourney } from "@/stores/actions/setLoanStatsFromJourney";
import { LendoorApi } from "@/lib/api";
import type { Platform } from "@shared/types/platform";

export function useRefreshLoanStats(
  refreshAccessToken: () => Promise<string | null>,
): (walletAddress?: string | null) => Promise<void> {
  const { mode } = useWallet();
  const { setLoanStatsLoading } = useLoanStatsStore();
  const { setCreditScoreRawHwm } = useCreditStore();
  const { setHasAcceptedTerms } = useVerificationStore();

  return useCallback(
    async (walletAddress?: string | null) => {
      const w = walletAddress?.trim();
      if (!w) {
        const s = useLoanStatsStore.getState();
        s.setLoansCount(null);
        s.setClosedLoansCount(null);
        s.setLoansOnTimeCount(null);
        s.setOnTimePercent(0);
        return;
      }

      const platform: Platform =
        mode === "lemon" || mode === "farcaster" || mode === "webapp"
          ? mode
          : "webapp";

      setLoanStatsLoading(true);
      try {
        const api = new LendoorApi(refreshAccessToken);
        const data = await api.getUser(w, platform);

        // Spec 028 — useHwm=true so a stale backend response can't undo
        // the optimistic counter increment we applied right after the repay.
        // Spec 055 — `openLoansCount` is piped through but intentionally
        // NOT HWM-gated inside setLoanStatsFromJourney (it goes DOWN after
        // a successful repay, so HWM would block the legitimate decrement).
        setLoanStatsFromJourney(
          data.loansTotal ?? null,
          data.closedLoansTotal ?? null,
          data.loansOnTime ?? null,
          data.openLoansCount ?? null,
          data.xp ?? null,
          data.achievementsCount ?? null,
          true, // useHwm
        );

        if (typeof data.score === "number" && Number.isFinite(data.score)) {
          // HWM same reason as above
          setCreditScoreRawHwm(Math.max(0, data.score));
        }

        if (data.termsAcceptedAt !== undefined) {
          setHasAcceptedTerms(!!data.termsAcceptedAt);
        }
      } catch (e) {
        console.error("[refreshLoanStats] error", e);
        const s = useLoanStatsStore.getState();
        s.setLoansCount(null);
        s.setClosedLoansCount(null);
        s.setLoansOnTimeCount(null);
        s.setOnTimePercent(0);
      } finally {
        setLoanStatsLoading(false);
      }
    },
    [refreshAccessToken, mode, setLoanStatsLoading, setCreditScoreRawHwm, setHasAcceptedTerms],
  );
}
