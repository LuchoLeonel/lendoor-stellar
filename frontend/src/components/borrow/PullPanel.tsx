// src/components/borrow/PullPanel.tsx
"use client";

import * as React from "react";
import { Loader2, ArrowLeft, CheckCircle2, Info } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  usePullPanel,
  formatAmountHuman,
  PullPanelProps,
} from "@/hooks/borrow/backend/usePullPanel";
import { Slider } from "@/components/ui/slider";
import { useCreditStore } from "@/stores/creditStore";
import { useTranslation } from "@/i18n/useTranslation";
import { ConfirmationDialog } from "@/components/common/ConfirmationDialog";
import { TransactionProgress, TxState } from "@/components/common/TransactionProgress";

export function PullPanel(props: PullPanelProps) {
  const {
    isVerified,
    isLemon,
    cta,
    isDisabled,
    verifyError,
    isBorrowing,
    hasAvailable: _hasAvailable,
    availableAmountToShow,
    termOpen,
    handleDialogOpenChange,
    handleSubmit,
    confirmTermAndBorrow,
    loanTerms,
    selectedTermIndex,
    setSelectedTermIndex,
    baseAmountToShow,
    verifyingLemon,
    loadingTerms,
    requestedAmountHuman,
    maxBorrowUnits,
    requestedUnits,
    setRequestedUnits,
    authLoading,
  } = usePullPanel(props);
  const scoreDisplay = useCreditStore((s) => s.creditScoreDisplay);
  const { t } = useTranslation();

  const [txState, setTxState] = React.useState<TxState>('idle');
  const [txError, setTxError] = React.useState<string | undefined>(undefined);
  const prevBorrowing = React.useRef(false);

  // Resolve pending txState when the hook finishes borrowing.
  // confirmTermAndBorrow() swallows errors internally, so we watch
  // isBorrowing going false + verifyError to distinguish success vs failure.
  React.useEffect(() => {
    const wasBorrowing = prevBorrowing.current;
    prevBorrowing.current = isBorrowing;

    if (wasBorrowing && !isBorrowing && txState === 'pending') {
      if (verifyError) {
        setTxState('failed');
        setTxError(verifyError);
      } else {
        setTxState('confirmed');
      }
    }
  }, [isBorrowing, verifyError, txState]);

  const canBorrow = maxBorrowUnits > 0;

  const handleSliderChange = (value: number[]) => {
    const v = value?.[0] ?? 1;
    setRequestedUnits(v);
  };

  const amountForDialog = baseAmountToShow || requestedAmountHuman;

  // 👉 usamos termOpen como "estoy en pantalla de plazos?"
  const atTermScreen = termOpen;

  // Congelamos las tasas mientras se está procesando el préstamo
  const [displayLoanTerms, setDisplayLoanTerms] =
    React.useState<typeof loanTerms>(loanTerms);

  // Confirmation dialog state
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const handleConfirmBorrow = () => {
    setConfirmOpen(false);
    setTxState('pending');
    setTxError(undefined);
    // confirmTermAndBorrow swallows its own errors; resolution is tracked
    // via the isBorrowing useEffect above.
    void confirmTermAndBorrow();
  };

  const selectedTerm = displayLoanTerms?.[selectedTermIndex] ?? null;

  const borrowConfirmDetails = React.useMemo(() => {
    const details = [
      {
        label: t("common.confirmDialog.borrow.labelAmount"),
        value: `${amountForDialog} USDC`,
      },
    ];
    if (selectedTerm) {
      details.push({
        label: t("common.confirmDialog.borrow.labelTenor"),
        value: t("common.confirmDialog.borrow.labelDays", {
          days: selectedTerm.days,
        }),
      });
      details.push({
        label: t("common.confirmDialog.borrow.labelRate"),
        value: `${selectedTerm.periodRatePercent.toFixed(2)}%`,
      });
      details.push({
        label: t("common.confirmDialog.borrow.labelTotalRepay"),
        value: `${formatAmountHuman(selectedTerm.finalAmount)} USDC`,
      });
    }
    return details;
  }, [amountForDialog, selectedTerm, t]);

  React.useEffect(() => {
    // Si estamos en modo "borrow en curso", no borramos visualmente las tasas
    if (isBorrowing) {
      // Si llegan tasas nuevas mientras tanto, sí las actualizamos
      if (loanTerms && loanTerms.length) {
        setDisplayLoanTerms(loanTerms);
      }
      return;
    }

    // Cuando no estamos pidiendo el préstamo, sincronizamos 1:1 con el hook
    setDisplayLoanTerms(loanTerms);
  }, [loanTerms, isBorrowing]);

  return (
    <div className="mt-4 w-full max-w-md overflow-x-hidden rounded-2xl border-2 border-primary/30 bg-card p-0 shadow-sm">
      <div className="relative overflow-x-hidden">
        <div
          className={`flex w-[200%] transform-gpu transition-transform duration-500 ease-in-out ${
            atTermScreen ? "-translate-x-1/2" : "translate-x-0"
          }`}
        >
          {/* ====================== PANTALLA 1: MONTO ====================== */}
          <div className="w-1/2 shrink-0 p-5 sm:p-6">
            {/* Fila superior: score */}
            <div className="mb-3 flex items-center justify-between">
              <span className="mono-text text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                {t("borrow.pull.scoreLabel", { score: scoreDisplay })}
              </span>
            </div>

            {/* Título gamificado */}
            <div className="mb-3">
              <h2 className="text-[1.4rem] font-semibold leading-tight">
                {t("borrow.pull.title")}
              </h2>
              <p className="mt-1 text-[13px] leading-snug text-muted-foreground">
                {t("borrow.pull.subtitle")}
              </p>
            </div>

            {/* Card del monto */}
            <div className="rounded-2xl border border-border/50 bg-muted/20 px-5 py-5">
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="mono-text text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  {t("borrow.pull.amountHeader")}
                </div>

                <div className="flex items-baseline justify-center gap-1">
                  <span className="text-4xl font-bold leading-none tabular-nums text-foreground">
                    {canBorrow ? requestedUnits : 0}
                  </span>
                  <span className="text-sm text-muted-foreground">USDC</span>
                </div>

                <p className="max-w-[240px] text-[12px] leading-snug text-muted-foreground">
                  {t("borrow.pull.amountHelper")}
                </p>
              </div>
            </div>

            {/* Slider */}
            <div className="mt-4">
              {canBorrow ? (
                <>
                  <Slider
                    min={1}
                    max={maxBorrowUnits}
                    step={1}
                    value={[requestedUnits]}
                    onValueChange={handleSliderChange}
                    className="w-full py-2"
                  />

                  <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>{t("borrow.pull.sliderMinLabel")}</span>
                    <span>
                      {t("borrow.pull.sliderMaxLabel", {
                        max: maxBorrowUnits,
                      })}
                    </span>
                  </div>

                  <p className="mt-2 text-center text-[12px] leading-snug text-muted-foreground">
                    {t("borrow.pull.selectedAmount", {
                      amount: requestedUnits,
                    })}
                    <br />
                    <span className="text-[11px] text-muted-foreground">
                      {t("borrow.pull.limitLabel", {
                        amount: availableAmountToShow,
                      })}
                    </span>
                  </p>
                </>
              ) : (
                <p className="text-center text-[13px] leading-snug text-muted-foreground">
                  {t("borrow.pull.noCredit")}
                </p>
              )}
            </div>

            {verifyError && isLemon && !isVerified && (
              <div className="mt-3 text-center text-[12px] leading-snug text-red-600">
                {verifyError}
              </div>
            )}

            {/* CTA → abre pantalla de plazos (antes: Dialog) */}
            <form onSubmit={handleSubmit} className="mt-4 w-full">
              <Button
                type="submit"
                size="xl"
                disabled={isDisabled || !canBorrow}
                className="w-full cursor-pointer text-base font-semibold disabled:opacity-60"
              >
                {(authLoading ||
                  verifyingLemon ||
                  isBorrowing ||
                  loadingTerms) && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {cta}
              </Button>
            </form>
          </div>

          {/* ====================== PANTALLA 2: PLAZOS ====================== */}
          <div className="relative w-1/2 shrink-0 border-l border-border/40 bg-card p-5 sm:p-6">
            {/* título centrado */}
            <div className="mb-3 text-center">
              <h2 className="text-[1.25rem] font-semibold leading-tight">
                {t("borrow.pull.termsTitle")}
              </h2>
            </div>

            {/* Amount display — prominent, orange */}
            <div className="mb-4 mt-1 text-center">
              <div className="text-3xl font-bold text-primary tabular-nums leading-none">
                {amountForDialog}{" "}
                <span className="text-lg font-semibold text-primary/70">USDC</span>
              </div>
              <div className="mt-1 mono-text text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                {t("borrow.pull.amountHeader")}
              </div>
            </div>

            {/* Term cards */}
            <div className="space-y-2.5">
              {displayLoanTerms?.map((term, idx) => {
                const active = idx === selectedTermIndex;
                return (
                  <button
                    key={`${term.days}-${idx}`}
                    type="button"
                    onClick={() => setSelectedTermIndex(idx)}
                    className={[
                      "w-full rounded-xl border px-3.5 py-3 text-left transition-colors",
                      active
                        ? "border-primary bg-primary/5"
                        : "border-border/40 hover:border-primary/20 hover:bg-primary/5",
                    ].join(" ")}
                  >
                    <div className="flex items-center justify-between gap-3">
                      {/* Left: days + rate */}
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-lg font-bold leading-tight">
                            {t("borrow.pull.termDays", { days: term.days })}
                          </span>
                          {idx === 0 && (
                            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                              {t("borrow.pull.termPopular")}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-sm text-muted-foreground">
                          {t("borrow.pull.termInterest", {
                            rate: term.periodRatePercent.toFixed(2),
                            amount: formatAmountHuman(term.interestAmount),
                          })}
                        </div>
                      </div>

                      {/* Right: repay amount + checkmark */}
                      <div className="flex items-center gap-2">
                        <div className="text-right">
                          <div className="text-sm font-semibold">
                            {t("borrow.pull.termRepayLabel")}{" "}
                            {formatAmountHuman(term.finalAmount)} USDC
                          </div>
                        </div>
                        {active && (
                          <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Info note card */}
            <div className="mt-4 rounded-xl bg-muted/60 px-4 py-3 flex items-start gap-2.5">
              <Info className="h-4 w-4 text-primary/60 mt-0.5 shrink-0" />
              <p className="text-[12px] text-muted-foreground leading-relaxed">
                {t("borrow.pull.termsExplanation")}
              </p>
            </div>

            {/* Botones apilados: Confirmar arriba, Atrás abajo */}
            <div className="mt-4 space-y-2">
              <Button
                size="xl"
                onClick={() => setConfirmOpen(true)}
                disabled={isBorrowing || !displayLoanTerms?.length}
                className="w-full text-base font-semibold disabled:opacity-60"
              >
                {isBorrowing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t("borrow.pull.confirmProcessing")}
                  </>
                ) : (
                  <>{t("borrow.pull.confirmAndContinue")}</>
                )}
              </Button>

              <Button
                type="button"
                variant="ghost"
                onClick={() => handleDialogOpenChange(false)}
                disabled={isBorrowing}
                className="w-full flex items-center justify-center gap-1 text-sm text-muted-foreground"
              >
                <ArrowLeft className="h-4 w-4" />
                {t("borrow.pull.back")}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <ConfirmationDialog
        open={confirmOpen}
        onConfirm={handleConfirmBorrow}
        onCancel={() => setConfirmOpen(false)}
        title={t("common.confirmDialog.borrow.title")}
        description={t("common.confirmDialog.borrow.description")}
        details={borrowConfirmDetails}
        confirmLabel={t("common.confirmDialog.borrow.confirm")}
        cancelLabel={t("common.confirmDialog.cancel")}
        confirming={isBorrowing}
      />

      <TransactionProgress
        state={txState}
        errorMessage={txError}
        onDismiss={() => setTxState('idle')}
      />
    </div>
  );
}
