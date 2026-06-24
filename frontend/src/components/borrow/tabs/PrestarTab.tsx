// src/components/borrow/tabs/PrestarTab.tsx
'use client';

import * as React from 'react';
import { ArrowRight, Loader2, ArrowLeft } from 'lucide-react';

import { useCreditLine } from '@/hooks/borrow/blockchain/useCreditLine';
import { usePullPanel, formatAmountHuman } from '@/hooks/borrow/backend/usePullPanel';
import type { LoanTermOption } from '@/hooks/borrow/backend/usePullPanel';
import { RepayPanel } from '@/components/borrow/RepayPanel';
import { CooldownPanel } from '@/components/borrow/CoolDownPanel';
import { NumericKeypad } from '@/components/common/NumericKeypad';
import { useWallet } from '@/providers/WalletProvider';
import { useTranslation } from '@/i18n/useTranslation';
import { GridBackground } from '@/components/common/GridBackground';

// ---------------------------------------------------------------------------
// Terms screen — rendered once "Continuar" is tapped
// ---------------------------------------------------------------------------

interface TermsScreenProps {
  amount: number;
  onBack: () => void;
  loanTerms: LoanTermOption[] | null;
  selectedTermIndex: number;
  setSelectedTermIndex: (i: number) => void;
  confirmTermAndBorrow: () => void;
  isBorrowing: boolean;
  loadingTerms: boolean;
  baseAmountToShow: string | null;
  handleDialogOpenChange: (open: boolean) => void;
  isPreferentialRate: boolean;
}

function TermsScreen({
  amount,
  onBack,
  loanTerms,
  selectedTermIndex,
  setSelectedTermIndex,
  confirmTermAndBorrow,
  isBorrowing,
  loadingTerms,
  baseAmountToShow,
  handleDialogOpenChange,
  isPreferentialRate,
}: TermsScreenProps) {
  const { t } = useTranslation();
  const [_pulseKey, setPulseKey] = React.useState(0);

  const displayLoanTerms = loanTerms;
  const amountLabel = baseAmountToShow || amount.toFixed(2);

  return (
    <div
      className="mx-auto flex w-full max-w-md flex-col px-5"
      style={{ minHeight: '74dvh', paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}
    >
      {/* Volver al monto — flecha inline (la cortina mantiene su X). */}
      <button
        type="button"
        onClick={() => { handleDialogOpenChange(false); onBack(); }}
        disabled={isBorrowing}
        className="-ml-1 mb-1 flex h-9 w-9 items-center justify-center rounded-full transition-transform active:scale-95 disabled:opacity-50"
        style={{ background: 'rgba(0,0,0,0.04)' }}
        aria-label="Cambiar monto"
      >
        <ArrowLeft className="h-5 w-5" style={{ color: '#1a1a1a' }} />
      </button>

      {/* Monto a solicitar — hero */}
      <div className="text-center">
        <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">
          Monto a solicitar
        </p>
        <div className="font-bold leading-none tracking-tight tabular-nums" style={{ fontSize: '2.25rem', color: '#15233b' }}>
          ${amountLabel}
        </div>
      </div>

      {/* Loading */}
      {loadingTerms && (
        <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">{t('borrow.pull.termsTitle')}…</span>
        </div>
      )}

      {/* Plazos */}
      {!loadingTerms && displayLoanTerms && (
        <div className="mt-6 space-y-3">
          {displayLoanTerms.map((term, idx) => {
            const active = idx === selectedTermIndex;
            return (
              <button
                key={idx}
                type="button"
                onClick={(e) => {
                  setSelectedTermIndex(idx);
                  setPulseKey((k) => k + 1);
                  const btn = e.currentTarget;
                  btn.style.animation = 'none';
                  void btn.offsetHeight;
                  btn.style.animation = 'termPulse 320ms cubic-bezier(0.36,0.07,0.19,0.97)';
                }}
                className="w-full text-left rounded-2xl px-5 py-[18px] transition-all active:scale-[0.99]"
                style={{
                  background: active ? 'rgba(249,116,21,0.06)' : 'rgba(0,0,0,0.025)',
                  border: active ? '1.5px solid rgba(249,116,21,0.4)' : '1px solid rgba(0,0,0,0.06)',
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[18px] font-bold leading-tight whitespace-nowrap" style={{ color: '#15233b' }}>
                      {t('borrow.pull.termDays', { days: term.days })}
                    </span>
                    {idx === 0 && (
                      <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-px text-[8px] font-bold uppercase text-primary">
                        {t('borrow.pull.termPopular')}
                      </span>
                    )}
                  </div>
                  <span className="shrink-0 text-[14px] font-semibold whitespace-nowrap" style={{ color: '#15233b' }}>
                    {t('borrow.pull.termRepayPrefix')}{' '}${formatAmountHuman(term.finalAmount)}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="text-[13px] text-muted-foreground">
                    {isPreferentialRate ? t('borrow.pull.ratePreferential') : t('borrow.pull.rateBase')}
                    {': '}{term.periodRatePercent.toFixed(2)}%
                  </span>
                  {isPreferentialRate && (
                    <span className="inline-flex items-center rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-medium text-green-600">
                      {t('borrow.pull.ratePreferentialBadge')}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Nota */}
      {!loadingTerms && displayLoanTerms && (
        <p className="mt-3 px-1 text-[11px] leading-snug text-muted-foreground">
          {t('borrow.pull.termsInfoNote')}
        </p>
      )}

      {/* CTA — anclado al fondo de la cortina */}
      <button
        type="button"
        onClick={confirmTermAndBorrow}
        disabled={isBorrowing || !displayLoanTerms?.length}
        className="mt-auto flex h-[54px] w-full items-center justify-center gap-2 rounded-full text-[16px] font-semibold text-white transition-all active:scale-[0.98] disabled:opacity-50"
        style={{ backgroundColor: '#F97415', boxShadow: '0 6px 20px rgba(249,116,21,0.30)' }}
      >
        {isBorrowing ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" />
            {t('borrow.pull.confirmProcessing')}
          </>
        ) : (
          t('borrow.pull.confirmAndContinue')
        )}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Amount selection screen — the hero "¿Cuánto dinero necesitás?"
// ---------------------------------------------------------------------------

interface AmountScreenProps {
  amountStr: string;
  setAmountStr: (s: string) => void;
  amountNum: number;
  maxAmount: number;       // máximo borrowable (entero, floor del disponible)
  maxAmountStr: string;    // "3.00"
  onContinue: () => void;
  isLoadingTerms: boolean;
}

function AmountScreen({
  amountStr,
  setAmountStr,
  amountNum,
  maxAmount,
  maxAmountStr,
  onContinue,
  isLoadingTerms,
}: AmountScreenProps) {
  const overLimit = amountNum > maxAmount + 1e-9;
  const canContinue = amountNum > 0 && !overLimit && maxAmount > 0 && !isLoadingTerms;

  return (
    <div
      className="mx-auto flex w-full max-w-md flex-col px-5"
      style={{ minHeight: '82dvh', paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}
    >
      {/* Título — tenue, sin robar protagonismo al monto. */}
      <div className="pt-1 text-center">
        <h2 className="text-[13px] font-medium uppercase tracking-[0.14em]" style={{ color: 'rgba(21,35,59,0.45)' }}>
          Monto a solicitar
        </h2>
      </div>

      {/* Monto grande ("$" mismo tamaño que el número) — el protagonista. */}
      <div className="flex flex-1 flex-col items-center justify-center py-3">
        <p
          className="font-bold leading-none tracking-tight tabular-nums"
          style={{ fontSize: 'clamp(3.1rem, 16.5vw, 4.4rem)', color: overLimit ? '#ef4444' : '#15233b' }}
        >
          ${amountStr || '0'}
        </p>

        <div className="mt-4 flex items-center gap-2.5">
          <span className="text-[13px]" style={{ color: 'rgba(21,35,59,0.4)' }}>
            Disponible: <span className="font-semibold" style={{ color: 'rgba(21,35,59,0.6)' }}>${maxAmountStr}</span>
          </span>
          <button
            type="button"
            onClick={() => setAmountStr(maxAmountStr)}
            disabled={maxAmount <= 0}
            className="rounded-full px-3 py-1 text-[12px] font-bold uppercase tracking-wide transition-all active:scale-95 disabled:opacity-40"
            style={{ background: 'rgba(249,116,21,0.12)', color: '#F97415' }}
          >
            Máx
          </button>
        </div>

        {/* Estado: aviso si supera el límite disponible */}
        <div className="mt-2 h-[18px]">
          {overLimit && (
            <p className="text-[12px] font-medium" style={{ color: '#ef4444' }}>Supera tu límite disponible</p>
          )}
        </div>
      </div>

      {/* Teclado numérico más grande (teclas altas) para que respire y empuje
          el CTA más abajo. */}
      <NumericKeypad value={amountStr} onChange={setAmountStr} maxDecimals={2} buttonHeight={82} gapClass="gap-2.5" />

      {/* CTA sólido naranja */}
      <button
        type="button"
        onClick={onContinue}
        disabled={!canContinue}
        className="mt-4 flex h-[54px] w-full items-center justify-center gap-2 rounded-full text-[16px] font-semibold text-white transition-all active:scale-[0.98] disabled:opacity-50"
        style={{ backgroundColor: '#F97415', boxShadow: '0 6px 20px rgba(249,116,21,0.30)' }}
      >
        {isLoadingTerms ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" />
            Cargando tasas…
          </>
        ) : (
          <>
            Ver tasas
            <ArrowRight className="h-5 w-5" />
          </>
        )}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export type PrestarTabProps = {
  setShowQR: (show: boolean) => void;
  onBackToInicio?: () => void;
  isActive?: boolean;
};

export function PrestarTab({ setShowQR, onBackToInicio, isActive = true }: PrestarTabProps) {
  const { isLoggedIn, setShowAuthFlow, loadingNetwork } = useWallet();
  const { t } = useTranslation();

  const {
    borrowedRaw,
    borrowedDisplay,
    limitRaw,
    cooldownActive,
    cooldownUntil,
    cooldownSecondsLeft,
    hasActiveLoan,
    daysRemaining,
    termProgressPct,
    isAccruingLateFees,
    loanFeeBps,
  } = useCreditLine();

  const safeLimitRaw = limitRaw ?? 0n;
  const safeBorrowedRaw = borrowedRaw ?? 0n;

  const hasDebt = safeBorrowedRaw > 0n;

  // Compute available units (integer USDC) for the slider
  const availableRaw = safeLimitRaw - safeBorrowedRaw;
  // USDC has 6 decimals on-chain — compute floor of whole units
  const USDC_DECIMALS = 6n;
  const USDC_FACTOR = 10n ** USDC_DECIMALS;
  const maxAmountUnits = availableRaw > 0n ? Number(availableRaw / USDC_FACTOR) : 0;

  // availableAmount as a human string (for usePullPanel compatibility)
  const availableAmountStr =
    maxAmountUnits > 0 ? maxAmountUnits.toFixed(2) : '0.00';

  // Monto como STRING (lo maneja el teclado numérico). Arranca VACÍO (0) → el
  // user decide cuánto pedir desde cero (no preseteamos el máximo).
  const [amountStr, setAmountStr] = React.useState<string>('');
  const amount = parseFloat(amountStr) || 0;

  // Screen state: 'amount' | 'terms'
  const [screen, setScreen] = React.useState<'amount' | 'terms'>('amount');

  // Reset to amount screen when tab becomes inactive
  React.useEffect(() => {
    if (!isActive) setScreen('amount');
  }, [isActive]);

  // Pull panel hook (drives terms-screen borrow logic)
  const {
    handleSubmit,
    loadingTerms,
    setRequestedUnits,
    maxBorrowUnits,
    loanTerms,
    selectedTermIndex,
    setSelectedTermIndex,
    confirmTermAndBorrow,
    isBorrowing,
    baseAmountToShow,
    handleDialogOpenChange,
    isPreferentialRate,
  } = usePullPanel({
    isLoggedIn: !!isLoggedIn,
    loadingNetwork,
    onConnect: () => setShowAuthFlow(),
    availableAmount: availableAmountStr,
    setShowQR,
  });

  // Sync slider amount into the usePullPanel hook's requestedUnits
  React.useEffect(() => {
    if (maxBorrowUnits > 0) {
      setRequestedUnits(Math.min(amount, maxBorrowUnits));
    }
  }, [amount, maxBorrowUnits, setRequestedUnits]);

  const handleContinue = async () => {
    // Sync the current amount before submitting
    setRequestedUnits(Math.min(amount, maxBorrowUnits > 0 ? maxBorrowUnits : amount));
    await handleSubmit();
    // handleSubmit sets termOpen=true in the hook; we mirror that with local screen state
    setScreen('terms');
  };

  // Spec 046 — `hasDebt` takes priority over `cooldownActive`. A
  // post-writeOff user (hasDebt=true while cooldown still active) must
  // see the normal repay flow, identical to any borrower with a pending
  // loan. No cooldown copy, no different treatment. Cooldown is a
  // borrow-side lock-out only — it never blocks repayment.
  // --- Active loan / repay state (priority) ---
  if (hasDebt) {
    const daysForRepay =
      hasActiveLoan && daysRemaining != null ? daysRemaining : null;
    const progressForRepay =
      hasActiveLoan && termProgressPct != null ? termProgressPct : null;

    return (
      <>
      {/* Back button — fixed top-left */}
      {onBackToInicio && (
        <button
          type="button"
          onClick={onBackToInicio}
          className="fixed z-50 flex h-11 w-11 items-center justify-center rounded-full bg-white/80 backdrop-blur-sm shadow-sm transition-colors hover:bg-muted active:scale-95"
          style={{ top: '12px', left: '16px' }}
          aria-label="Volver"
        >
          <ArrowLeft className="h-5 w-5 text-muted-foreground" />
        </button>
      )}
      <div className="relative bg-background mx-auto w-full max-w-md px-5 space-y-3" style={{ paddingTop: '72px', paddingBottom: 'var(--tab-bar-h, 96px)' }}>
        <GridBackground />
        <RepayPanel
          isLoggedIn={!!isLoggedIn}
          loadingNetwork={loadingNetwork}
          onConnect={() => setShowAuthFlow()}
          outstandingLabel={t('borrow.market.outstandingLabel')}
          outstandingAmount={borrowedDisplay}
          outstandingRaw={borrowedRaw ?? null}
          isAccruingLateFees={isAccruingLateFees}
          daysRemaining={daysForRepay}
          termProgressPct={progressForRepay}
          loanFeeBps={loanFeeBps}
        />
      </div>
      </>
    );
  }

  // --- Cooldown state (only when no pending debt) ---
  if (cooldownActive && !hasDebt) {
    return (
      <>
        {/* Back button */}
        {onBackToInicio && (
          <button
            type="button"
            onClick={onBackToInicio}
            className="fixed z-50 flex h-11 w-11 items-center justify-center rounded-full bg-white/80 backdrop-blur-sm shadow-sm transition-colors hover:bg-muted active:scale-95"
            style={{ top: '12px', left: '16px' }}
            aria-label="Volver"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground"><path d="m15 18-6-6 6-6"/></svg>
          </button>
        )}
        <div className="relative mx-auto w-full max-w-md px-5 pt-14 flex flex-col items-center justify-center" style={{ minHeight: 'calc(100dvh - 120px)' }}>
          <GridBackground />
          <CooldownPanel
            cooldownUntil={cooldownUntil}
            cooldownSecondsLeft={cooldownSecondsLeft}
          />
        </div>
      </>
    );
  }

  // --- Terms screen ---
  if (screen === 'terms') {
    return (
      <div className="mx-auto w-full max-w-md pt-6">
        <TermsScreen
          amount={amount}
          onBack={() => setScreen('amount')}
          loanTerms={loanTerms}
          selectedTermIndex={selectedTermIndex}
          setSelectedTermIndex={setSelectedTermIndex}
          confirmTermAndBorrow={confirmTermAndBorrow}
          isBorrowing={isBorrowing}
          loadingTerms={loadingTerms}
          baseAmountToShow={baseAmountToShow}
          handleDialogOpenChange={handleDialogOpenChange}
          isPreferentialRate={isPreferentialRate}
        />
      </div>
    );
  }

  // --- Amount selection screen (default) ---
  return (
    <div className="mx-auto w-full max-w-md pt-2">
      <AmountScreen
        amountStr={amountStr}
        setAmountStr={setAmountStr}
        amountNum={amount}
        maxAmount={maxAmountUnits}
        maxAmountStr={availableAmountStr}
        onContinue={handleContinue}
        isLoadingTerms={loadingTerms}
      />
    </div>
  );
}
