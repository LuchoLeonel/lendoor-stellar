"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import * as React from "react";
import { Contract } from "ethers";

import { useTranslation } from "@/i18n/useTranslation";
import { useContracts } from "@/providers/ContractsProvider";
import { safeRead } from "@/lib/safeRead";
import { CLM_ADDRESS, MAX_SCORE } from "@/lib/constants";
import {
  withThousands,
  formatUSDCAmount2dp,
  formatUSDCAmount2dpTruncated,
} from "@/lib/utils";
import { useBorrower } from "@/providers/BorrowerProvider";
import { useWallet } from "@/providers/WalletProvider";
import { useCreditStore } from "@/stores/creditStore";
import { stellarReadCreditLine } from "@/lib/stellar-contracts";
import { normalizeWalletAddress } from "@/lib/wallet-address";

const CLM_ABI = [
  "function creditLimit(address) view returns (uint256)",
  "function users(address) view returns (uint16 score,bool kycOk,uint64 validUntil,uint64 lastUpdate,uint256 limit)",
  "function loans(address) view returns (uint128 principal,uint128 amountDue,uint64 start,uint64 due,uint16 feeBps,uint32 gracePeriod,bool active)",
  "function nextBorrowTime(address) view returns (uint64)",
  "function cooldownByTenor(uint16) view returns (uint32)",
  "function previewLoanWithLate(address) view returns (uint256 principal, uint256 amountDueWithLate)",
  "function premiums(address) view returns (uint128 premiumRatePerSecWad, uint128 lateRatePerSecWad)",
] as const;

/** Track whether an async fn completed or was caught by safeRead fallback */
function tracked<T>(fn: () => Promise<T>): [() => Promise<T>, { ok: boolean }] {
  const status = { ok: false };
  return [
    async () => {
      const r = await fn();
      status.ok = true;
      return r;
    },
    status,
  ];
}

type Options = { pollMs?: number };

export function useCreditLine({ pollMs = 15_000 }: Options = {}) {
  const { t } = useTranslation();

  const { evault, evaultJunior, connectedAddress } = useContracts();
  const { mode, primaryWallet } = useWallet();

  // address efectiva on-chain
  const rawUserAddress =
    mode === "stellar"
      ? primaryWallet?.address
      : (connectedAddress ?? primaryWallet?.address);
  const userAddress = normalizeWalletAddress(rawUserAddress, mode);
  const creditLineIdentity = userAddress ? `${mode}:${userAddress}` : null;
  const activeIdentityRef = React.useRef<string | null>(null);

  // 👇 ahora también traemos el setter del RAW.
  // Spec 028: setCreditScoreRawHwm respeta el optimistic floor — el poll
  // on-chain no puede bajar el score por debajo del valor optimistic
  // mientras está activo.
  const { setCreditScoreDisplay, setCreditScoreRaw, setCreditScoreRawHwm } =
    useBorrower();

  // -------- VISIBILIDAD TAB --------
  const [isVisible, setIsVisible] = React.useState(true);

  React.useEffect(() => {
    if (typeof document === "undefined") return;

    const handleVisibility = () => {
      setIsVisible(document.visibilityState === "visible");
    };

    handleVisibility();
    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  // -------- Score --------
  const [scoreRaw, setScoreRaw] = React.useState<number | null>(null);
  const [scoreDisplay, setScoreDisplay] = React.useState<string>(
    `—/${MAX_SCORE}`,
  );

  // -------- Límite / deuda --------
  const [limitRaw, setLimitRaw] = React.useState<bigint | null>(null);
  const [borrowedRaw, setBorrowedRaw] = React.useState<bigint | null>(null);

  const [borrowedDisplay, setBorrowedDisplay] = React.useState<string>("—");
  const [limitDisplay, setLimitDisplay] = React.useState<string>("—/—");

  // -------- Info de préstamo (timing) --------
  const [hasActiveLoan, setHasActiveLoan] = React.useState(false);
  const [loanStart, setLoanStart] = React.useState<Date | null>(null);
  const [loanDue, setLoanDue] = React.useState<Date | null>(null);
  const [daysRemaining, setDaysRemaining] = React.useState<number | null>(null);
  const [termDaysTotal, setTermDaysTotal] = React.useState<number | null>(null);
  const [termProgressPct, setTermProgressPct] = React.useState<number | null>(
    null,
  );
  const [loanFeeBps, setLoanFeeBps] = React.useState<number | null>(null);

  // -------- Mora --------
  const [isAccruingLateFees, setIsAccruingLateFees] = React.useState(false);

  // -------- Estado general --------
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // -------- Cooldown --------
  const [nextBorrowTimeRaw, setNextBorrowTimeRaw] = React.useState<
    bigint | null
  >(null);
  const [cooldownActive, setCooldownActive] = React.useState(false);
  const [cooldownSecondsLeft, setCooldownSecondsLeft] = React.useState<
    number | null
  >(null);
  const [cooldownUntil, setCooldownUntil] = React.useState<Date | null>(null);

  const runner = React.useMemo(
    () =>
      (evault as any)?.runner ??
      (evaultJunior as any)?.runner ??
      (evault as any)?.provider ??
      (evaultJunior as any)?.provider ??
      null,
    [evault, evaultJunior],
  );

  const clm = React.useMemo(() => {
    if (!runner) return null;
    if (!CLM_ADDRESS) {
      console.warn("[CLM] VITE_LOAN_MANAGER_ADDRESS no está seteada");
      return null;
    }
    return new Contract(CLM_ADDRESS, CLM_ABI, runner);
  }, [runner]);

  const resetState = React.useCallback(() => {
    setScoreRaw(null);
    setScoreDisplay(`—/${MAX_SCORE}`);
    setCreditScoreDisplay(null);
    setCreditScoreRaw(null);

    setLimitRaw(null);
    setBorrowedRaw(null);
    setBorrowedDisplay("—");
    setLimitDisplay("—/—");

    setHasActiveLoan(false);
    setLoanStart(null);
    setLoanDue(null);
    setDaysRemaining(null);
    setTermDaysTotal(null);
    setTermProgressPct(null);

    setNextBorrowTimeRaw(null);
    setCooldownActive(false);
    setCooldownSecondsLeft(null);
    setCooldownUntil(null);

    setIsAccruingLateFees(false);
    setLoanFeeBps(null);
  }, [setCreditScoreDisplay, setCreditScoreRaw]);

  React.useEffect(() => {
    activeIdentityRef.current = creditLineIdentity;
    resetState();
  }, [creditLineIdentity, resetState]);

  const read = React.useCallback(async () => {
    const requestIdentity = creditLineIdentity;
    if (!userAddress || !requestIdentity) {
      resetState();
      return;
    }

    if (mode !== "stellar" && !clm) {
      setError(t("hooks.useCreditLine.errors.clmUnavailable"));
      resetState();
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let limit: bigint = 0n;
      let loan: any = null;
      let userRisk: any = null;
      let nextBorrow: bigint = 0n;
      let latePreview: any = null;
      let premium: any = null;
      let limitOk = true;
      let loanOk = true;
      let lateOk = true;
      let premiumOk = true;

      if (mode === "stellar") {
        const stellar = await stellarReadCreditLine(userAddress);
        limit = stellar.limit;
        loan = stellar.loan;
        userRisk = stellar.userRisk;
        nextBorrow = stellar.nextBorrow;
        latePreview = stellar.latePreview;
        premium = stellar.premium;
      } else {
        const [limitFn, limitSt] = tracked<bigint>(() =>
          clm!.creditLimit(userAddress),
        );
        const [loanFn, loanSt] = tracked<any>(() =>
          (clm as any).loans(userAddress),
        );

        const [riskFn, _riskSt] = tracked<any>(() =>
          (clm as any).users(userAddress),
        );

        const [nbtFn, _nbtSt] = tracked<bigint>(() =>
          (clm as any).nextBorrowTime(userAddress),
        );
        const [lateFn, lateSt] = tracked<any>(() =>
          (clm as any).previewLoanWithLate(userAddress),
        );
        const [premFn, premSt] = tracked<any>(() =>
          (clm as any).premiums(userAddress),
        );

        // 🚨 Spec 077 — RPC read timeouts bumped from 3s → 10s.
        // The 3s budget was tight for ~95th-percentile mobile 3G/4G latency
        // to Celo Forno. When the connection is slow, all 6 reads time out,
        // every value falls back to its default (0n / null), and the UI ends
        // up trying to format/derive state from those nulls — produces the
        // "blank screen + bottom nav still visible" symptom Fabián captured
        // on Matías Cardone's screenshot (3G indicator visible). 10s covers
        // observed worst case without compromising the "loading" feel on
        // wifi/4G+.
        const [
          evmLimit,
          evmLoan,
          evmUserRisk,
          evmNextBorrow,
          evmLatePreview,
          evmPremium,
        ] = await Promise.all([
          safeRead<bigint>(limitFn, 0n, "clm:creditLimit", {
            toastOnError: false,
            timeoutMs: 10000,
          }),
          safeRead<any>(loanFn, null as any, "clm:loans", {
            toastOnError: false,
            timeoutMs: 10000,
          }),
          safeRead<any>(riskFn, null as any, "clm:users", {
            toastOnError: false,
            timeoutMs: 10000,
          }),
          safeRead<bigint>(nbtFn, 0n, "clm:nextBorrowTime", {
            toastOnError: false,
            timeoutMs: 10000,
          }),
          safeRead<any>(lateFn, null as any, "clm:previewLoanWithLate", {
            toastOnError: false,
            timeoutMs: 10000,
          }),
          safeRead<any>(premFn, null as any, "clm:premiums", {
            toastOnError: false,
            timeoutMs: 10000,
          }),
        ]);

        limit = evmLimit;
        loan = evmLoan;
        userRisk = evmUserRisk;
        nextBorrow = evmNextBorrow;
        latePreview = evmLatePreview;
        premium = evmPremium;
        limitOk = limitSt.ok;
        loanOk = loanSt.ok;
        lateOk = lateSt.ok;
        premiumOk = premSt.ok;
      }

      if (activeIdentityRef.current !== requestIdentity) return;

      // If critical reads (limit or loan) failed/timed out, preserve previous
      // state to prevent flashing "Sin límite" when user has an active loan
      if (!limitOk || !loanOk) {
        console.warn(
          "[CLM] Critical RPC read failed, preserving previous state",
          {
            limitOk,
            loanOk,
          },
        );
        return;
      }

      setLimitRaw(limit);

      const toBig = (v: any): bigint | null => {
        if (v == null) return null;
        if (typeof v === "bigint") return v;
        if (typeof v === "number") return BigInt(v);
        try {
          return BigInt(v.toString());
        } catch {
          return null;
        }
      };

      // -------- Deuda + timing --------
      let debt = 0n;
      let activeLoan = false;
      let startTs: number | null = null;
      let dueTs: number | null = null;

      let graceSec = 0;
      if (loan) {
        const rawAmount =
          (loan as any).amount_due ??
          (loan as any).amountDue ??
          (loan as any)[1];
        const rawStart = (loan as any).start ?? (loan as any)[2];
        const rawDue = (loan as any).due ?? (loan as any)[3];
        const rawFeeBps =
          (loan as any).fee_bps ?? (loan as any).feeBps ?? (loan as any)[4];
        const rawGrace =
          (loan as any).grace_period ??
          (loan as any).gracePeriod ??
          (loan as any)[5];
        const rawActive = (loan as any).active ?? (loan as any)[6];

        const amountBig = toBig(rawAmount);
        if (amountBig != null) debt = amountBig;

        const startBig = toBig(rawStart);
        const dueBig = toBig(rawDue);
        const graceBig = toBig(rawGrace);
        if (graceBig != null) graceSec = Number(graceBig);

        activeLoan = Boolean(rawActive);

        const feeBpsNum =
          rawFeeBps != null ? Number(rawFeeBps.toString()) : null;
        setLoanFeeBps(activeLoan && feeBpsNum != null ? feeBpsNum : null);

        if (
          activeLoan &&
          startBig != null &&
          dueBig != null &&
          dueBig > startBig
        ) {
          startTs = Number(startBig);
          dueTs = Number(dueBig);
        }
      }

      // -------- Late fees --------
      // Spec 031 — derive `accruing` from MONOTONIC chain inputs only:
      //   activeLoan AND premium.lateRatePerSecWad > 0 AND nowTs > lateStart
      //
      // Previous logic compared `previewLoanWithLate.amountDueWithLate >
      // loan.amountDue`, but that delta hits 0 the moment `accrueLate`
      // fires (storage catches up to preview), then drifts > 0 again.
      // Since spec 031's autoRefresh fires `accrueLate` every 60s, the
      // user saw the "Crédito vencido" badge + "Includes mora" warning
      // blink in/out on a 60s cadence. The new check is a pure boolean
      // derived from rate/grace state, so no flicker.
      //
      // We still upgrade `debt` to the live preview value when it
      // exceeds storage — this keeps the home card showing the
      // chain-truth amount (storage can lag preview between accrueLate
      // calls).
      let accruing = false;
      if (activeLoan && lateOk && latePreview != null) {
        const rawLate =
          (latePreview as any).amountDueWithLate ?? (latePreview as any)[1];
        const lateBig = toBig(rawLate);
        if (lateBig != null && lateBig > debt) {
          debt = lateBig;
        }
      }
      if (activeLoan && !premiumOk) {
        // Preserve previous late-fee badge state on transient read failure.
      } else if (activeLoan && premium != null && dueTs != null) {
        const rawLateRate =
          (premium as any).late_rate_per_sec_wad ??
          (premium as any).lateRatePerSecWad ??
          (premium as any)[1];
        const lateRateBig = toBig(rawLateRate);
        const lateStart = dueTs + graceSec;
        const nowSec = Math.floor(Date.now() / 1000);
        if (lateRateBig != null && lateRateBig > 0n && nowSec > lateStart) {
          accruing = true;
        }
        setIsAccruingLateFees(accruing);
      } else {
        setIsAccruingLateFees(false);
      }

      setBorrowedRaw(debt);

      // Spec 031 — truncate (don't round up) so the home card displays
      // the floor of the real debt. Otherwise 24.8765708 → "24.88" on
      // home but "24.8765708" on pay screen, which looks inconsistent
      // and overstates what the contract will actually pull.
      const borrowedPretty = formatUSDCAmount2dpTruncated(debt);

      // Spec 028 — apply HWM to the display-only limit. The slider /
      // useBorrow validation continues to read `limitRaw` (raw on-chain)
      // so there's no risk of letting the user submit a borrow above the
      // contract's actual limit.
      const opt = useCreditStore.getState();
      // TTL guard — useCreditStore handles this on its own writes, but
      // we also clear here so the display falls back if expired.
      if (opt.optimisticUntil != null && Date.now() > opt.optimisticUntil) {
        opt.clearOptimistic();
      }
      const optLimitRaw = useCreditStore.getState().optimisticLimitRaw;
      const effectiveLimit =
        optLimitRaw != null && limit < optLimitRaw ? optLimitRaw : limit;
      const limitPretty = formatUSDCAmount2dp(effectiveLimit);

      setBorrowedDisplay(borrowedPretty);
      setLimitDisplay(`${borrowedPretty}/${limitPretty} USDC`);

      // -------- Score --------
      if (userRisk) {
        let s: number | null = null;

        if (typeof (userRisk as any).score === "number") {
          s = (userRisk as any).score;
        } else if (
          Array.isArray(userRisk) ||
          typeof (userRisk as any)[0] !== "undefined"
        ) {
          const candidate = Number((userRisk as any)[0]);
          if (Number.isFinite(candidate)) s = candidate;
        }

        if (s !== null) {
          setScoreRaw(s);
          // Spec 028 — HWM: the optimistic floor is preserved if on-chain
          // is still behind. Once on-chain catches up, the store auto-clears
          // the floor and reverts to normal poll behavior.
          setCreditScoreRawHwm(s);

          // Display string also uses the HWM-effective score.
          const effectiveScoreForDisplay =
            opt.optimisticScoreRaw != null && s < opt.optimisticScoreRaw
              ? opt.optimisticScoreRaw
              : s;
          const sStr = withThousands(String(effectiveScoreForDisplay));
          const display = `${sStr}/${MAX_SCORE}`;

          setScoreDisplay(display);
          setCreditScoreDisplay(display);
        } else {
          setScoreRaw(null);
          setCreditScoreRaw(null);
          setScoreDisplay(`—/${MAX_SCORE}`);
          setCreditScoreDisplay(null);
        }
      } else {
        setScoreRaw(null);
        setCreditScoreRaw(null);
        setScoreDisplay(`—/${MAX_SCORE}`);
        setCreditScoreDisplay(null);
      }

      // -------- Timing del préstamo --------
      if (activeLoan && startTs != null && dueTs != null) {
        const nowSec = Math.floor(Date.now() / 1000);

        const totalSec = Math.max(dueTs - startTs, 0);
        const elapsedSec = Math.max(nowSec - startTs, 0);
        const remainingSec = dueTs - nowSec;

        const totalDays = totalSec / 86_400;
        const remainingDays = remainingSec / 86_400;

        const progressRaw = totalSec > 0 ? (elapsedSec / totalSec) * 100 : 0;
        const progress = Math.max(0, Math.min(100, progressRaw));

        setHasActiveLoan(true);
        setLoanStart(new Date(startTs * 1000));
        setLoanDue(new Date(dueTs * 1000));
        setTermDaysTotal(totalDays);
        setDaysRemaining(remainingDays);
        setTermProgressPct(progress);
      } else {
        setHasActiveLoan(false);
        setLoanStart(null);
        setLoanDue(null);
        setTermDaysTotal(null);
        setDaysRemaining(null);
        setTermProgressPct(null);
      }

      // -------- Cooldown --------
      setNextBorrowTimeRaw(nextBorrow);

      const nbtNum = Number(nextBorrow ?? 0n);
      if (nbtNum > 0) {
        const nowSec = Math.floor(Date.now() / 1000);
        if (nowSec < nbtNum) {
          const diff = nbtNum - nowSec;
          setCooldownActive(true);
          setCooldownSecondsLeft(diff);
          setCooldownUntil(new Date(nbtNum * 1000));
        } else {
          setCooldownActive(false);
          setCooldownSecondsLeft(null);
          setCooldownUntil(null);
        }
      } else {
        setCooldownActive(false);
        setCooldownSecondsLeft(null);
        setCooldownUntil(null);
      }
    } catch (e: unknown) {
      if (activeIdentityRef.current !== requestIdentity) return;
      console.warn("[CLM] read error:", e);
      setError(
        (e as any)?.message ?? t("hooks.useCreditLine.errors.readFailed"),
      );
      // Don't resetState() — preserve previous values to avoid flashing wrong UI
    } finally {
      if (activeIdentityRef.current === requestIdentity) {
        setLoading(false);
      }
    }
  }, [
    creditLineIdentity,
    clm,
    mode,
    userAddress,
    resetState,
    setCreditScoreDisplay,
    setCreditScoreRaw,
    setCreditScoreRawHwm,
    t,
  ]);

  // Single consolidated effect: read on mount/dep change + poll when visible
  React.useEffect(() => {
    if (!isVisible) return;

    void read();

    if (!pollMs || pollMs <= 0) return;

    const id = setInterval(() => {
      void read();
    }, pollMs);

    return () => clearInterval(id);
  }, [pollMs, read, isVisible]);

  return {
    clmAddress: CLM_ADDRESS ?? null,
    scoreRaw,
    scoreDisplay,
    limitRaw,
    borrowedRaw,
    borrowedDisplay,
    limitDisplay,
    hasActiveLoan,
    loanStart,
    loanDue,
    daysRemaining,
    termDaysTotal,
    termProgressPct,
    nextBorrowTimeRaw,
    cooldownActive,
    cooldownSecondsLeft,
    cooldownUntil,
    isAccruingLateFees,
    loanFeeBps,
    loading,
    error,
    refresh: read,
  };
}
