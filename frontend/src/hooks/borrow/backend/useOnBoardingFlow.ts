"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { dedupeToast as toast } from "@/lib/dedupeToast";

import { useContracts } from "@/providers/ContractsProvider";
import { useBorrower } from "@/providers/BorrowerProvider";
import { useWallet } from "@/providers/WalletProvider";
import { normalizeErrorMessage } from "@/lib/utils";
import { useTranslation } from "@/i18n/useTranslation";
import { useApi } from "@/hooks/useApi";
import { ApiError, AuthError } from "@/lib/api";
import type { UserJourneyResponse, VerifyUserResponse } from "@shared/types/api";
import type { WorkType } from "@shared/types/work-type";
import type { Platform } from "@shared/types/platform";

export type { UserJourneyResponse };

type BackendProblem = {
  status?: "warning" | "error";
  error_code?: string;
  title?: string;
  message?: string;
  next_step?: string;
};

function parseBackendProblem(text: string): BackendProblem | null {
  const raw = (text || "").trim();
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object") return obj as BackendProblem;
    return null;
  } catch {
    return null;
  }
}


function deriveTermsAccepted(data?: UserJourneyResponse | null): boolean {
  if (!data) return false;
  return data.termsAccepted === true;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`Timeout after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

export function useOnBoardingFlow() {
  const { t } = useTranslation();
  const SESSION_ERROR_MSG = t("hooks.useOnBoardingFlow.errors.sessionInvalid");

  const { mode, isMiniApp, setShowAuthFlow, primaryWallet } = useWallet();
  const { ready: contractsReady, connectedAddress, refresh } = useContracts();

  const {
    ready: readyUser,
    isVerified,
    setIsVerified,
    goToWaitlist: goToWaitlistFlag,
    waitlistChecking,
    refreshAccessToken: _refreshAccessToken, // IMPORTANT: () => Promise<string> — kept for future use
    setLoanStatsFromJourney,
  } = useBorrower();
  const api = useApi();

  // ================== platform ==================
  const platform: Platform =
    mode === "lemon" || mode === "farcaster" || mode === "webapp"
      ? mode
      : "webapp";

  // ================== wallet ==================
  const wallet = useMemo(() => {
    const fromPrimary = primaryWallet?.address
      ? primaryWallet.address.toLowerCase()
      : null;

    // ✅ En farcaster: NO uses connectedAddress como fallback (flappea)
    if (mode === "farcaster") return fromPrimary;

    const fromConnected = connectedAddress ? connectedAddress.toLowerCase() : null;
    return fromPrimary ?? fromConnected ?? null;
  }, [mode, primaryWallet, connectedAddress]);

  const isLoggedIn = !!wallet;
  const sessionLoading = isLoggedIn && !readyUser;

  // ================== state ==================
  const [showQR, setShowQR] = useState(false);

  const [loading, setLoading] = useState(false);
  const [journey, setJourney] = useState<UserJourneyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);

  const [workType, setWorkType] = useState<WorkType | null>(null);

  const [verifying, setVerifying] = useState(false);
  const [verifyingFromOtp, setVerifyingFromOtp] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const [unlockedBorrow, setUnlockedBorrow] = useState(false);

  const [accessReady, setAccessReady] = useState(false);
  const [journeyAttempted, setJourneyAttempted] = useState(false);

  // ✅ Self requirement
  const [selfRequired, setSelfRequired] = useState(false);

  // ✅ TyC
  const [termsAccepted, setTermsAccepted] = useState<boolean>(false);
  const [acceptingTerms, setAcceptingTerms] = useState<boolean>(false);

  // ✅ Phone verification
  const [phoneVerified, setPhoneVerified] = useState<boolean>(false);
  const [pendingPhoneOtp, setPendingPhoneOtp] = useState<boolean>(false);

  // refs anti-race
  const autoStartedRef = useRef(false);
  const sendOtpInFlightRef = useRef(false);
  const waitlistOtpInFlightRef = useRef(false);
  const verifyInFlightRef = useRef(false);

  // ================== helpers ==================

  const setVerifyAndToast = useCallback(
    (raw: unknown, title?: string) => {
      const pretty = normalizeErrorMessage(raw) ?? "";
      setVerifyError(pretty);

      const fallback = t("hooks.useOnBoardingFlow.toast.genericError");
      toast.error(title || fallback);
    },
    [t],
  );

  const applyJourneyStats = useCallback(
    (data?: UserJourneyResponse | null) => {
      if (!data) return;

      setLoanStatsFromJourney(
        data.loansTotal ?? null,
        data.closedLoansTotal ?? null,
        data.loansOnTime ?? null,
        data.openLoansCount ?? null,
        data.xp ?? null,
        data.achievementsCount ?? null,
      );

      setEmail((prev) => (data.email ? data.email : prev));
    },
    [setLoanStatsFromJourney],
  );

  const updateJourneyFromResponse = useCallback(
    (data: UserJourneyResponse) => {
      setJourney(data);
      applyJourneyStats(data);

      // TyC
      setTermsAccepted(deriveTermsAccepted(data));

      // Phone — only set to true, never reset to false from a journey response
      // (prevents flicker when /loan/verify response doesn't include phoneVerified)
      if (data.phoneVerified === true) setPhoneVerified(true);
      setPendingPhoneOtp(data.pendingPhoneOtp === true);

      // WorkType — load from backend if present
      if (data.workType) setWorkType(data.workType as WorkType);

      // verified
      if (data.isVerified) {
        setIsVerified(true);
        setUnlockedBorrow(true);
      }
    },
    [applyJourneyStats, setIsVerified],
  );

  /** Light re-fetch of the journey from backend — useful when callers
   *  suspect the cached journey is stale (e.g. isEarlyUser flipped). */
  const refreshJourney = useCallback(async () => {
    const wallet = connectedAddress ?? primaryWallet;
    if (!wallet) return;
    try {
      const data = await api.getUser(wallet, platform);
      if (data) updateJourneyFromResponse(data);
    } catch {
      // swallow — this is a best-effort refresh
    }
  }, [connectedAddress, primaryWallet, api, platform, updateJourneyFromResponse]);

  const isSelfRequiredProblem = useCallback((status: number, bodyText: string) => {
    const problem = parseBackendProblem(bodyText);
    return (
      status === 428 ||
      problem?.status === "warning" ||
      problem?.error_code === "SELF_VERIFICATION_REQUIRED_FOR_FARCASTER" ||
      problem?.next_step === "self_verification"
    );
  }, []);

  // ✅ Trata 409/429 “already sent / cooldown” como OK para la UI
  const isOtpAlreadySentProblem = useCallback((status: number, bodyText: string) => {
    if (![409, 429].includes(status)) return false;

    const problem = parseBackendProblem(bodyText);
    const code = (problem?.error_code || "").toUpperCase();
    const next = (problem?.next_step || "").toLowerCase();
    const msg = (problem?.message || "").toLowerCase();
    const raw = (bodyText || "").toLowerCase();

    if (next.includes("otp")) return true;
    if (
      code.includes("OTP") &&
      (code.includes("SENT") || code.includes("ALREADY") || code.includes("COOLDOWN"))
    )
      return true;

    const hasAlready = raw.includes("already") || msg.includes("already");
    const hasOtp = raw.includes("otp") || msg.includes("otp") || raw.includes("code") || msg.includes("code");
    const hasCooldown = raw.includes("cooldown") || msg.includes("cooldown") || raw.includes("too many") || msg.includes("too many");

    return (hasAlready && hasOtp) || (hasCooldown && hasOtp);
  }, []);

  // ================== reset al cambiar wallet ==================
  useEffect(() => {
    setAccessReady(false);
    setUnlockedBorrow(false);

    setOtp("");
    setOtpSent(false);
    setSendingOtp(false);

    setVerifyError(null);
    setJourney(null);
    setError(null);
    setJourneyAttempted(false);
    setWorkType(null);

    setSelfRequired(false);

    setTermsAccepted(false);
    setAcceptingTerms(false);
    setPhoneVerified(false);

    autoStartedRef.current = false;

    setLoanStatsFromJourney(null, null, null, null, null, null);
  }, [wallet, setLoanStatsFromJourney]);

  // ================== fetch journey ==================
  useEffect(() => {
    if (!isLoggedIn) {
      setJourney(null);
      setLoading(false);
      setError(null);
      setJourneyAttempted(false);
      return;
    }
    if (!readyUser) return;
    if (!wallet) return;

    const addr = wallet;
    let cancelled = false;

    async function fetchJourney() {
      setJourneyAttempted(true);
      setLoading(true);
      setError(null);

      try {
        const data = await withTimeout(
          api.getUser(addr, platform),
          12000,
        );

        if (cancelled) return;
        updateJourneyFromResponse(data);
      } catch (e: unknown) {
        if (cancelled) return;

        if (e instanceof AuthError) {
          setError(SESSION_ERROR_MSG);
          toast.error(SESSION_ERROR_MSG);
        } else if (e instanceof ApiError) {
          const raw = e.body?.trim() || t("hooks.useOnBoardingFlow.errors.journeyHttp", { status: e.status });
          setError(normalizeErrorMessage(raw) ?? raw);
        } else {
          const raw = (e instanceof Error ? e.message : null) ?? t("hooks.useOnBoardingFlow.errors.journeyLoadFailed");
          setError(normalizeErrorMessage(raw) ?? raw);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void fetchJourney();
    return () => {
      cancelled = true;
    };
  }, [
    isLoggedIn,
    wallet,
    readyUser,
    platform,
    api,
    updateJourneyFromResponse,
    t,
    SESSION_ERROR_MSG,
  ]);

  // ================== accessReady gate ==================
  const shouldWaitContracts = !(mode === "farcaster" || isMiniApp);
  const shouldGateWaitlistChecking = !(mode === "farcaster" || isMiniApp);

  useEffect(() => {
    if (accessReady) return;
    if (shouldWaitContracts && !contractsReady) return;
    if (shouldGateWaitlistChecking && waitlistChecking) return;
    if (!readyUser) return;

    if (!isLoggedIn) {
      setAccessReady(true);
      return;
    }

    if (!journeyAttempted || loading) return;
    setAccessReady(true);
  }, [
    accessReady,
    shouldWaitContracts,
    contractsReady,
    shouldGateWaitlistChecking,
    waitlistChecking,
    readyUser,
    isLoggedIn,
    journeyAttempted,
    loading,
  ]);

  // Si viene de pending con OTP ya emitido (o vigente tras un reload)
  useEffect(() => {
    if (!journey || otpSent) return;

    const hasValidOtp =
      journey.requiresWaitlistOtp &&
      journey.otpExpiresAt &&
      new Date(journey.otpExpiresAt) > new Date();

    if (hasValidOtp || (journey.hasPendingWaitlist && journey.requiresWaitlistOtp)) {
      if (journey.email) setEmail(journey.email);
      setOtpSent(true);
    }
  }, [journey, otpSent]);

  // ===================== handlers =====================

  // ✅ EARLY: enviar OTP
  const handleSendOtp = useCallback(async (): Promise<boolean> => {
    if (sendOtpInFlightRef.current) return true;
    sendOtpInFlightRef.current = true;

    try {
      if (!wallet) {
        const msg = t("hooks.useOnBoardingFlow.errors.connectWallet");
        if (!isMiniApp) setShowAuthFlow();
        setVerifyAndToast(msg);
        return false;
      }
      if (!journey) {
        setVerifyAndToast(t("hooks.useOnBoardingFlow.errors.userStateNotFound"));
        return false;
      }

      const addr = wallet;
      const emailToUse = (email || journey.email || "").trim();
      if (!emailToUse) {
        setVerifyAndToast(t("hooks.useOnBoardingFlow.errors.enterEmail"));
        return false;
      }

      setVerifyError(null);
      setSendingOtp(true);
      setOtp(""); // opcional: limpiar input

      const { res, authFailed } = await api.rawAuthedPost("/user/verify-email", {
        walletAddress: addr,
        email: emailToUse,
        platform,
      });

      if (authFailed) {
        setVerifyAndToast(SESSION_ERROR_MSG);
        return false;
      }

      if (!res) {
        setVerifyAndToast(
          t("hooks.useOnBoardingFlow.errors.sendCodeError"),
          t("hooks.useOnBoardingFlow.toast.sendCodeFailedTitle"),
        );
        return false;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");

        // ✅ cooldown / already-sent => éxito para la UI
        if (isOtpAlreadySentProblem(res.status, text)) {
          setOtpSent(true);
          setEmail(emailToUse);

          toast.info(t("hooks.useOnBoardingFlow.toast.codeSent"));
          return true;
        }

        setVerifyAndToast(null, t("hooks.useOnBoardingFlow.toast.sendCodeFailedTitle"));
        return false;
      }

      const data = (await res.json().catch(() => null)) as UserJourneyResponse | null;
      if (data?.walletAddress) updateJourneyFromResponse(data);

      setOtpSent(true);
      setEmail(emailToUse);
      toast.success(t("hooks.useOnBoardingFlow.toast.codeSent"));
      return true;
    } catch (e: unknown) {
      setVerifyAndToast(
        (e instanceof Error ? e.message : null) ?? t("hooks.useOnBoardingFlow.errors.sendCodeNetwork"),
        t("hooks.useOnBoardingFlow.toast.sendCodeFailedTitle"),
      );
      return false;
    } finally {
      setSendingOtp(false);
      sendOtpInFlightRef.current = false;
    }
  }, [
    wallet,
    journey,
    email,
    platform,
    api,
    isMiniApp,
    setShowAuthFlow,
    setVerifyAndToast,
    updateJourneyFromResponse,
    t,
    SESSION_ERROR_MSG,
    isOtpAlreadySentProblem,
  ]);

  // ✅ Accept terms
  const handleAcceptTerms = useCallback(async () => {
    if (!wallet) {
      const msg = t("hooks.useOnBoardingFlow.errors.connectWallet");
      if (!isMiniApp) setShowAuthFlow();
      setVerifyAndToast(msg);
      return;
    }
    if (termsAccepted) return;

    try {
      setAcceptingTerms(true);
      setVerifyError(null);

      const data = await api.acceptTerms({ walletAddress: wallet, platform });

      setTermsAccepted(true);
      if (data?.walletAddress) updateJourneyFromResponse(data);
    } catch (e: unknown) {
      if (e instanceof AuthError) {
        setVerifyAndToast(SESSION_ERROR_MSG);
      } else if (e instanceof ApiError) {
        const raw = e.body?.trim() || t("hooks.useOnBoardingFlow.errors.acceptTermsHttp", { status: e.status });
        setVerifyAndToast(raw, t("hooks.useOnBoardingFlow.toast.acceptTermsFailedTitle"));
      } else {
        setVerifyAndToast(
          (e instanceof Error ? e.message : null) ?? t("hooks.useOnBoardingFlow.errors.acceptTermsError"),
          t("hooks.useOnBoardingFlow.toast.acceptTermsFailedTitle"),
        );
      }
    } finally {
      setAcceptingTerms(false);
    }
  }, [
    wallet,
    platform,
    isMiniApp,
    setShowAuthFlow,
    termsAccepted,
    api,
    setVerifyAndToast,
    updateJourneyFromResponse,
    t,
    SESSION_ERROR_MSG,
  ]);

  // ✅ EARLY: verify otp (si hace falta) + loan verify
  const handleEarlyAccessStart = useCallback(async () => {
    if (verifyInFlightRef.current) return;
    verifyInFlightRef.current = true;

    try {
      if (!wallet) {
        setVerifyAndToast(t("hooks.useOnBoardingFlow.errors.connectWallet"));
        if (!isMiniApp) setShowAuthFlow();
        return;
      }
      if (!journey) {
        setVerifyAndToast(t("hooks.useOnBoardingFlow.errors.userStateNotFound"));
        return;
      }

      // Capture wallet at call time to detect stale async results
      const addr = wallet;

      setVerifying(true);
      // Only show OTP animation when actually verifying email OTP
      if (journey.requiresWaitlistOtp === true) {
        setVerifyingFromOtp(true);
      }
      setVerifyError(null);
      setSelfRequired(false);

      // 1) OTP (solo si hace falta)
      if (journey.requiresWaitlistOtp === true) {
        if (!otpSent) {
          setVerifyAndToast(t("hooks.useOnBoardingFlow.errors.otpFirstSend"));
          return;
        }
        if (!otp.trim()) {
          setVerifyAndToast(t("hooks.useOnBoardingFlow.errors.otpEnter"));
          return;
        }
        // [MOCK] workType sent as default — will be updated after phone verification
        const { res: otpRes, authFailed: otpAuthFailed } =
          await api.rawAuthedPost("/user/verify-otp", {
            walletAddress: addr,
            code: otp.trim(),
            workType: workType || "other_job",
            platform,
          });

        if (otpAuthFailed) {
          setVerifyAndToast(SESSION_ERROR_MSG);
          if (!isMiniApp) setShowAuthFlow();
          return;
        }

        if (!otpRes) {
          setVerifyAndToast(
            t("hooks.useOnBoardingFlow.errors.verifyCodeNetwork"),
            t("hooks.useOnBoardingFlow.toast.verifyCodeFailedTitle"),
          );
          return;
        }

        if (!otpRes.ok) {
          const text = await otpRes.text().catch(() => "");
          const raw =
            text && text.trim().length > 0
              ? text.trim()
              : t("hooks.useOnBoardingFlow.errors.verifyOtpHttp", { status: otpRes.status });

          setVerifyAndToast(raw, t("hooks.useOnBoardingFlow.toast.verifyCodeFailedTitle"));
          return;
        }

        const otpData = (await otpRes.json().catch(() => null)) as UserJourneyResponse | null;
        if (otpData?.walletAddress) {
          updateJourneyFromResponse(otpData);
        } else {
          // OTP succeeded (200 OK) but the response didn't include a full journey object.
          // Clear requiresWaitlistOtp optimistically so screenKey can advance past early-init
          // after the green check animation plays.
          setJourney((prev) => (prev ? { ...prev, requiresWaitlistOtp: false } : prev));
        }

        setOtp("");
        // Clear otpSent so EmailStep detects the otpSent true→false transition and
        // shows the green check animation. The OTP completion is signalled by
        // journey.requiresWaitlistOtp being cleared (done above).
        setOtpSent(false);

        // Hold verifyingFromOtp=true for ~1.5 s so the green check animation plays while
        // the wizard is still visible. After this delay we clear it so the screenKey
        // transitions to "loading" (SplashLoader) before the /loan/verify call begins.
        await new Promise((r) => setTimeout(r, 1500));
        setVerifyingFromOtp(false);
      }

      // If phone not verified, stop here.
      // Account initialization (/loan/verify) runs after phone + survey are complete.
      if (!phoneVerified && (platform === "lemon" || platform === "webapp")) {
        setVerifying(false);
        return;
      }

      // 1.5) Persist workType if set (may have been selected after OTP was already verified)
      if (workType) {
        try {
          await api.rawAuthedPost("/user/update-work-type", {
            walletAddress: addr,
            workType,
          });
        } catch {
          // Non-blocking — workType is nice-to-have, don't fail the flow
        }
      }

      // 2) loan verify con retry suave
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

      for (let attempt = 1; attempt <= 3; attempt++) {
        const { res, authFailed } = await api.rawAuthedPost("/loan/verify", {
          walletAddress: addr,
          platform,
        });

        if (authFailed) {
          setVerifyAndToast(SESSION_ERROR_MSG);
          if (!isMiniApp) setShowAuthFlow();
          return;
        }

        if (!res) {
          if (attempt < 3) {
            await sleep(350 * attempt);
            continue;
          }
          setVerifyAndToast(
            t("hooks.useOnBoardingFlow.errors.verifyAccessError"),
            t("hooks.useOnBoardingFlow.toast.verifyAccessFailedTitle"),
          );
          return;
        }

        if (!res.ok) {
          const text = await res.text().catch(() => "");

          if (isSelfRequiredProblem(res.status, text)) {
            setSelfRequired(true);
            return;
          }

          setVerifyAndToast(null, t("hooks.useOnBoardingFlow.toast.verifyAccessFailedTitle"));
          return;
        }

        const data: VerifyUserResponse = await res
          .json()
          .catch(() => ({ verified: false }) as VerifyUserResponse);

        const ok = data?.verified === true || data?.ok === true || !!data?.user;
        if (!ok) {
          setVerifyAndToast(t("hooks.useOnBoardingFlow.errors.accessNotVerified"));
          return;
        }

        break;
      }

      // ✅ éxito
      setIsVerified(true);
      setUnlockedBorrow(true);
      setVerifyError(null);
      setSelfRequired(false);

      try {
        await refresh?.();
      } catch (e) {
        console.error("[OnBoarding] refresh after verify failed", e);
      }

      // Toast removed — the wizard shows its own success animation
    } catch (e: unknown) {
      setVerifyAndToast(
        (e instanceof Error ? e.message : null) ?? t("hooks.useOnBoardingFlow.errors.verifyAccessError"),
        t("hooks.useOnBoardingFlow.toast.verifyAccessFailedTitle"),
      );
    } finally {
      setVerifying(false);
      setVerifyingFromOtp(false);
      verifyInFlightRef.current = false;
    }
  }, [
    wallet,
    journey,
    otpSent,
    otp,
    workType,
    platform,
    api,
    isMiniApp,
    phoneVerified,
    setShowAuthFlow,
    setVerifyAndToast,
    updateJourneyFromResponse,
    setIsVerified,
    refresh,
    t,
    SESSION_ERROR_MSG,
    isSelfRequiredProblem,
  ]);

  // ✅ WAITLIST: enviar OTP
  const handleWaitlistSendOtp = useCallback(
    async (e?: React.FormEvent): Promise<boolean> => {
      if (e) e.preventDefault();
      if (waitlistOtpInFlightRef.current) return true;
      waitlistOtpInFlightRef.current = true;

      try {
        if (!journey) {
          setVerifyAndToast(t("hooks.useOnBoardingFlow.errors.userStateNotFound"));
          return false;
        }
        if (!wallet) {
          setVerifyAndToast(t("hooks.useOnBoardingFlow.errors.connectWallet"));
          if (!isMiniApp) setShowAuthFlow();
          return false;
        }

        const emailToUse = email.trim();
        if (!emailToUse) {
          setVerifyAndToast(t("hooks.useOnBoardingFlow.errors.enterEmail"));
          return false;
        }

        setVerifyError(null);
        setError(null);
        setSendingOtp(true);
        setOtp("");

        const { res, authFailed } = await api.rawAuthedPost("/user/join-waitlist", {
          walletAddress: wallet,
          email: emailToUse,
          platform,
        });

        if (authFailed) {
          setVerifyAndToast(SESSION_ERROR_MSG);
          return false;
        }
        if (!res) {
          setVerifyAndToast(
            t("hooks.useOnBoardingFlow.errors.sendCodeError"),
            t("hooks.useOnBoardingFlow.toast.sendCodeFailedTitle"),
          );
          return false;
        }

        if (!res.ok) {
          const text = await res.text().catch(() => "");

          if (isOtpAlreadySentProblem(res.status, text)) {
            setOtpSent(true);
            toast.info(t("hooks.useOnBoardingFlow.toast.codeSent"));
            return true;
          }

          setVerifyAndToast(null, t("hooks.useOnBoardingFlow.toast.sendCodeFailedTitle"));
          return false;
        }

        const data = (await res.json().catch(() => null)) as UserJourneyResponse | null;
        if (data?.walletAddress) updateJourneyFromResponse(data);

        setOtpSent(true);
        toast.success(t("hooks.useOnBoardingFlow.toast.codeSent"));
        return true;
      } catch (e2: unknown) {
        setVerifyAndToast(
          (e2 instanceof Error ? e2.message : null) ?? t("hooks.useOnBoardingFlow.errors.sendCodeNetwork"),
          t("hooks.useOnBoardingFlow.toast.sendCodeFailedTitle"),
        );
        return false;
      } finally {
        setSendingOtp(false);
        waitlistOtpInFlightRef.current = false;
      }
    },
    [
      journey,
      wallet,
      email,
      platform,
      api,
      isMiniApp,
      setShowAuthFlow,
      setVerifyAndToast,
      updateJourneyFromResponse,
      t,
      SESSION_ERROR_MSG,
      isOtpAlreadySentProblem,
    ],
  );

  // ✅ WAITLIST: confirmar OTP
  const handleWaitlistConfirm = useCallback(
    async (e?: React.FormEvent) => {
      if (e) e.preventDefault();

      if (!journey) {
        setVerifyAndToast(t("hooks.useOnBoardingFlow.errors.userStateNotFound"));
        return;
      }
      if (!wallet) {
        setVerifyAndToast(t("hooks.useOnBoardingFlow.errors.connectWallet"));
        if (!isMiniApp) setShowAuthFlow();
        return;
      }
      if (!otpSent) {
        setVerifyAndToast(t("hooks.useOnBoardingFlow.errors.otpFirstSend"));
        return;
      }
      if (!otp.trim()) {
        setVerifyAndToast(t("hooks.useOnBoardingFlow.errors.otpEnter"));
        return;
      }
      if (!workType) {
        setVerifyAndToast(t("hooks.useOnBoardingFlow.errors.workTypeRequired"));
        return;
      }

      try {
        setVerifying(true);
        setVerifyError(null);

        const { res, authFailed } = await api.rawAuthedPost("/user/verify-otp", {
          walletAddress: wallet,
          code: otp.trim(),
          workType,
          platform,
        });

        if (authFailed) {
          setVerifyAndToast(SESSION_ERROR_MSG);
          return;
        }
        if (!res) {
          setVerifyAndToast(
            t("hooks.useOnBoardingFlow.errors.verifyCodeNetwork"),
            t("hooks.useOnBoardingFlow.toast.verifyCodeFailedTitle"),
          );
          return;
        }
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          const raw =
            text && text.trim().length > 0
              ? text.trim()
              : t("hooks.useOnBoardingFlow.errors.verifyOtpHttp", { status: res.status });

          setVerifyAndToast(raw, t("hooks.useOnBoardingFlow.toast.verifyCodeFailedTitle"));
          return;
        }

        const data = (await res.json().catch(() => null)) as UserJourneyResponse | null;
        if (data?.walletAddress) updateJourneyFromResponse(data);

        setOtp("");
        setOtpSent(false);

        toast.success(t("hooks.useOnBoardingFlow.toast.waitlistJoined"));
      } catch (e2: unknown) {
        setVerifyAndToast(
          (e2 instanceof Error ? e2.message : null) ?? t("hooks.useOnBoardingFlow.errors.verifyCodeNetwork"),
          t("hooks.useOnBoardingFlow.toast.verifyCodeFailedTitle"),
        );
      } finally {
        setVerifying(false);
      }
    },
    [
      journey,
      wallet,
      otpSent,
      otp,
      workType,
      platform,
      api,
      isMiniApp,
      setShowAuthFlow,
      setVerifyAndToast,
      updateJourneyFromResponse,
      t,
      SESSION_ERROR_MSG,
    ],
  );

  // auto-start (si se liberó cupo y ya está early + email ok)
  const handleEarlyAccessFromWaitlist = useCallback(async () => {
    if (!wallet) return;

    // Capture wallet at call time to detect changes mid-flight
    const capturedWallet = wallet;

    try {
      setVerifying(true);
      setVerifyError(null);

      const { res, authFailed } = await api.rawAuthedPost("/loan/verify", {
        walletAddress: capturedWallet,
        platform,
      });

      if (authFailed) {
        setVerifyAndToast(SESSION_ERROR_MSG);
        return;
      }
      if (!res) {
        setVerifyAndToast(
          t("hooks.useOnBoardingFlow.errors.verifyAccessError"),
          t("hooks.useOnBoardingFlow.toast.verifyAccessFailedTitle"),
        );
        return;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        if (isSelfRequiredProblem(res.status, text)) {
          setSelfRequired(true);
          return;
        }
        setVerifyAndToast(
          text && text.trim().length > 0 ? text.trim() : `HTTP ${res.status}`,
          t("hooks.useOnBoardingFlow.toast.verifyAccessFailedTitle"),
        );
        return;
      }

      const data: VerifyUserResponse = await res
        .json()
        .catch(() => ({ verified: false }) as VerifyUserResponse);

      const ok = data?.verified === true || data?.ok === true || !!data?.user;
      if (!ok) {
        setVerifyAndToast(t("hooks.useOnBoardingFlow.errors.accessNotVerified"));
        return;
      }

      setIsVerified(true);
      setUnlockedBorrow(true);
      setSelfRequired(false);

      try {
        await refresh?.();
      } catch (e) {
        console.error("[OnBoarding] refresh after auto-verify failed", e);
      }
    } finally {
      setVerifying(false);
    }
  }, [
    wallet,
    platform,
    api,
    setVerifyAndToast,
    setIsVerified,
    refresh,
    SESSION_ERROR_MSG,
    t,
    isSelfRequiredProblem,
  ]);

  useEffect(() => {
    if (!journey) return;
    if (!journey.isEarlyUser) return;
    if (!journey.email) return;
    if (journey.requiresWaitlistOtp) return;
    if (isVerified || unlockedBorrow) return;
    if (verifying) return;

    if (autoStartedRef.current) return;
    autoStartedRef.current = true;

    void handleEarlyAccessFromWaitlist();

    // Wallet change cleanup: reset ref so the effect can re-run for the new wallet
    // (the wallet reset effect at line 215 already resets autoStartedRef)
  }, [journey, isVerified, unlockedBorrow, verifying, handleEarlyAccessFromWaitlist]);

  const loadingLabel = useMemo(() => {
    if (!isLoggedIn) return t("hooks.useOnBoardingFlow.loading.app");
    if (!readyUser) return t("hooks.useOnBoardingFlow.loading.session");
    return t("hooks.useOnBoardingFlow.loading.accessCheck");
  }, [isLoggedIn, readyUser, t]);

  return {
    // flags
    ready: accessReady,
    loadingLabel,
    sessionLoading,
    isLoggedIn,
    setShowAuthFlow,
    isVerified,
    goToWaitlistFlag,

    // journey
    journey,
    error,
    accessReady,
    unlockedBorrow,

    // otp/email/work
    email,
    setEmail,
    otp,
    setOtp,
    otpSent,
    sendingOtp,
    workType,
    setWorkType,

    // verify
    verifying,
    verifyingFromOtp,
    verifyError,

    // self
    selfRequired,

    // TyC
    termsAccepted,
    setTermsAccepted,
    acceptingTerms,
    handleAcceptTerms,

    // Phone
    phoneVerified,
    pendingPhoneOtp,
    handlePhoneVerified: () => setPhoneVerified(true),

    // ui
    showQR,
    setShowQR,

    // handlers
    handleSendOtp,
    handleEarlyAccessStart,
    handleWaitlistSendOtp,
    handleWaitlistConfirm,
    refreshJourney,
  };
}
