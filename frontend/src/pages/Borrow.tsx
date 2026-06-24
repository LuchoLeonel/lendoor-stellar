// src/app/.../BorrowPage.tsx
"use client";

import * as React from "react";

import { CreditMarket } from "@/components/borrow/BorrowMarket";
import NotLoggedIn from "@/components/onboarding/NotLoggedIn";
import ErrorComponent from "@/components/onboarding/ErrorComponent";
import NotAvailable from "@/components/onboarding/NotAvailable";
import OnWaitList from "@/components/onboarding/OnWaitlist";
import JoinWaitlist from "@/components/onboarding/JoinWaitlist";
import SlidingScreens from "@/components/common/SlidingScreens";

import { useOnBoardingFlow } from "@/hooks/borrow/backend/useOnBoardingFlow";
import { WebEnvironmentGuard } from "@/components/common/WebEnvironmentGuard";
import { useWallet } from "@/providers/WalletProvider";
import SelfVerificationFarcaster from "@/components/onboarding/SelfVerificationFarcaster";
import { useTranslation } from "@/i18n/useTranslation";
import { SplashLoader } from "@/components/common/SplashLoader";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { useLoanStatsStore } from "@/stores/loanStatsStore";

function BorrowPageInner() {
  const { mode } = useWallet();
  const { t } = useTranslation();

  const {
    ready,
    loadingLabel,
    isLoggedIn,
    setShowAuthFlow,
    isVerified,
    goToWaitlistFlag,
    journey,
    error,
    accessReady,
    unlockedBorrow,
    termsAccepted,
    setTermsAccepted,
    acceptingTerms,
    handleAcceptTerms,
    email,
    setEmail,
    otp,
    setOtp,
    otpSent,
    sendingOtp,
    workType,
    setWorkType,
    verifying,
    verifyingFromOtp,
    verifyError,
    setShowQR,
    handleSendOtp,
    handleEarlyAccessStart,
    handleWaitlistSendOtp,
    handleWaitlistConfirm,
    phoneVerified,
    handlePhoneVerified,
    refreshJourney,
  } = useOnBoardingFlow();

  const loansCount = useLoanStatsStore((s) => s.loansCount);
  // Spec 055 — `hasOpenLoan` previously derived from
  // (loansCount > closedLoansCount). That broke when spec 013 backfilled
  // closedAt=dueAt on defaulted loans: those counted as "closed" even
  // though closeTxHash IS NULL means they're still owed on-chain. The
  // backend now exposes `openLoansCount` sourced from `closeTxHash IS NULL`
  // — the only honest definition of "this user still owes money".
  const openLoansCount = useLoanStatsStore((s) => s.openLoansCount);
  const hasOpenLoan =
    typeof openLoansCount === "number" && openLoansCount > 0;

  const [selfVerifiedInSession, setSelfVerifiedInSession] = React.useState(false);
  const initInFlightRef = React.useRef(false);

  // After phone verification, show a brief "initializing" splash before going to borrow
  const [phoneJustVerified, setPhoneJustVerified] = React.useState(false);
  // Survey: skip if workType already exists from DB, otherwise require explicit submit
  const [surveyConfirmed, setSurveyConfirmed] = React.useState(false);
  const workTypeFromDB = journey?.workType;
  const surveySubmitted = surveyConfirmed || !!workTypeFromDB;
  const handlePhoneVerifiedWithAnimation = React.useCallback(() => {
    handlePhoneVerified();
    setPhoneJustVerified(true);
    setTimeout(() => setPhoneJustVerified(false), 2500);
  }, [handlePhoneVerified]);

  // reset selfVerifiedInSession on wallet change
  React.useEffect(() => {
    setSelfVerifiedInSession(false);
  }, [journey?.walletAddress]);

  // Track whether /loan/verify has been called this session
  const loanVerifyDoneRef = React.useRef(false);

  // Detect "all prerequisites met but no score and not early" → stale journey.
  // Covers users whose isEarlyUser flipped from false→true after re-scoring
  // changed the waitlist order. Force one re-fetch to get the updated isEarlyUser.
  const journeyRefreshAttemptedRef = React.useRef(false);
  React.useEffect(() => {
    if (!journey) return;
    if (journey.isEarlyUser) return;
    if (journey.score != null && journey.score > 0) return;
    if (journeyRefreshAttemptedRef.current) return;

    const hasEmail = !!journey.email;
    const needsOtp = !!journey.requiresWaitlistOtp;
    const otpCompleted = hasEmail && !needsOtp;
    if (!otpCompleted) return;

    const phoneOk = (mode !== "lemon" && mode !== "webapp") || phoneVerified;
    const surveyOk = (mode !== "lemon" && mode !== "webapp") || surveySubmitted;
    if (!phoneOk || !surveyOk) return;

    journeyRefreshAttemptedRef.current = true;

    // Re-fetch journey to get updated isEarlyUser from backend
    refreshJourney();
  }, [journey, mode, phoneVerified, surveySubmitted, refreshJourney]);

  const canInitEarlyNow = React.useMemo(() => {
    if (!journey) return false;
    if (!journey.isEarlyUser) return false;

    const hasEmail = !!journey.email;
    const needsOtp = !!journey.requiresWaitlistOtp;
    const otpCompleted = hasEmail && !needsOtp;

    if (!otpCompleted) return false;
    if (loanVerifyDoneRef.current) return false;
    if (verifying) return false;

    // Lemon/webapp: also need phone verification + survey submitted before initializing
    if ((mode === "lemon" || mode === "webapp") && !phoneVerified) return false;
    if ((mode === "lemon" || mode === "webapp") && !surveySubmitted) return false;

    // For Farcaster, also need self verification
    if (mode === "farcaster" && !selfVerifiedInSession) return false;

    return true;
  }, [journey, mode, verifying, phoneVerified, surveySubmitted, selfVerifiedInSession]);

  // Auto-initialize account when all conditions are met (email + phone verified)
  React.useEffect(() => {
    if (!canInitEarlyNow) return;
    if (initInFlightRef.current) return;
    initInFlightRef.current = true;

    handleEarlyAccessStart()
      .then(() => {
        // Only mark as done if the call succeeded (user got a score).
        // If it failed (auth error, network, 403), leave it false so
        // canInitEarlyNow can re-trigger on the next render cycle.
        if (journey?.score != null || isVerified) {
          loanVerifyDoneRef.current = true;
        }
      })
      .finally(() => {
        initInFlightRef.current = false;
      });
  }, [canInitEarlyNow, handleEarlyAccessStart, journey?.score, isVerified]);

  const handleSelfVerifiedAndInit = React.useCallback(async () => {
    setSelfVerifiedInSession(true);
    // canInitEarlyNow effect will handle the init
  }, []);

  const screenKey = React.useMemo(() => {
    // Mock mode for testing
    const urlParams = new URLSearchParams(window.location.search);
    const mockScreen = urlParams.get("mock");
    if (mockScreen === "waitlist") return "waitlist";

    if (!ready) return "loading";

    if (!isLoggedIn && (mode === "farcaster" || mode === "webapp")) return "not-logged-in";
    if (error) return "error";
    if (!accessReady) return "loading";
    if (!journey) return "loading";

    if (!termsAccepted && (mode === "lemon" || mode === "webapp" || mode === "farcaster")) return "terms";

    // Stay on the loading splash while loan/verify is in progress.
    // This prevents the skeleton flash: loading → borrow skeleton → loading.
    if (verifying) return "loading";

    // ✅ Early user flow — evaluated FIRST so backend isVerified doesn't hijack to standalone
    if (journey.isEarlyUser) {
      // Wait for loan stats before routing
      if (loansCount === null) return "loading";

      // Early user who already has loans → treat as existing user (fall through)
      const userHasLoans = typeof loansCount === "number" && loansCount > 0;
      if (!userHasLoans) {
        const hasEmail = !!journey.email;
        const needsOtp = !!journey.requiresWaitlistOtp;
        const otpCompleted = hasEmail && !needsOtp;

        // Farcaster needs self-verification after email OTP
        if (otpCompleted && mode === "farcaster" && !selfVerifiedInSession) return "early-self";

        // While verifyingFromOtp: stay on early-init so the green check animation plays
        if (verifyingFromOtp) return "early-init";

        // After email OTP, verify phone before initializing account (wizard)
        if (otpCompleted && !phoneVerified && (mode === "lemon" || mode === "webapp")) return "early-phone";

        // After phone, survey before initializing account
        if (otpCompleted && phoneVerified && !surveySubmitted && (mode === "lemon" || mode === "webapp")) return "early-survey";

        // Phone just verified — show initializing splash briefly
        if (phoneJustVerified) return "loading";

        // Fully done (email + phone + verified) → borrow
        if ((isVerified || unlockedBorrow) && phoneVerified) return "borrow";

        // Phone verified + survey done → initialize account
        if (otpCompleted && mode !== "farcaster") {
          if (verifyError) return "early-init";
          return "loading";
        }

        // Farcaster: verifying after self → loading
        if (verifying) return "loading";

        // Still completing email/otp
        if (!otpCompleted || !!verifyError) return "early-init";

        return "loading";
      }
    }

    // ── Existing / returning users below ──

    // Waitlist users don't need loansCount to resolve — show waitlist immediately.
    if (journey.isInWaitlist) return "waitlist";

    const shouldGoToWaitlist =
      (journey.goToWaitlist !== undefined ? journey.goToWaitlist : goToWaitlistFlag) ?? false;
    if (shouldGoToWaitlist) return "waitlist-flow";

    // Wait for loan stats
    if (loansCount === null) return "loading";

    const userHasLoans = typeof loansCount === "number" && loansCount > 0;

    // Phone verification gate for existing users (standalone)
    if ((isVerified || unlockedBorrow || userHasLoans) && !phoneVerified && !hasOpenLoan && (mode === "lemon" || mode === "webapp")) return "phone-verify";

    if (isVerified || unlockedBorrow || userHasLoans) return "borrow";

    return "not-available";
  }, [
    ready,
    isLoggedIn,
    mode,
    error,
    accessReady,
    journey,
    termsAccepted,
    phoneVerified,
    hasOpenLoan,
    isVerified,
    unlockedBorrow,
    goToWaitlistFlag,
    selfVerifiedInSession,
    verifying,
    verifyingFromOtp,
    verifyError,
    loansCount,
    phoneJustVerified,
    surveySubmitted,
  ]);

  // Derive the loading label based on current state — all rendered by a single
  // "loading" screenKey so SlidingScreens won't animate between them.
  const splashLabel = React.useMemo(() => {
    if (!ready) return loadingLabel;
    if (!accessReady) return t("pages.borrow.loading.accessCheck");
    if (!journey) return t("pages.borrow.loading.noJourney");
    return t("pages.borrow.loading.updatingCredit");
  }, [ready, accessReady, journey, verifying, loadingLabel, t]);

  // Manual navigation override — lets the user go back/forward through onboarding
  // steps even when the computed screenKey would skip them.
  const [screenOverride, setScreenOverride] = React.useState<string | null>(null);

  // Clear override whenever the computed screenKey changes naturally (e.g. after
  // a backend call completes and advances the flow), OR when the override would
  // hold the user on a step they've already completed.
  const prevScreenKey = React.useRef(screenKey);
  React.useEffect(() => {
    if (screenKey !== prevScreenKey.current) {
      setScreenOverride(null);
      prevScreenKey.current = screenKey;
    }
  }, [screenKey]);

  // Don't let the override keep the user on early-init if the natural flow
  // has moved past it to borrow or loading (but DO allow it when screenKey
  // is phone-verify, because that's a valid manual back-navigation).
  const activeScreen = React.useMemo(() => {
    if (screenOverride === "early-init" && (screenKey === "borrow" || screenKey === "loading")) {
      return screenKey;
    }
    return screenOverride ?? screenKey;
  }, [screenOverride, screenKey]);

  const handleGoBack = React.useCallback(() => {
    if (activeScreen === "phone-verify") {
      // phone → email
      setScreenOverride("early-init");
    } else if (activeScreen === "early-init") {
      // email → terms
      setTermsAccepted(false);
      setScreenOverride(null);
    }
  }, [activeScreen, setTermsAccepted]);

  const handleGoForward = React.useCallback(() => {
    if (activeScreen === "early-init") {
      // email (already verified) → phone
      setScreenOverride(null); // let computed screenKey take over (phone-verify)
    }
  }, [activeScreen]);

  let view: React.ReactNode = null;

  switch (activeScreen) {
    case "loading":
      view = <SplashLoader label={splashLabel} />;
      break;

    case "not-logged-in":
      view = <NotLoggedIn setShowAuthFlow={setShowAuthFlow} />;
      break;

    case "error":
      view = <ErrorComponent error={error} />;
      break;

    case "terms":
      view = (
        <OnboardingWizard
          screen="terms"
          onGoBack={handleGoBack}
          onGoForward={handleGoForward}
          termsAccepted={termsAccepted}
          accepting={acceptingTerms}
          onAccept={handleAcceptTerms}
          journey={journey}
          email={email}
          setEmail={setEmail}
          otp={otp}
          setOtp={setOtp}
          otpSent={otpSent}
          sendingOtp={sendingOtp}
          handleSendOtp={handleSendOtp}
          workType={workType}
          setWorkType={setWorkType}
          verifying={verifying}
          verifyError={verifyError}
          handleEarlyAccessStart={handleEarlyAccessStart}
        />
      );
      break;

    case "early-phone":
      view = (
        <OnboardingWizard
          screen="phone-verify"
          onGoBack={handleGoBack}
          onGoForward={handleGoForward}
          termsAccepted={termsAccepted}
          accepting={acceptingTerms}
          onAccept={handleAcceptTerms}
          journey={journey}
          email={email}
          setEmail={setEmail}
          otp={otp}
          setOtp={setOtp}
          otpSent={otpSent}
          sendingOtp={sendingOtp}
          handleSendOtp={handleSendOtp}
          workType={workType}
          setWorkType={setWorkType}
          verifying={verifying}
          verifyError={verifyError}
          handleEarlyAccessStart={handleEarlyAccessStart}
          walletAddress={journey!.walletAddress}
          onPhoneVerified={handlePhoneVerifiedWithAnimation}
        />
      );
      break;

    case "early-survey":
      view = (
        <OnboardingWizard
          screen="work-type"
          onGoBack={handleGoBack}
          onGoForward={handleGoForward}
          termsAccepted={termsAccepted}
          accepting={acceptingTerms}
          onAccept={handleAcceptTerms}
          journey={journey}
          email={email}
          setEmail={setEmail}
          otp={otp}
          setOtp={setOtp}
          otpSent={otpSent}
          sendingOtp={sendingOtp}
          handleSendOtp={handleSendOtp}
          workType={workType}
          setWorkType={setWorkType}
          verifying={verifying}
          verifyError={verifyError}
          handleEarlyAccessStart={() => setSurveyConfirmed(true)}
        />
      );
      break;

    case "phone-verify": {
      const PhoneVerification = React.lazy(() => import("@/components/onboarding/PhoneVerification").then(m => ({ default: m.PhoneVerification })));
      view = (
        <React.Suspense fallback={<SplashLoader label={t("pages.borrow.loading.default")} />}>
          <PhoneVerification
            walletAddress={journey!.walletAddress}
            onVerified={handlePhoneVerifiedWithAnimation}
          />
        </React.Suspense>
      );
      break;
    }

    case "borrow":
      view = (
        <div className="container mx-auto w-full max-w-3xl">
          <CreditMarket setShowQR={setShowQR} userEmail={journey?.email} userPhoneVerified={phoneVerified} userPhoneMasked={journey?.phoneMasked} />
        </div>
      );
      break;

    case "waitlist":
      view = <OnWaitList journey={journey!} />;
      break;

    case "waitlist-flow":
      view = (
        <JoinWaitlist
          journey={journey!}
          email={email}
          setEmail={setEmail}
          joining={verifying}
          error={verifyError || error}
          otp={otp}
          setOtp={setOtp}
          otpSent={otpSent}
          sendingOtp={sendingOtp}
          handleWaitlistSendOtp={handleWaitlistSendOtp}
          handleWaitlistConfirm={handleWaitlistConfirm}
          workType={workType}
          setWorkType={setWorkType}
        />
      );
      break;

    case "early-self":
      view = <SelfVerificationFarcaster onVerified={handleSelfVerifiedAndInit} />;
      break;

    case "early-init":
      view = (
        <OnboardingWizard
          screen="early-init"
          onGoBack={handleGoBack}
          onGoForward={handleGoForward}
          termsAccepted={termsAccepted}
          accepting={acceptingTerms}
          onAccept={handleAcceptTerms}
          journey={journey}
          email={email}
          setEmail={setEmail}
          otp={otp}
          setOtp={setOtp}
          otpSent={otpSent}
          sendingOtp={sendingOtp}
          handleSendOtp={handleSendOtp}
          workType={workType}
          setWorkType={setWorkType}
          verifying={verifying}
          verifyingFromOtp={verifyingFromOtp}
          verifyError={verifyError}
          handleEarlyAccessStart={handleEarlyAccessStart}
        />
      );
      break;

    default:
      view = <NotAvailable />;
  }

  if (screenKey === "borrow") return view;
  return <SlidingScreens viewKey={screenKey}>{view}</SlidingScreens>;
}

export default function BorrowPage() {
  return (
    <div className="relative min-h-[calc(100dvh-4rem)]">
      <div className="relative z-10">
        <WebEnvironmentGuard>
          <BorrowPageInner />
        </WebEnvironmentGuard>
      </div>
    </div>
  );
}
