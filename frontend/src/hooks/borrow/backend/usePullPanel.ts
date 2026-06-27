'use client';

import { useState, FormEvent, useEffect, useCallback, useRef } from "react";
import { dedupeToast as toast } from "@/lib/dedupeToast";

import { useBorrow } from "@/hooks/borrow/blockchain/useBorrow";
import { useBorrower } from "@/providers/BorrowerProvider";
import { useContracts } from "@/providers/ContractsProvider";
import { useWallet } from "@/providers/WalletProvider";
import { useCreditLine } from "@/hooks/borrow/blockchain/useCreditLine";
import { softWait, normalizeErrorMessage } from "@/lib/utils";
import { useApi } from "@/hooks/useApi";
import { ApiError, AuthError } from "@/lib/api";
import { normalizeWalletAddress } from "@/lib/wallet-address";
import { useTranslation } from "@/i18n/useTranslation";

export type PullPanelProps = {
  isLoggedIn: boolean;
  loadingNetwork: boolean;
  onConnect: () => void;
  onPull?: (amount: string) => void;
  /** Monto disponible para pedir (en USDC, string humana, ej: "1,000.00") */
  availableAmount?: string | null;
  /** Display de la línea total, ej: "0.00/1,000.00 USDC" (por ahora no se usa) */
  lineDisplay?: string | null;
  setShowQR: (show: boolean) => void;
};

import type { LoanTermOption } from "@shared/types/loan";

export type { LoanTermOption };

/** Dev log a vite terminal (no rompe nada) */
function postClientLog(
  level: "log" | "warn" | "error",
  msg: string,
  extra: Record<string, unknown> = {},
) {
  try {
    fetch("/__client-log", {
      method: "POST",
      body: JSON.stringify({
        level,
        msg,
        tag: "PullPanel",
        time: Date.now(),
        ...extra,
      }),
    }).catch(() => {});
  } catch {
    // ignore
  }
}

/** Formatea string "1000.5" -> "1,000.50" (sin tocar la parte numérica real) */
export function formatAmountHuman(amount: string): string {
  const trimmed = amount.trim();
  if (!trimmed) return "0.00";

  const [rawInt, rawFrac = ""] = trimmed.split(".");
  const intPart = rawInt.replace(/^0+(?=\d)/, "") || "0";
  const frac = (rawFrac + "00").slice(0, 2);

  const intWithSep = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${intWithSep}.${frac}`;
}

/** Convierte string humana "1,000.00" -> número JS (solo para checks básicos) */
function parseHumanUsdcToNumber(human: string | null | undefined): number {
  if (!human) return 0;
  const cleaned = human.replace(/,/g, "").trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

type UsePullPanelParams = PullPanelProps;

export type UsePullPanelResult = {
  scoreDisplay: string | null;
  isVerified: boolean;
  isLemon: boolean;

  cta: string;
  isDisabled: boolean;
  verifyError: string | null;
  isBorrowing: boolean;
  hasAvailable: boolean;
  availableAmountToShow: string;

  /** slider: máximo entero (1..maxBorrowUnits) y valor seleccionado */
  maxBorrowUnits: number;
  requestedUnits: number;
  setRequestedUnits: (n: number) => void;
  requestedAmountHuman: string;

  termOpen: boolean;
  handleDialogOpenChange: (open: boolean) => void;

  handleSubmit: (e?: FormEvent) => Promise<void>;
  confirmTermAndBorrow: () => Promise<void>;

  loanTerms: LoanTermOption[] | null;
  selectedTermIndex: number;
  setSelectedTermIndex: (idx: number) => void;
  baseAmountToShow: string;
  isPreferentialRate: boolean;

  verifyingLemon: boolean;
  loadingTerms: boolean;
  authLoading: boolean;
};

export function usePullPanel({
  isLoggedIn: isLoggedInProp,
  loadingNetwork,
  onConnect,
  onPull,
  availableAmount,
  lineDisplay: _lineDisplay, // reservado por si lo usamos después
  setShowQR,
}: UsePullPanelParams): UsePullPanelResult {
  const { t } = useTranslation();

  // -------- UI state --------
  const [termOpen, setTermOpen] = useState(false);
  const [selectedTermIndex, setSelectedTermIndex] = useState<number>(0);
  const [pendingAmount, setPendingAmount] = useState<string | null>(null);

  // Loan terms desde el backend
  const [loanTerms, setLoanTerms] = useState<LoanTermOption[] | null>(null);
  const [loanBaseAmount, setLoanBaseAmount] = useState<string | null>(null);
  const [loadingTerms, setLoadingTerms] = useState(false);
  const [isPreferentialRate, setIsPreferentialRate] = useState<boolean>(false);

  // Lemon verification state (solo por compat, ahora no bloquea)
  const [verifyingLemon] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  // Backend borrow loading
  const [backendBorrowing, setBackendBorrowing] = useState(false);

  // Sync guard against double-tap on the borrow CTA. Mobile WebViews can fire
  // touch+click synthetic events that reach the handler before React re-renders
  // the disabled={isBorrowing} prop, causing N parallel borrow flows from a
  // single tap (observed in production: 6+ /loan/borrow requests per click).
  const confirmInFlightRef = useRef(false);

  // -------- app/context hooks --------
  const { isVerified, authLoading } = useBorrower();
  const api = useApi();
  const { connectedAddress } = useContracts();
  const { isLemonMiniApp, mode, primaryWallet } = useWallet();
  const { submit, submitting } = useBorrow({ requireController: true });
  const { scoreDisplay } = useCreditLine();

  const sessionInvalidMsg = t("hooks.usePullPanel.errors.sessionInvalid");

  // -------- resolver wallet global --------
  const normalizeLower = (addr?: string | null): string | null =>
    normalizeWalletAddress(addr, mode);

  // En orden:
  // 1) primaryWallet.address (wagmi → web + farcaster)
  // 2) connectedAddress (Lemon mini-app)
  const walletAddress =
    normalizeLower(primaryWallet?.address) ??
    normalizeLower(connectedAddress);

  const isLemon = isLemonMiniApp;

  // Wallet para mandar al backend en loan-terms / verify / etc.
  const userWallet = walletAddress;

  // Receiver para /loan/borrow:
  // - Lemon: la address de la mini-app (connectedAddress si está; si no wallet; si no "lemon-user").
  // - Web/Farcaster: la wallet del usuario.
  const lemonWallet =
    normalizeLower(
      isLemon
        ? connectedAddress ?? walletAddress ?? "lemon-user"
        : walletAddress ?? "lemon-user",
    ) ?? "lemon-user";

  // Estado "logged in" real: que haya wallet concreta
  const isLoggedInResolved = !!walletAddress && !!isLoggedInProp;

  const isBorrowing = backendBorrowing || submitting;

  // Helper centralizado para errores + toast
  const setVerifyAndToast = useCallback(
    (raw: unknown, title?: string) => {
      const pretty = normalizeErrorMessage(raw) ?? "";
      setVerifyError(pretty);

      const fallback = t("hooks.usePullPanel.toast.genericError");
      toast.error(title || fallback);
    },
    [t],
  );

  // -------- monto disponible --------
  const numericAvailable =
    availableAmount && availableAmount !== "—"
      ? parseHumanUsdcToNumber(availableAmount)
      : 0;
  const hasAvailable = numericAvailable > 0;

  // -------- slider: 1 .. floor(available) --------
  const maxBorrowUnits = hasAvailable
    ? Math.max(1, Math.floor(numericAvailable))
    : 0;
  const [requestedUnits, setRequestedUnits] = useState<number>(
    maxBorrowUnits || 0,
  );

  useEffect(() => {
    if (maxBorrowUnits > 0) {
      setRequestedUnits((prev) =>
        prev > 0 ? Math.min(prev, maxBorrowUnits) : maxBorrowUnits,
      );
    } else {
      setRequestedUnits(0);
    }
  }, [maxBorrowUnits]);

  const requestedAmountHuman =
    maxBorrowUnits > 0 && requestedUnits > 0
      ? requestedUnits.toFixed(2)
      : "0.00";

  const baseAmountToShow =
    loanBaseAmount ??
    pendingAmount ??
    (requestedAmountHuman || availableAmount || "0.00");

  const availableAmountToShow = hasAvailable ? availableAmount ?? "0.00" : "0.00";

  // -------- Cargar términos desde el backend (con AccessTokenGuard) --------
  const loadLoanTerms = async (amountHuman: string) => {
    if (!userWallet) {
      setVerifyAndToast(t("hooks.usePullPanel.errors.walletMissing"));
      return false;
    }

    setLoadingTerms(true);
    try {
      const cleanAmount = amountHuman.replace(/,/g, "");
      postClientLog("log", "loan-terms start", { walletAddress: userWallet, amountHuman: cleanAmount });

      const data = await api.getLoanTerms({
        walletAddress: userWallet,
        amountHuman: cleanAmount,
      });

      const terms: LoanTermOption[] = Array.isArray(data?.terms) ? data.terms : [];

      if (!terms.length) {
        setVerifyAndToast(t("hooks.usePullPanel.errors.noTermsForAmount"));
        return false;
      }

      setLoanTerms(terms);
      setLoanBaseAmount(data?.baseAmount ?? amountHuman);
      setIsPreferentialRate(data?.isPreferentialRate ?? false);
      setSelectedTermIndex(0);
      setPendingAmount(data?.baseAmount ?? amountHuman);

      postClientLog("log", "loan-terms ok", { termsCount: terms.length });
      return true;
    } catch (e: unknown) {
      postClientLog("error", "loan-terms fetch error", { err: String(e?.message || e) });

      if (e instanceof AuthError) {
        setVerifyAndToast(sessionInvalidMsg);
      } else if (e instanceof ApiError) {
        const raw = e.body?.trim() || t("hooks.usePullPanel.errors.termsNotAvailable");
        setVerifyAndToast(raw, t("hooks.usePullPanel.toast.termsTitle"));
      } else {
        setVerifyAndToast(e?.message ?? t("hooks.usePullPanel.errors.loadTermsFailed"));
      }
      return false;
    } finally {
      setLoadingTerms(false);
    }
  };

  // -------- (ya no bloquea) verificación Lemon --------
  const verifyLemonIfNeeded = async (): Promise<boolean> => {
    if (!isLemon) return true;
    return true;
  };

  // -------- Click principal: verifica sesión y abre modal --------
  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault();

    if (!isLoggedInResolved) {
      onConnect?.();
      return;
    }

    if (
      !hasAvailable ||
      !availableAmount ||
      maxBorrowUnits <= 0 ||
      requestedUnits <= 0
    ) {
      setVerifyAndToast(t("hooks.usePullPanel.errors.chooseValidAmount"));
      return;
    }

    // Gating de verificación:
    // - En web/Farcaster → QR si no está verificado.
    // - En Lemon → confiamos en el flow de onboarding.
    if (!isVerified) {
      if (!isLemon) {
        setShowQR(true);
        return;
      }

      const ok = await verifyLemonIfNeeded();
      if (!ok) return;
    }

    const ok = await loadLoanTerms(requestedAmountHuman);
    if (!ok) return;

    setTermOpen(true);
  };

  // -------- Confirmar plazo y ejecutar borrow --------
  const confirmTermAndBorrow = async () => {
    // Synchronous guard — blocks the second tap on mobile (touch+click) BEFORE
    // React re-renders the disabled={isBorrowing} button prop. This is what
    // truly prevents the duplicate /loan/borrow requests we saw in production.
    if (confirmInFlightRef.current) {
      postClientLog("warn", "confirmTermAndBorrow ignored: already in flight");
      return;
    }
    confirmInFlightRef.current = true;

    if (!pendingAmount || !loanTerms || !loanTerms.length) {
      setTermOpen(false);
      confirmInFlightRef.current = false;
      return;
    }

    const selectedTerm =
      loanTerms[Math.min(selectedTermIndex, loanTerms.length - 1)];

    const termDays = selectedTerm.days;
    const feeBps =
      typeof selectedTerm.feeBps === "number" && selectedTerm.feeBps > 0
        ? Math.floor(selectedTerm.feeBps)
        : 3000;

    postClientLog("log", "borrow term selected", {
      days: termDays,
      feeBps,
      amount: pendingAmount,
    });

    // Track whether the borrow actually completed end-to-end. Drives whether
    // we clear the dialog state in the finally block. Without this, a user
    // who cancels the Lemon popup loses pendingAmount/termOpen and the
    // "Confirmar y continuar" button silently no-ops on the second click —
    // because confirmTermAndBorrow's early-return guard sees !pendingAmount.
    // The repay flow doesn't have this bug because it pulls outstandingAmount
    // from the parent component (still valid on retry).
    let borrowSucceeded = false;

    try {
      // Disable button immediately to prevent double-clicks spamming the API.
      // The finally block guarantees this is reset, so no stuck-spinner risk.
      setBackendBorrowing(true);

      const data = await api.borrow({
        amountHuman: pendingAmount,
        receiver: lemonWallet,
        tenorDays: termDays,
      });

      postClientLog("log", "borrow authorized", { data });

      const ok = await submit(pendingAmount, termDays, feeBps);
      if (!ok) {
        // Lemon popup cancel / on-chain reject — keep dialog state intact
        // so the user can immediately retry "Confirmar y continuar".
        postClientLog("warn", "borrow submit returned false");
        return;
      }

      await softWait(3_000);
      toast.success(t("hooks.usePullPanel.toast.borrowSuccess"));
      onPull?.(pendingAmount);
      borrowSucceeded = true;
    } catch (err: unknown) {
      postClientLog("error", "borrow submit failed", {
        err: String(err?.message || err),
      });
      console.error(err);

      if (err instanceof AuthError) {
        setVerifyAndToast(sessionInvalidMsg);
      } else if (err instanceof ApiError) {
        const raw = err.body?.trim() || t("hooks.usePullPanel.errors.authorizeBorrowFailed");
        setVerifyAndToast(raw, t("hooks.usePullPanel.toast.authorizeTitle"));
      } else {
        const raw = err?.message ?? t("hooks.usePullPanel.errors.borrowFailed");
        setVerifyAndToast(raw, t("hooks.usePullPanel.toast.borrowFailedTitle"));
      }
    } finally {
      // Always release the in-flight guards so the user isn't stuck on a
      // disabled button. But ONLY clear pendingAmount/termOpen on success
      // — on cancel/error the user should be able to tap "Confirmar y
      // continuar" again to re-trigger the Lemon popup.
      setBackendBorrowing(false);
      confirmInFlightRef.current = false;
      if (borrowSucceeded) {
        setPendingAmount(null);
        setTermOpen(false);
      }
    }
  };

  // -------- CTA & disabled --------
  const cta =
    authLoading
      ? t("hooks.usePullPanel.cta.preparingSession")
      : verifyingLemon
      ? t("hooks.usePullPanel.cta.verifying")
      : !isLoggedInResolved && !loadingNetwork
      ? t("hooks.usePullPanel.cta.connectWallet")
      : isBorrowing || loadingTerms
      ? t("hooks.usePullPanel.cta.gettingRates")
      : hasAvailable
      ? t("hooks.usePullPanel.cta.simulate")
      : t("hooks.usePullPanel.cta.noLimit");

  const isDisabled =
    authLoading ||
    verifyingLemon ||
    isBorrowing ||
    loadingTerms ||
    (isLoggedInResolved && !hasAvailable);

  const handleDialogOpenChange = (open: boolean) => {
    if (!open) {
      // Always clean up when the dialog closes — even during a borrow race.
      // confirmTermAndBorrow's finally block also resets these, so
      // double-clearing is harmless.
      setTermOpen(false);
      setPendingAmount(null);
      setLoanTerms(null);
      setLoanBaseAmount(null);
      setIsPreferentialRate(false);
    } else {
      setTermOpen(true);
    }
  };

  return {
    scoreDisplay,
    isVerified,
    isLemon,

    cta,
    isDisabled,
    verifyError,
    isBorrowing,
    hasAvailable,
    availableAmountToShow,

    maxBorrowUnits,
    requestedUnits,
    setRequestedUnits,
    requestedAmountHuman,

    termOpen,
    handleDialogOpenChange,
    handleSubmit,
    confirmTermAndBorrow,

    loanTerms,
    selectedTermIndex,
    setSelectedTermIndex,
    baseAmountToShow,
    isPreferentialRate,

    verifyingLemon,
    loadingTerms,
    authLoading,
  };
}
