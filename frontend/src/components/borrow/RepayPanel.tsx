// src/components/borrow/RepayPanel.tsx
"use client";

import * as React from "react";
import { Loader2, Calendar, Clock } from "lucide-react";
import { useRepay } from "@/hooks/borrow/blockchain/useRepay";
import { useRepayPreflight } from "@/hooks/borrow/blockchain/useRepayPreflight";
import { useWallet } from "@/providers/WalletProvider";
import { useContracts } from "@/providers/ContractsProvider";
import { useUsdcBalance } from "@/hooks/useUsdcBalance";
import { LemonFundsDialogs } from "@/components/common/LemonFundsDialogs";
import { TxState } from "@/components/common/TransactionProgress";
import { normalizeWalletAddress } from "@/lib/wallet-address";
import { useTranslation } from "@/i18n/useTranslation";
import { ConfirmationDialog } from "@/components/common/ConfirmationDialog";

type RepayPanelProps = {
  isLoggedIn: boolean;
  loadingNetwork: boolean;
  onConnect: () => void;
  onRepay?: (amount: string) => void;
  outstandingLabel?: string;
  outstandingAmount: string;
  outstandingRaw?: bigint | null;
  isAccruingLateFees?: boolean;
  /** Days remaining on the loan term (may be fractional or negative if overdue) */
  daysRemaining?: number | null;
  /** Progress through the loan term 0–100 */
  termProgressPct?: number | null;
  /** Loan fee in basis points (e.g. 429 = 4.29%) */
  loanFeeBps?: number | null;
  /**
   * Spec 034 — lift txState to parent so the success celebration
   * overlay survives RepayPanel's unmount (which fires the moment
   * `outstandingRaw` hits 0 right after a successful repay).
   */
  onTxStateChange?: (state: TxState, error?: string) => void;
};

// 👉 helper para “redondear hacia arriba” al próximo centavo (2 decimales)
function ceilToTwoDecimals(diff: bigint, decimals: number): string {
  if (decimals <= 0) {
    return diff.toString();
  }

  if (decimals <= 2) {
    const factor = 10n ** BigInt(decimals);
    const intPart = diff / factor;
    const fracUnits = diff % factor;

    if (decimals === 1) {
      return `${intPart.toString()}.${fracUnits.toString().padStart(1, "0")}`;
    }

    return `${intPart.toString()}.${fracUnits.toString().padStart(2, "0")}`;
  }

  const centUnit = 10n ** BigInt(decimals - 2);
  const cents = (diff + centUnit - 1n) / centUnit;

  const intPart = cents / 100n;
  const frac = cents % 100n;

  return `${intPart.toString()}.${frac.toString().padStart(2, "0")}`;
}

export function RepayPanel({
  isLoggedIn: isLoggedInProp,
  loadingNetwork,
  onConnect,
  onRepay,
  outstandingLabel: _outstandingLabel = "SALDO PENDIENTE:",
  outstandingAmount,
  outstandingRaw,
  isAccruingLateFees = false,
  daysRemaining,
  termProgressPct,
  loanFeeBps,
  onTxStateChange,
}: RepayPanelProps) {
  const { submit, submitting } = useRepay();
  const { isMiniApp, mode, primaryWallet } = useWallet();
  const { connectedAddress } = useContracts();
  const { t } = useTranslation();

  // Spec 024 B.3 — wallet for preflight live ticker.
  const walletForPreflight =
    normalizeWalletAddress(connectedAddress ?? primaryWallet?.address, mode);

  // Spec 034 — internal txState still drives this component's local
  // UI (e.g. paymentInFlight). Mirror state changes up to the parent
  // via `onTxStateChange` so the celebration overlay survives this
  // component's unmount post-repay.
  const [txState, setTxStateInternal] = React.useState<TxState>('idle');
  const [txError, setTxErrorInternal] = React.useState<string | undefined>(undefined);
  const setTxState = React.useCallback(
    (s: TxState) => {
      setTxStateInternal(s);
      onTxStateChange?.(s, undefined);
    },
    [onTxStateChange],
  );
  const setTxError = React.useCallback(
    (e?: string) => {
      setTxErrorInternal(e);
      // Forward the error alongside the most-recent state.
      onTxStateChange?.('failed', e);
    },
    [onTxStateChange],
  );
  // Reference txError so eslint stays quiet — it was used by the
  // old TransactionProgress mount; now consumed by the parent.
  void txError;

  const isLemonMode = mode === "lemon";

  const { raw: usdcRaw, decimals: usdcDecimals, display: usdcDisplay, loading: usdcLoading } = useUsdcBalance(
    isLemonMode ? 10_000 : 0,
  );

  const [openDeposit, setOpenDeposit] = React.useState(false);
  // confirmOpen state removed — Lemon SDK handles its own confirmation

  // ✅ anti-flicker: mientras se confirma / indexa / refresca, no mostrar CTA de depositar
  const [repayInFlight, setRepayInFlight] = React.useState(false);
  const inFlightTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const startInFlightWindow = React.useCallback(() => {
    setRepayInFlight(true);

    if (inFlightTimeoutRef.current) clearTimeout(inFlightTimeoutRef.current);

    // ventana de gracia para evitar que el balance "baje" antes de que el estado se actualice
    inFlightTimeoutRef.current = setTimeout(() => {
      setRepayInFlight(false);
      inFlightTimeoutRef.current = null;
    }, 45_000);
  }, []);

  React.useEffect(() => {
    // Si ya no hay deuda, apagamos el in-flight inmediatamente
    const numericDebt =
      outstandingAmount && outstandingAmount !== "—"
        ? Number(outstandingAmount.replace(/,/g, ""))
        : 0;

    const hasDebtNow =
      typeof outstandingRaw === "bigint"
        ? outstandingRaw > 0n
        : numericDebt > 0;

    if (!hasDebtNow) {
      setRepayInFlight(false);
      if (inFlightTimeoutRef.current) {
        clearTimeout(inFlightTimeoutRef.current);
        inFlightTimeoutRef.current = null;
      }
    }
  }, [outstandingAmount, outstandingRaw]);

  React.useEffect(() => {
    return () => {
      if (inFlightTimeoutRef.current) clearTimeout(inFlightTimeoutRef.current);
    };
  }, []);

  const isLoggedInResolved = isMiniApp ? true : !!isLoggedInProp;

  const numericDebt =
    outstandingAmount && outstandingAmount !== "—"
      ? Number(outstandingAmount.replace(/,/g, ""))
      : 0;

  const hasDebt =
    typeof outstandingRaw === "bigint" ? outstandingRaw > 0n : numericDebt > 0;

  // Spec 024 B.3 — preflight + live ticker.
  //
  // Only fetches when (a) the user has a wallet connected and (b) there's
  // active debt to preflight. The hook is safe-by-default for users
  // without mora active: when premiums.lateRatePerSecWad=0 on chain, the
  // payload comes back with rate=0 and the ticker doesn't move, so we
  // fall back to the static outstandingAmount (existing behavior, no
  // visible UI change for those users).
  //
  // For users WITH mora active (post-spec-025 backfill), the payload's
  // ratePerSecWad > 0 and we render the 5-decimal live ticker per
  // spec 024 §4.4. The displayed value matches what the contract will
  // pull at click time within sub-cent drift.
  const preflight = useRepayPreflight({
    walletAddress: walletForPreflight,
    enabled: hasDebt && !!walletForPreflight,
    // Spec 031 §2.1 — refresh the payload every 60s while the panel is
    // open. The backend endpoint is throttled at 6/min/wallet so this
    // is well within budget, and it bounds the staleness of the
    // displayed `accruedAmountDue` to one minute.
    autoRefreshMs: 60_000,
  });

  // Show live ticker only when mora is actually accruing right now —
  // i.e. NOW >= lateStart AND ratePerSecWad > 0. Pre-grace, the contract
  // returns the static amountDue and the ticker would lie to the user.
  //
  // Spec 040 — gate on `isMoraAccruing` (computed in the hook from
  // payload.lateStart vs chain time) instead of just `ratePerSecWad > 0`,
  // because spec 024 sets the per-wallet rate at borrow time, so the
  // rate is non-zero from t=0 of every loan even though no mora is
  // accruing yet.
  //
  // Spec 031 lesson: an aggressive "stale payload" fallback that swaps
  // back to a 2dp display caused visible bouncing every ~15s; that has
  // been removed. The hook itself now formats with 2 decimals pre-grace
  // and 7 decimals post-grace, so the static value reads like a normal
  // USDC balance until the late period actually starts.
  const showLiveTicker =
    !!preflight.payload &&
    preflight.isMoraAccruing &&
    preflight.displayHuman != null;

  // ✅ anti-flicker: stable insufficient-balance flag and missing amount.
  // We use useState so that during a polling refetch (usdcLoading=true) or
  // a transient RPC error (raw becomes null briefly), the previous confirmed
  // value is kept and the CTA does not flicker to a different state.
  const [stableInsufficient, setStableInsufficient] = React.useState(false);
  const [stableMissingAmount, setStableMissingAmount] = React.useState<string | null>(null);

  React.useEffect(() => {
    // Only update stable state when the balance is definitively loaded (not in
    // mid-poll and not errored out to null without a real balance confirmation).
    if (usdcLoading) return;
    if (!isLemonMode) {
      setStableInsufficient(false);
      setStableMissingAmount(null);
      return;
    }
    if (usdcRaw == null || usdcDecimals == null) {
      // Balance data not yet available — keep current stable state.
      return;
    }
    // Spec 031 follow-up: don't react to transient `outstandingRaw == null`
    // during useCreditLine refetches — that was making the cartelito blink
    // every ~15s. Only react when we have a confirmed bigint value.
    if (typeof outstandingRaw !== "bigint") return;
    // Confirmed no-debt → safe to clear.
    if (outstandingRaw === 0n) {
      setStableInsufficient(false);
      setStableMissingAmount(null);
      return;
    }
    const insufficient = usdcRaw < outstandingRaw;
    setStableInsufficient(insufficient);
    if (insufficient) {
      const diff = outstandingRaw - usdcRaw;
      setStableMissingAmount(diff > 0n ? ceilToTwoDecimals(diff, usdcDecimals) : null);
    } else {
      setStableMissingAmount(null);
    }
  }, [usdcLoading, isLemonMode, usdcRaw, outstandingRaw, usdcDecimals]);

  const wantsConnectCta = !isLoggedInResolved && !loadingNetwork;

  const paymentInFlight = submitting || repayInFlight;

  // ✅ no mostramos deposit CTA mientras el repay está en vuelo
  const showDepositCta =
    isLemonMode &&
    hasDebt &&
    !wantsConnectCta &&
    stableInsufficient &&
    !paymentInFlight;

  // Keep missingAmount stable during polls (use stableMissingAmount)
  const missingAmount = showDepositCta ? stableMissingAmount : null;

  const repayCta = wantsConnectCta
    ? t("borrow.repay.ctaConnect")
    : paymentInFlight
    ? t("borrow.repay.ctaPaying")
    : t("borrow.repay.ctaPay");

  const repayDisabled = paymentInFlight || (!hasDebt && !wantsConnectCta);

  const executeRepay = async () => {
    if (!isLoggedInResolved) {
      return onConnect?.();
    }

    if (!hasDebt) return;

    if (showDepositCta) return;

    try {
      // ✅ abrimos ventana anti-flicker apenas disparamos el repay
      startInFlightWindow();

      setTxState('pending');
      setTxError(undefined);

      // Spec 028: tell useRepay whether this is an on-time repay so it can
      // apply optimistic ladder/score/repGain updates immediately.
      const wasOnTime = !isOverdue;
      const ok = await submit(outstandingAmount, outstandingRaw ?? null, {
        wasOnTime,
      });
      if (!ok) {
        setTxState('failed');
        setRepayInFlight(false);
        return;
      }

      setTxState('confirmed');
      onRepay?.(outstandingAmount);
    } catch (err) {
      setTxState('failed');
      setTxError(err instanceof Error ? err.message : String(err));
      setRepayInFlight(false);
      console.error(err);
    }
  };

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();

    if (!isLoggedInResolved) {
      return onConnect?.();
    }

    if (!hasDebt) return;

    if (showDepositCta) return;

    // Execute repay directly — Lemon SDK shows its own confirmation modal
    void executeRepay();
  };

  // ✅ ocultamos el warning mientras el repay está en vuelo
  const insufficientText =
    hasDebt &&
    !wantsConnectCta &&
    stableInsufficient &&
    isLemonMode &&
    !paymentInFlight
      ? missingAmount
        ? t("borrow.repay.insufficientBalanceWithAmount", {
            amount: missingAmount,
          })
        : t("borrow.repay.insufficientBalance")
      : null;

  // ---- Derived timing display ----
  const hasTiming =
    typeof daysRemaining === "number" &&
    Number.isFinite(daysRemaining) &&
    typeof termProgressPct === "number" &&
    Number.isFinite(termProgressPct);

  const safeProgressPct = hasTiming
    ? Math.max(0, Math.min(100, termProgressPct as number))
    : 0;

  const daysLabel = hasTiming
    ? (() => {
        const d = daysRemaining as number;
        if (d > 1) return t('borrow.market.dueInDays', { days: Math.ceil(d) });
        if (d > 0) return t('borrow.market.dueInLessDay');
        if (d > -1) return t('borrow.market.dueToday');
        return t('borrow.market.overdueDays', { days: Math.abs(Math.floor(d)) });
      })()
    : null;

  const interestLabel =
    typeof loanFeeBps === "number" && loanFeeBps > 0
      ? t('borrow.market.interestLabel', { rate: (loanFeeBps / 100).toFixed(2) })
      : null;

  const isOverdue = hasTiming && (daysRemaining as number) < 0;

  const barClass = isOverdue
    ? "bg-red-500"
    : safeProgressPct >= 80
      ? "bg-orange-500"
      : safeProgressPct >= 50
        ? "bg-amber-400"
        : "bg-primary";

  return (
    <div className="relative w-full">

      {/* 1. CRÉDITO ACTIVO — status + amount (como producción) */}
      <div className="flex items-center justify-center gap-2 mb-2">
        {!isOverdue && <div className="h-2 w-2 rounded-full bg-amber-500" />}
        <span className={`text-[11px] font-semibold uppercase tracking-wider ${isOverdue ? 'text-red-600' : 'text-muted-foreground'}`}>
          {isAccruingLateFees ? t('borrow.market.creditOverdue') : t('borrow.market.creditActive')}
        </span>
      </div>
      <div className="text-center mb-3">
        <p className="text-[11px] uppercase tracking-widest font-medium text-muted-foreground/70 mb-1">
          {t('borrow.repay.totalLabel')}
        </p>
        <div className="flex items-baseline justify-center gap-2">
          <span
            className={`font-bold leading-tight tabular-nums ${
              isOverdue ? 'text-red-600' : 'text-foreground'
            } ${
              showLiveTicker ? 'text-[1.6rem]' : 'text-[2.5rem]'
            }`}
          >
            {hasDebt
              ? showLiveTicker
                ? preflight.displayHuman
                : outstandingAmount
              : '0.00'}
          </span>
          <span className="text-lg font-semibold text-muted-foreground">USDC</span>
        </div>
      </div>

      {/* Deadline pill below amount */}
      {daysLabel && (
        <div className="flex justify-center mb-5">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold ${
            isOverdue
              ? 'bg-red-100 text-red-700 border border-red-200'
              : 'bg-amber-50 text-amber-700 border border-amber-200'
          }`}>
            <Calendar className="h-3.5 w-3.5 shrink-0" />
            {daysLabel}
          </span>
        </div>
      )}

      {/* 2. ESTADO ACTUAL — card con barra de progreso */}
      {hasTiming && (
        <div className="mb-4 rounded-2xl bg-white px-4 py-4" style={{ border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
          <div className="flex items-center justify-between mb-1.5">
            <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
              <Clock className="h-3 w-3 shrink-0" />
              {t('borrow.repay.termProgressLabel')}
            </span>
            <span className="text-[11px] font-semibold text-muted-foreground">
              {Math.round(safeProgressPct)}% transcurrido
            </span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full rounded-full transition-[width] duration-500 ease-out ${barClass}`}
              style={{ width: `${safeProgressPct}%` }}
            />
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[10px] font-medium">
            <span className="text-muted-foreground">{t('borrow.repay.progressStart')}</span>
            <span className={`uppercase font-bold ${isOverdue ? 'text-red-600' : 'text-muted-foreground'}`}>
              {isOverdue ? 'Fecha límite superada' : 'Vencimiento'}
            </span>
          </div>
        </div>
      )}

      {/* Late fee warning */}
      {isAccruingLateFees && hasDebt && (
        <div className="mb-4 flex items-center gap-2 rounded-xl bg-red-50/60 px-4 py-2.5 border border-red-200/50">
          <div className="h-2 w-2 shrink-0 rounded-full bg-red-500" />
          <p className="text-[12px] font-medium leading-snug text-red-600/80">
            {t("borrow.repay.lateFeeNote")}
          </p>
        </div>
      )}

      {/* 3. DETALLE — como producción */}
      <div className="rounded-xl bg-slate-50/80 px-4 py-3 mb-4" style={{ border: '1px solid rgba(0,0,0,0.05)' }}>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          {t('borrow.repay.detailHeader')}
        </p>
        {interestLabel && (
          <div className="flex items-center justify-between py-1.5 text-[13px] border-b border-slate-100">
            <span className="text-muted-foreground">{t('borrow.repay.interestRow')}</span>
            <span className="font-medium text-foreground">{interestLabel}</span>
          </div>
        )}
        {isLemonMode && usdcDisplay != null && (
          <div className="flex items-center justify-between py-1.5 text-[13px]">
            <span className="text-muted-foreground">{t('borrow.repay.balanceRow')}</span>
            <span className="font-medium text-foreground">{usdcDisplay} USDC</span>
          </div>
        )}
      </div>

      {/* 4. AVISO — triángulo naranja (nuevo) */}
      {insufficientText && (
        <div className="mb-4 flex items-center gap-3 rounded-2xl px-4 py-3" style={{ backgroundColor: 'rgba(249,116,21,0.06)', border: '1px solid rgba(249,116,21,0.15)' }}>
          <div className="shrink-0 flex items-center justify-center" style={{ width: 28, height: 28 }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L1 21h22L12 2z" fill="#E97316" />
              <path d="M11 10h2v5h-2z" fill="white" />
              <circle cx="12" cy="17.5" r="1.2" fill="white" />
            </svg>
          </div>
          <p className="text-[13px] leading-snug text-foreground/80">
            {missingAmount
              ? `Cargá ${missingAmount} USDC en tu wallet para pagar.`
              : t("borrow.repay.insufficientBalance")}
          </p>
        </div>
      )}

      {/* 5. BOTÓN — Depositar USDC ↗ / Pagar */}
      <form onSubmit={handleSubmit} className="w-full space-y-2">
        {showDepositCta ? (
          <button
            type="button"
            className="w-full h-[52px] rounded-2xl text-[15px] font-semibold text-white flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98] transition-all"
            style={{ backgroundColor: '#F97415', boxShadow: '0 4px 16px rgba(249,116,21,0.25)' }}
            onClick={() => setOpenDeposit(true)}
          >
            Depositar USDC
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m7 17 9.2-9.2M17 17V7H7"/></svg>
          </button>
        ) : (
          <button
            type="submit"
            disabled={repayDisabled}
            className="w-full h-[52px] rounded-2xl text-[15px] font-semibold text-white flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 active:scale-[0.98] transition-all"
            style={isOverdue
              ? { backgroundColor: '#ef4444', boxShadow: '0 4px 16px rgba(239,68,68,0.25)' }
              : { backgroundColor: '#F97415', boxShadow: '0 4px 16px rgba(249,116,21,0.25)' }}
          >
            {paymentInFlight && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            {repayCta}
          </button>
        )}

        {wantsConnectCta && (
          <p className="mt-2 text-center text-[12px] leading-snug text-muted-foreground">
            {t("borrow.repay.connectHint")}
          </p>
        )}
      </form>

      {isLemonMode && (
        <LemonFundsDialogs
          openDeposit={openDeposit}
          onOpenDepositChange={setOpenDeposit}
          openWithdraw={false}
          onOpenWithdrawChange={() => {}}
          enabled={isLemonMode}
          depositDescription={t("borrow.repay.depositDescription")}
          withdrawDescription={t("borrow.repay.withdrawDescription")}
          depositPresetAmount={missingAmount}
        />
      )}

      {/* ConfirmationDialog removed — Lemon SDK shows its own confirmation */}

      {/* Spec 034 — TransactionProgress lifted to BorrowMarket parent.
          Without lifting, the celebration overlay unmounted together
          with RepayPanel the moment `outstandingRaw` hit 0 (= as soon
          as useCreditLine polled and saw the loan closed), cutting
          short the 4.2s confirmation window. */}
    </div>
  );
}
