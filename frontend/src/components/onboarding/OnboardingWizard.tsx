// src/components/onboarding/OnboardingWizard.tsx
"use client";

import * as React from "react";
import * as ReactDOM from "react-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTranslation } from "@/i18n/useTranslation";
import { isValidEmail, suggestFixedEmail } from "@/lib/email-utils";
import { normalizeErrorMessage } from "@/lib/utils";
import { WORK_TYPE_OPTIONS } from "@/components/onboarding/WorkTypeStep";
import {
  usePhoneVerification,
  type PhoneVerificationChannel,
} from "@/hooks/onboarding/usePhoneVerification";
import TermsBody from "@/components/terms-and-conditions/TermsBody";
import PrivacyBody from "@/components/terms-and-conditions/PrivacyBody";
import type { WorkType } from "@shared/types/work-type";
import type { UserJourneyResponse } from "@shared/types/api";

// ── Types ─────────────────────────────────────────────────────────────────────

export type WizardScreen = "terms" | "early-init" | "phone-verify" | "work-type";

type CountryOption = {
  code: string;
  dialCode: string;
};

const COUNTRY_OPTIONS: CountryOption[] = [
  { code: "AR", dialCode: "+54" },
  { code: "BR", dialCode: "+55" },
  { code: "MX", dialCode: "+52" },
  { code: "CO", dialCode: "+57" },
  { code: "PE", dialCode: "+51" },
  { code: "CL", dialCode: "+56" },
  { code: "UY", dialCode: "+598" },
  { code: "EC", dialCode: "+593" },
  { code: "BO", dialCode: "+591" },
  { code: "PY", dialCode: "+595" },
];

const COUNTRY_LABEL_KEYS: Record<string, string> = {
  AR: "onboarding.phoneVerification.countries.AR",
  BR: "onboarding.phoneVerification.countries.BR",
  MX: "onboarding.phoneVerification.countries.MX",
  CO: "onboarding.phoneVerification.countries.CO",
  PE: "onboarding.phoneVerification.countries.PE",
  CL: "onboarding.phoneVerification.countries.CL",
  UY: "onboarding.phoneVerification.countries.UY",
  EC: "onboarding.phoneVerification.countries.EC",
  BO: "onboarding.phoneVerification.countries.BO",
  PY: "onboarding.phoneVerification.countries.PY",
};

function buildE164(dialCode: string, localNumber: string): string {
  const digits = localNumber.replace(/\D/g, "").replace(/^0/, "");
  return `${dialCode}${digits}`;
}

function isValidLocalNumber(localNumber: string): boolean {
  const digits = localNumber.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 12;
}

export type OnboardingWizardProps = {
  /** Which logical screen this wizard is being used for */
  screen: WizardScreen;

  // --- Terms ---
  termsAccepted: boolean;
  accepting: boolean;
  onAccept: () => void;

  // --- Early-init (email + OTP + work type) ---
  journey?: UserJourneyResponse | null;
  email: string;
  setEmail: (v: string) => void;
  otp: string;
  setOtp: (v: string) => void;
  otpSent: boolean;
  sendingOtp: boolean;
  handleSendOtp: () => Promise<boolean>;
  workType: WorkType | null;
  setWorkType: (v: WorkType | null) => void;
  verifying: boolean;
  /** True while handleEarlyAccessStart is processing after OTP confirmation.
   *  Keeps the wizard on the early-init screen instead of jumping to SplashLoader. */
  verifyingFromOtp?: boolean;
  verifyError: unknown;
  handleEarlyAccessStart: () => Promise<void> | void;

  // --- Navigation ---
  onGoBack?: () => void;
  onGoForward?: () => void;

  // --- Phone verify ---
  walletAddress?: string;
  onPhoneVerified?: () => void;
};

// ── Progress bar (segmented horizontal bars) ──────────────────────────────────

type SegmentStatus = "done" | "current" | "future";

type StepSegment = {
  status: SegmentStatus;
  label: string;
};

function ProgressBar({ segments }: { segments: StepSegment[] }) {
  return (
    <div
      className="flex items-center gap-1.5 mb-8"
      role="progressbar"
      aria-label="Progreso del onboarding"
    >
      {segments.map((seg, i) => (
        <div
          key={i}
          className={[
            "h-1 rounded-full flex-1 transition-colors duration-300",
            seg.status === "done" || seg.status === "current"
              ? "bg-primary"
              : "bg-border",
          ].join(" ")}
          aria-current={seg.status === "current" ? "step" : undefined}
        />
      ))}
    </div>
  );
}

// ── OTP visual display with single hidden input (WKWebView compatible) ────────

const OTP_LENGTH = 6;

// ── OTP verified checkmark SVG ────────────────────────────────────────────────
// Rendered inside each digit box when the OTP has been confirmed successfully.

function OtpCheckmark() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#fff"
      strokeWidth="2.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{
        animation: "otpCheckScale 220ms cubic-bezier(0.34, 1.56, 0.64, 1) both",
      }}
    >
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

// Keyframe injected once into the document head so we don't need an external CSS file.
// Guard against double-injection across HMR reloads.
if (typeof document !== "undefined" && !document.getElementById("otp-check-kf")) {
  const style = document.createElement("style");
  style.id = "otp-check-kf";
  style.textContent = `
    @keyframes otpCheckScale {
      0%   { transform: scale(0.4); opacity: 0; }
      60%  { transform: scale(1.15); opacity: 1; }
      100% { transform: scale(1);   opacity: 1; }
    }
    @keyframes otpBoxVerify {
      0%   { transform: scale(1); }
      40%  { transform: scale(0.88); }
      70%  { transform: scale(1.06); }
      100% { transform: scale(1); }
    }
    @keyframes workTypeDone {
      0%   { transform: scale(1); }
      30%  { transform: scale(0.95); }
      60%  { transform: scale(1.03); }
      100% { transform: scale(1); }
    }
  `;
  document.head.appendChild(style);
}

function OtpDigitInput({
  value,
  onChange,
  disabled,
  verified,
}: {
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
  /** When true all digit boxes animate into a brand-orange "verified" state */
  verified?: boolean;
}) {
  const hiddenRef = React.useRef<HTMLInputElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const clean = value.replace(/\D/g, "").slice(0, OTP_LENGTH);
  const activeIdx = clean.length < OTP_LENGTH ? clean.length : -1;

  const focusAndCursorEnd = () => {
    const el = hiddenRef.current;
    if (!el) return;
    el.focus();
    // Move cursor to end so backspace works on the last digit
    const len = el.value.length;
    el.setSelectionRange(len, len);
  };

  // Auto-focus on mount to open the keyboard immediately
  React.useEffect(() => {
    if (verified || disabled) return;
    const timer = setTimeout(() => focusAndCursorEnd(), 350);
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={containerRef}
      onClick={verified ? undefined : focusAndCursorEnd}
      style={{ position: "relative", width: "100%", cursor: verified ? "default" : "text" }}
    >
      {/* Hidden real input — not rendered when verified (keyboard already dismissed) */}
      {!verified && (
        <input
          ref={hiddenRef}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={OTP_LENGTH}
          value={clean}
          disabled={disabled}
          onFocus={() => {
            const el = hiddenRef.current;
            if (el) {
              const len = el.value.length;
              setTimeout(() => el.setSelectionRange(len, len), 0);
            }
            containerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
          }}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, OTP_LENGTH))}
          style={{
            position: "absolute",
            top: 0, left: 0,
            width: "100%", height: "100%",
            opacity: 0,
            fontSize: "16px",
            zIndex: 1,
          }}
        />
      )}
      <div style={{ display: "flex", gap: "10px", width: "100%" }}>
        {Array.from({ length: OTP_LENGTH }).map((_, i) => {
          const char = clean[i];
          const isFilled = char !== undefined;
          const isActive = !verified && activeIdx === i;

          // Stagger the verify animation slightly per box for a wave effect
          const verifyDelay = `${i * 45}ms`;

          return (
            <div
              key={i}
              style={{
                flex: 1,
                aspectRatio: "1",
                maxHeight: "56px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "14px",
                border: verified
                  ? "2px solid #22c55e"
                  : isActive
                    ? "2px solid #F97415"
                    : isFilled
                      ? "2px solid rgba(249,116,21,0.4)"
                      : "1.5px solid #d1d5db",
                backgroundColor: verified ? "#22c55e" : isFilled ? "#fff" : "#f9fafb",
                boxShadow: verified
                  ? "0 2px 8px rgba(34,197,94,0.35)"
                  : isActive
                    ? "0 0 0 3px rgba(249,116,21,0.1)"
                    : isFilled
                      ? "0 1px 2px rgba(0,0,0,0.04)"
                      : "none",
                fontSize: "22px",
                fontWeight: 700,
                color: "#1f2937",
                transition: verified
                  ? `background-color 180ms ${verifyDelay}, border-color 180ms ${verifyDelay}, box-shadow 180ms ${verifyDelay}`
                  : "border-color 150ms, box-shadow 150ms, background-color 150ms",
                animation: verified ? `otpBoxVerify 320ms ${verifyDelay} cubic-bezier(0.34, 1.56, 0.64, 1) both` : "none",
                opacity: (!verified && disabled) ? 0.4 : 1,
              }}
            >
              {verified ? <OtpCheckmark /> : (isFilled ? char : "")}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Phone resend link (used below OTP digit boxes in PhoneStep) ──────────────

function PhoneResendLink({
  canResend,
  resendSecondsLeft,
  handleResend,
}: {
  canResend: boolean;
  resendSecondsLeft: number;
  handleResend: (ch: PhoneVerificationChannel) => void;
}) {
  return (
    <p className="text-center mt-5 text-[13px] text-muted-foreground">
      {resendSecondsLeft > 0 ? (
        <>¿No recibiste el código? Reenviar en {resendSecondsLeft}s</>
      ) : (
        <>
          ¿No recibiste el código?{" "}
          <button
            type="button"
            disabled={!canResend}
            onClick={() => handleResend("whatsapp")}
            className="text-primary font-medium disabled:opacity-40 cursor-pointer px-1 py-2 -mx-1"
          >
            Reenviar
          </button>
        </>
      )}
    </p>
  );
}

// ── Primary CTA button ────────────────────────────────────────────────────────
// Wraps Button with the full-width, tall, orange, uppercase style described in the spec.

type CtaButtonProps = React.ComponentProps<"button"> & {
  loading?: boolean;
  loadingLabel?: string;
};

function CtaButton({ children, loading, loadingLabel, disabled, className = "", ...rest }: CtaButtonProps) {
  return (
    <Button
      type="button"
      size="xl"
      disabled={disabled || loading}
      className={[
        "w-full h-14 rounded-xl",
        "bg-primary text-primary-foreground",
        "hover:bg-primary/90 active:bg-primary/80",
        "font-semibold text-[15px] tracking-wider uppercase",
        "disabled:opacity-50",
        className,
      ].join(" ")}
      {...rest}
    >
      {loading ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {loadingLabel ?? "Cargando..."}
        </>
      ) : (
        children
      )}
    </Button>
  );
}

// ── Fixed bottom bar (portal to body) ─────────────────────────────────────────
// Renders a fixed bar at the bottom that animates with the keyboard.
// Portaled to document.body so no ancestor transform/overflow can break it.

function FixedBottomBar({
  keyboardHeight,
  isOpening,
  children,
}: {
  keyboardHeight: number;
  isOpening: boolean;
  children: React.ReactNode;
}) {
  return ReactDOM.createPortal(
    <div
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: keyboardHeight > 0
          ? `calc(${keyboardHeight}px + env(safe-area-inset-bottom, 10px) + 6px)`
          : "0px",
        padding: "8px 20px",
        paddingBottom: keyboardHeight > 0 ? "8px" : "calc(8px + env(safe-area-inset-bottom, 0px))",
        backgroundColor: "#fff",
        zIndex: 50,
        transition: isOpening
          ? "bottom 320ms cubic-bezier(0.33, 1, 0.68, 1)"
          : "bottom 280ms cubic-bezier(0.42, 0, 0.58, 1)",
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

// ── Error block ───────────────────────────────────────────────────────────────

function ErrorBlock({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="mt-4 flex items-start gap-2.5 rounded-xl bg-red-50/80 px-4 py-3 border border-red-200/60"
    >
      <p className="text-[12px] leading-snug text-red-700">{message}</p>
    </div>
  );
}

// ── Shared step header ────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function StepHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <>
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-2 mb-8 text-[15px] leading-relaxed text-muted-foreground">
        {subtitle}
      </p>
    </>
  );
}

// ── Input label ────────────────────────���──────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function InputLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[13px] text-muted-foreground mb-1.5">{children}</p>
  );
}

// ── Step 1: Terms & Conditions ────────────────────────────────────────────────

type TermsStepProps = {
  accepting: boolean;
  onAccept: () => void;
};

function TermsStep({ accepting, onAccept }: TermsStepProps) {
  // If user already read terms before (went to email and came back), start as read
  const [hasReadAll, setHasReadAll] = React.useState(!!(window as Record<string, unknown>).__termsReadAll);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const handleScroll = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 30) {
      setHasReadAll(true);
    }
  }, []);

  // If content doesn't need scroll, mark as read.
  // If user already read terms (came back from email), scroll to bottom.
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollHeight <= el.clientHeight + 30) {
      setHasReadAll(true);
    } else if ((window as Record<string, unknown>).__termsReadAll) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  return (
    <div className="flex flex-col flex-1">
      <p className="mb-4 text-[15px] leading-relaxed text-muted-foreground">
        Revisá y aceptá para continuar
      </p>

      {/* Scrollable T&C + Privacy content */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="
          flex-1 overflow-y-auto rounded-xl border border-border/50
          bg-muted/30 px-4 py-3
          text-xs leading-relaxed text-muted-foreground
          space-y-4
        "
        style={{ maxHeight: "calc(100vh - 260px)" }}
      >
        <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground/70">
          Términos y condiciones de uso
        </p>
        <TermsBody />
        <div className="border-t border-border/40 pt-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground/70 mb-3">
            Política de privacidad
          </p>
          <PrivacyBody />
        </div>
      </div>

      {/* Spacer for fixed button */}
      <div className="h-20" />

      {/* Expose hasReadAll to parent via a hidden callback */}
      <TermsReadGate hasReadAll={hasReadAll} onAccept={onAccept} accepting={accepting} />
    </div>
  );
}

/** Replaces the FixedBottomBar button for terms — only enabled after scrolling to bottom */
 
function TermsReadGate({ hasReadAll, onAccept: _onAccept, accepting: _accepting }: { hasReadAll: boolean; onAccept: () => void; accepting?: boolean }) {
  // This renders nothing — the actual button is in the parent OnboardingWizard via FixedBottomBar.
  // We need to intercept that. Since we can't easily, we'll use a portal approach.
  // Actually, let's just set a ref that the parent reads... but that's complex.
  // Simplest: expose via a global.
  React.useEffect(() => {
    (window as Record<string, unknown>).__termsReadAll = hasReadAll;
  }, [hasReadAll]);
  return null;
}

// ── Step 2: Email ─────────────────────────────────────────────────────────────

type EmailStepProps = {
  journey: UserJourneyResponse | null | undefined;
  email: string;
  setEmail: (v: string) => void;
  otp: string;
  setOtp: (v: string) => void;
  otpSent: boolean;
  sendingOtp: boolean;
  handleSendOtp: () => Promise<boolean>;
  verifying: boolean;
  /** True while the backend OTP+verify call is in-flight after the success flash.
   *  Keeps the "Email verificado" UI visible instead of reverting to the email form. */
  verifyingFromOtp?: boolean;
  verifyError: unknown;
  onOtpConfirmed: () => void;
};

function EmailStep({
  journey,
  email,
  setEmail,
  otp,
  setOtp,
  otpSent,
  sendingOtp,
  handleSendOtp,
  verifying,
  verifyingFromOtp = false,
  verifyError,
  onOtpConfirmed,
}: EmailStepProps) {
  const { t } = useTranslation();
  const { keyboardHeight, isOpening } = useKeyboardAvoidance();
  const [emailError, setEmailError] = React.useState<string | null>(null);
  const [emailSuggestion, setEmailSuggestion] = React.useState<string | null>(null);
  // Drives the "verified" flash on the OTP boxes before auto-advancing
  const [otpVerifiedFlash, setOtpVerifiedFlash] = React.useState(false);

  // Show success flash only after OTP was accepted by the backend.
  // The hook clears otpSent (sets it false) only on a successful OTP response.
  // So: if we were in otpSent=true and it flips to false while verifyingFromOtp
  // is still true AND there's no error, the OTP was accepted.
  const prevOtpSent = React.useRef(otpSent);
  React.useEffect(() => {
    if (prevOtpSent.current && !otpSent && verifyingFromOtp && !verifyError) {
      setOtpVerifiedFlash(true);
    }
    if (verifyError) {
      setOtpVerifiedFlash(false);
    }
    prevOtpSent.current = otpSent;
  }, [otpSent, verifyingFromOtp, verifyError]);

  // OTP expiration countdown
  const [otpSecondsLeft, setOtpSecondsLeft] = React.useState<number | null>(null);

  React.useEffect(() => {
    const expiresAt = journey?.otpExpiresAt;
    if (!otpSent || !expiresAt) { setOtpSecondsLeft(null); return; }
    const target = new Date(expiresAt).getTime();
    const tick = () => {
      const diff = Math.max(0, Math.ceil((target - Date.now()) / 1000));
      setOtpSecondsLeft(diff);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [otpSent, journey?.otpExpiresAt]);

  const hasEmailFromBackend = !!journey?.email;
  const backendError = normalizeErrorMessage(verifyError);
  // Suppress the backend error while the success flash is showing
  const errorMessage = otpVerifiedFlash ? null : (emailError || backendError);

  const handleAcceptSuggestion = () => {
    if (!emailSuggestion) return;
    setEmail(emailSuggestion);
    setEmailSuggestion(null);
  };

  const handleEmailSend = async () => {
    if (!isValidEmail(email)) {
      setEmailError(t("onboarding.initAccount.email.invalid"));
      return;
    }

    const { email: fixed, changed } = suggestFixedEmail(email);
    if (changed && fixed !== email) {
      if (!emailSuggestion || emailSuggestion !== fixed) {
        setEmailSuggestion(fixed);
        return;
      }
    }

    setEmailError(null);
    setEmailSuggestion(null);

    await handleSendOtp();
  };

  const autoSubmittedOtpRef = React.useRef<string | null>(null);

  const handleOtpSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!otp.trim() || otp.trim().length !== 6) return;
    onOtpConfirmed();
  };

  // Auto-submit when all 6 digits are entered
  React.useEffect(() => {
    const normalizedOtp = otp.trim();

    if (normalizedOtp.length < 6) {
      autoSubmittedOtpRef.current = null;
      return;
    }

    if (
      normalizedOtp.length === 6 &&
      !verifying &&
      !otpVerifiedFlash &&
      !verifyError &&
      autoSubmittedOtpRef.current !== normalizedOtp
    ) {
      autoSubmittedOtpRef.current = normalizedOtp;
      handleOtpSubmit();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otp, verifying, otpVerifiedFlash, verifyError]);

  return (
    <div>
      {!otpSent && !verifyingFromOtp && (
        <p className="mb-6 text-[15px] leading-relaxed text-muted-foreground">
          {hasEmailFromBackend
            ? t("onboarding.initAccount.email.helperWithExisting")
            : "Necesitamos tu email para enviarte un código de verificación"}
        </p>
      )}

      {/* Email input — hidden once OTP is sent or backend call is in-flight */}
      {!otpSent && !verifyingFromOtp && (
      <div>
        <Input
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="nombre@ejemplo.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (emailError) setEmailError(null);
            if (emailSuggestion) setEmailSuggestion(null);
          }}
          className="rounded-xl py-3.5 text-base mb-4"
          disabled={verifying || sendingOtp || otpSent}
        />

        {emailSuggestion && (
          <p className="text-[13px] leading-snug text-muted-foreground mb-3">
            {t("onboarding.initAccount.email.suggestionPrefix")}{" "}
            <button
              type="button"
              onClick={handleAcceptSuggestion}
              className="font-medium underline underline-offset-2 cursor-pointer"
            >
              {emailSuggestion}
            </button>
            ?
          </p>
        )}

        {/* Spacer for fixed button */}
        <div className="h-24" />
      </div>
      )}

      {/* Fixed bottom Continuar for email input — portal */}
      {!otpSent && !verifyingFromOtp && (
        <FixedBottomBar keyboardHeight={keyboardHeight} isOpening={isOpening}>
          <CtaButton
            onClick={handleEmailSend}
            disabled={!email.trim()}
            loading={sendingOtp || verifying}
            loadingLabel={t("onboarding.initAccount.cta.sending")}
          >
            Continuar
          </CtaButton>
        </FixedBottomBar>
      )}

      {/* OTP section — also shown while verifyingFromOtp to preserve "Email verificado" UI */}
      {(otpSent || verifyingFromOtp) && (
        <div aria-live="polite">
          {/* Sender hint — hidden during success flash to focus attention on boxes */}
          {!otpVerifiedFlash && (
            <p className="text-[14px] leading-relaxed text-muted-foreground mb-2">
              Código enviado a{" "}
              <span className="font-medium text-foreground">{email}</span>
            </p>
          )}

          <OtpDigitInput
            value={otp}
            onChange={setOtp}
            disabled={verifying || otpVerifiedFlash}
            verified={otpVerifiedFlash}
          />

          {/* Success label — appears only during the verified flash */}
          {otpVerifiedFlash && (
            <p
              className="text-center mt-4 text-[15px] font-semibold"
              style={{
                color: "#22c55e",
                animation: "otpCheckScale 280ms cubic-bezier(0.34, 1.56, 0.64, 1) both",
              }}
            >
              Email verificado
            </p>
          )}

          {/* Resend link + countdown — hidden during success flash */}
          {!otpVerifiedFlash && (
            <div className="text-center mt-5 space-y-1.5">
              <p className="text-[13px] text-muted-foreground">
                ¿No recibiste el código?{" "}
                <button
                  type="button"
                  onClick={() => handleSendOtp()}
                  disabled={sendingOtp}
                  className="text-primary font-medium disabled:opacity-40 cursor-pointer"
                >
                  Reenviar
                </button>
              </p>
              {otpSecondsLeft !== null && otpSecondsLeft > 0 && (
                <p className="text-[11px] text-muted-foreground/70 tabular-nums">
                  {Math.floor(otpSecondsLeft / 60)}:{String(otpSecondsLeft % 60).padStart(2, "0")}
                </p>
              )}
              {otpSecondsLeft !== null && otpSecondsLeft <= 0 && (
                <p className="text-[11px] text-red-500">
                  Código expirado
                </p>
              )}
            </div>
          )}

          {/* Error message — right below OTP input */}
          {errorMessage && <ErrorBlock message={errorMessage} />}

          {/* Spacer for fixed button */}
          <div className="h-24" />
        </div>
      )}

      {/* Fixed bottom CONFIRMAR for email OTP — portal.
          Hidden during the success flash so the CTA area is clean. */}
      {otpSent && !otpVerifiedFlash && (
        <FixedBottomBar keyboardHeight={keyboardHeight} isOpening={isOpening}>
          <form onSubmit={handleOtpSubmit}>
            <CtaButton
              type="submit"
              loading={verifying}
              disabled={otp.replace(/\s/g, "").length < OTP_LENGTH}
              loadingLabel={t("onboarding.initAccount.step3.button.loading")}
            >
              Confirmar
            </CtaButton>
          </form>
        </FixedBottomBar>
      )}
    </div>
  );
}

// ── Step 3: Work type ─────────────────────────────────────────────────────────

type WorkTypeStepProps = {
  workType: WorkType | null;
  setWorkType: (v: WorkType | null) => void;
  verifying: boolean;
  verifyError: unknown;
  onSubmit: () => Promise<void> | void;
};

import { Car, Bike, Video, Monitor, Briefcase, Home as HomeIcon } from "lucide-react";

const WORK_TYPE_ICONS: Record<string, React.ElementType> = {
  app_driver: Car,
  app_delivery: Bike,
  creator: Video,
  freelance_cripto: Monitor,
  other_job: Briefcase,
  no_job: HomeIcon,
};

function WorkTypeStep({
  workType,
  setWorkType,
  verifying,
  verifyError,
  onSubmit,
}: WorkTypeStepProps) {
  const { t } = useTranslation();
  const backendError = normalizeErrorMessage(verifyError);

  return (
    <div className="flex flex-col flex-1">
      <p className="mb-6 text-[15px] leading-relaxed text-muted-foreground">
        {t("onboarding.workType.body")}
      </p>

      <div className="grid grid-cols-2 gap-3">
        {WORK_TYPE_OPTIONS.map((opt) => {
          const isSelected = workType === opt.value;
          const Icon = WORK_TYPE_ICONS[opt.value] ?? Briefcase;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setWorkType(opt.value as WorkType)}
              disabled={verifying}
              className={`
                flex flex-col items-center justify-center gap-2 rounded-xl py-5 px-3
                transition-all duration-200 active:scale-[0.97]
                ${isSelected
                  ? "border-2 border-primary bg-primary/5 shadow-sm"
                  : "border border-border/60 bg-background hover:border-primary/30"}
              `}
            >
              <Icon
                className="h-6 w-6"
                strokeWidth={1.5}
                style={{ color: isSelected ? "#F97415" : "#9ca3af" }}
              />
              <span className={`text-[13px] font-medium text-center leading-tight ${isSelected ? "text-primary" : "text-foreground"}`}>
                {t(opt.labelKey)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Spacer for fixed button */}
      <div className="h-20" />

      {/* Button pinned to bottom of viewport via inline style */}
      {ReactDOM.createPortal(
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, padding: "8px 20px 12px", backgroundColor: "#fff", zIndex: 9999 }}>
          <button
            type="button"
            onClick={() => { if (workType) onSubmit(); }}
            disabled={!workType || verifying}
            className="w-full h-14 rounded-xl bg-primary text-primary-foreground font-semibold text-[15px] tracking-wider uppercase hover:bg-primary/90 active:scale-[0.98] transition-all disabled:opacity-50"
          >
            {verifying ? t("onboarding.initAccount.step3.button.loading") : "Continuar"}
          </button>
        </div>,
        document.body,
      )}

      {backendError && <ErrorBlock message={backendError} />}
    </div>
  );
}

// ── Step 4: Phone verification ────────────────────────────────────────────────

type PhoneStepProps = {
  walletAddress: string;
  onVerified: () => void;
};

export function PhoneStep({ walletAddress, onVerified }: PhoneStepProps) {
  const { t } = useTranslation();
  const { keyboardHeight, isOpening } = useKeyboardAvoidance();

  const [selectedCountry, setSelectedCountry] = React.useState<CountryOption>(COUNTRY_OPTIONS[0]);
  const [localNumber, setLocalNumber] = React.useState("");
  const [phoneError, setPhoneError] = React.useState<string | null>(null);
  const [showCountryDropdown, setShowCountryDropdown] = React.useState(false);

  const frozenPhoneRef = React.useRef<string | null>(null);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  const {
    error: hookError,
    otp,
    setOtp,
    resendSecondsLeft,
    canResend,
    isOtpSent,
    isVerified,
    isSending,
    isVerifying,
    verifyPhone,
    verifyPhoneOtp,
    resendPhoneOtp,
  } = usePhoneVerification({ onVerified });

  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowCountryDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, []);

  const handleSendOtp = async (channel: PhoneVerificationChannel) => {
    setPhoneError(null);
    if (!isValidLocalNumber(localNumber)) {
      setPhoneError(t("onboarding.phoneVerification.errors.invalidNumber"));
      return;
    }
    const phone = buildE164(selectedCountry.dialCode, localNumber);
    if (!/^\+[1-9]\d{6,14}$/.test(phone)) {
      setPhoneError(t("onboarding.phoneVerification.errors.invalidNumber"));
      return;
    }
    frozenPhoneRef.current = phone;
    await verifyPhone(walletAddress, phone, channel);
  };

  const handleVerifyOtp = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!otp.trim() || otp.trim().length !== 6) return;
    const phone = frozenPhoneRef.current ?? buildE164(selectedCountry.dialCode, localNumber);
    await verifyPhoneOtp(walletAddress, phone, otp);
  };

  // Auto-submit when all 6 digits are entered
  const phoneAutoSubmitRef = React.useRef(false);
  React.useEffect(() => {
    if (otp.trim().length === 6 && !isVerifying && !phoneAutoSubmitRef.current) {
      phoneAutoSubmitRef.current = true;
      handleVerifyOtp();
    }
    if (otp.trim().length < 6) {
      phoneAutoSubmitRef.current = false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otp, isVerifying]);

  const handleResend = async (channel: PhoneVerificationChannel) => {
    if (!canResend) return;
    const phone = frozenPhoneRef.current ?? buildE164(selectedCountry.dialCode, localNumber);
    await resendPhoneOtp(walletAddress, phone, channel);
  };

  const isLoading = isSending || isVerifying;
  const displayError = phoneError ?? hookError ?? null;

  return (
    <div>
      {/* Phone input phase */}
      {!isOtpSent && (
      <div>
        <p className="mb-6 text-[15px] leading-relaxed text-muted-foreground">
          Te enviaremos un código por WhatsApp para verificar tu número
        </p>

        <div className="mb-4">
          <div className="flex gap-2">
            {/* Country selector */}
            <div className="relative shrink-0" ref={dropdownRef}>
              <button
                type="button"
                onClick={() => setShowCountryDropdown((v) => !v)}
                disabled={isLoading}
                className="
                  flex h-[50px] items-center gap-1.5 rounded-xl border border-input
                  bg-background px-3 text-[15px] font-medium
                  hover:bg-accent/10 hover:border-primary/40
                  focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0
                  disabled:opacity-50 transition-colors
                "
                aria-label={t("onboarding.phoneVerification.input.countryAriaLabel")}
              >
                <span>{selectedCountry.dialCode}</span>
                <svg
                  className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${showCountryDropdown ? "rotate-180" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {showCountryDropdown && (
                <>
                  {/* Backdrop to close on tap outside */}
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowCountryDropdown(false)}
                    onTouchStart={() => setShowCountryDropdown(false)}
                  />
                  <div className="
                    absolute left-0 top-full z-50 mt-1 min-w-[180px]
                    rounded-xl border border-border bg-popover shadow-lg
                  ">
                    {COUNTRY_OPTIONS.map((c) => (
                      <button
                        key={c.code}
                        type="button"
                        onClick={() => {
                          setSelectedCountry(c);
                          setShowCountryDropdown(false);
                        }}
                        className={`
                          flex w-full items-center gap-2.5 px-4 py-3
                          text-[15px] text-left
                          transition-colors
                          first:rounded-t-xl last:rounded-b-xl
                          ${selectedCountry.code === c.code
                            ? "bg-primary/5 font-medium text-primary"
                            : "hover:bg-muted/50"}
                        `}
                      >
                        <span className="mono-text text-[14px] text-muted-foreground w-10 shrink-0">
                          {c.dialCode}
                        </span>
                        <span>{t(COUNTRY_LABEL_KEYS[c.code])}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            <Input
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              placeholder={t("onboarding.phoneVerification.input.numberPlaceholder")}
              value={localNumber}
              onChange={(e) => {
                setLocalNumber(e.target.value);
                if (phoneError) setPhoneError(null);
              }}
              disabled={isLoading}
              className="rounded-xl py-3.5 text-base flex-1 h-[50px]"
            />
          </div>
        </div>

        {/* Spacer for fixed button */}
        <div className="h-24" />
      </div>
      )}

      {/* Fixed bottom button for phone input — portal */}
      {!isOtpSent && (
        <FixedBottomBar keyboardHeight={keyboardHeight} isOpening={isOpening}>
          <CtaButton
            disabled={!isValidLocalNumber(localNumber)}
            loading={isSending}
            loadingLabel={t("onboarding.phoneVerification.cta.sending")}
            onClick={() => handleSendOtp("whatsapp")}
          >
            Continuar
          </CtaButton>
        </FixedBottomBar>
      )}

      {/* OTP phase — no overflow-hidden to avoid WKWebView paint issues */}
      {isOtpSent && (
        <div aria-live="polite">
          {/* Sender hint — hidden once the OTP boxes show the verified flash */}
          {!isVerified && (
            <p className="mb-5 text-[14px] leading-relaxed text-muted-foreground">
              Código enviado al{" "}
              <span className="font-semibold text-foreground">
                {selectedCountry.dialCode} {localNumber}
              </span>
            </p>
          )}

          {/* OTP digit boxes — show verified flash when phone is confirmed */}
          <OtpDigitInput
            value={otp}
            onChange={setOtp}
            disabled={isVerifying || isVerified}
            verified={isVerified}
          />

          {/* Success label — appears once the phone OTP is confirmed */}
          {isVerified && (
            <p
              className="text-center mt-4 text-[15px] font-semibold"
              style={{
                color: "#22c55e",
                animation: "otpCheckScale 280ms cubic-bezier(0.34, 1.56, 0.64, 1) both",
              }}
            >
              {t("onboarding.phoneVerification.step2.verifiedMessage")}
            </p>
          )}

          {/* Resend link — hidden once verified */}
          {!isVerified && (
            <PhoneResendLink
              canResend={canResend}
              resendSecondsLeft={resendSecondsLeft}
              handleResend={handleResend}
            />
          )}

          {/* Spacer for fixed button */}
          <div className="h-24" />
        </div>
      )}

      {displayError && !isVerified && <ErrorBlock message={displayError} />}

      {/* Fixed bottom CONFIRMAR for OTP — portal, same level as CONTINUAR */}
      {isOtpSent && !isVerified && (
        <FixedBottomBar keyboardHeight={keyboardHeight} isOpening={isOpening}>
          <form onSubmit={handleVerifyOtp}>
            <CtaButton
              type="submit"
              loading={isVerifying}
              disabled={otp.replace(/\s/g, "").length < OTP_LENGTH}
              loadingLabel="Confirmando..."
            >
              Confirmar
            </CtaButton>
          </form>
        </FixedBottomBar>
      )}
    </div>
  );
}

// ── Progress segment builder ───────────────────────────────────────────────────

 
function buildSegments(screen: WizardScreen, _internalStep: number): StepSegment[] {
  if (screen === "terms") {
    return [
      { status: "current", label: "Términos" },
      { status: "future", label: "Email" },
      { status: "future", label: "Teléfono" },
      { status: "future", label: "Perfil" },
    ];
  }

  if (screen === "early-init") {
    return [
      { status: "done", label: "Términos" },
      { status: "current", label: "Email" },
      { status: "future", label: "Teléfono" },
      { status: "future", label: "Perfil" },
    ];
  }

  if (screen === "phone-verify") {
    return [
      { status: "done", label: "Términos" },
      { status: "done", label: "Email" },
      { status: "current", label: "Teléfono" },
      { status: "future", label: "Perfil" },
    ];
  }

  // work-type
  return [
    { status: "done", label: "Términos" },
    { status: "done", label: "Email" },
    { status: "done", label: "Teléfono" },
    { status: "current", label: "Perfil" },
  ];
}

// ── visualViewport keyboard-avoidance hook ────────────────────────────────────
// WKWebView exposes window.visualViewport. When the software keyboard opens, the
// visual viewport height shrinks. We compute the gap between the layout viewport
// height and the visual viewport height and use it as bottom padding on the
// scroll container, which pushes the CTA button above the keyboard.
//
// We deliberately do NOT use `position:sticky` here because the outer container
// uses `min-h` (not a fixed height), so there is no bounded scroll ancestor for
// sticky to anchor against — it would silently fall through to static positioning.

// eslint-disable-next-line react-refresh/only-export-components
export function useKeyboardAvoidance() {
  // Single state object so keyboardHeight and isOpening always update atomically.
  // visualViewport events fire outside React's synthetic event system, so two
  // separate setState calls would flush in two renders and cause the component
  // to briefly see the new isOpening with the stale keyboardHeight (or vice-versa).
  const [state, setState] = React.useState({ keyboardHeight: 0, isOpening: false });
  const prevHeight = React.useRef(0);

  React.useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      const gap = window.innerHeight - (vv.height + vv.offsetTop);
      const h = gap > 0 ? gap : 0;
      const opening = h > prevHeight.current;
      prevHeight.current = h;
      setState({ keyboardHeight: h, isOpening: opening });
    };

    // Safety: reset when focus leaves all inputs (keyboard should be closed)
    const onBlur = () => {
      setTimeout(() => {
        if (!document.activeElement || document.activeElement === document.body) {
          prevHeight.current = 0;
          setState({ keyboardHeight: 0, isOpening: false });
        }
      }, 300);
    };

    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    document.addEventListener("focusout", onBlur);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      document.removeEventListener("focusout", onBlur);
    };
  }, []);

  return state;
}

// ── Terms accept button — reads scroll state from TermsStep ──────────────────

function TermsAcceptButton({ onAccept, accepting }: { onAccept: () => void; accepting?: boolean }) {
  return (
    <CtaButton
      onClick={onAccept}
      loading={accepting}
      loadingLabel="Aceptando..."
    >
      Aceptar y continuar
    </CtaButton>
  );
}

// ── Wizard shell ──────────────────────────────────────────────────────────────

export function OnboardingWizard({
  screen,
  termsAccepted: _termsAccepted,  
  accepting,
  onAccept,
  journey,
  email,
  setEmail,
  otp,
  setOtp,
  otpSent,
  sendingOtp,
  handleSendOtp,
  workType,
  setWorkType,
  verifying,
  verifyingFromOtp = false,
  verifyError,
  handleEarlyAccessStart,
  onGoBack,
  onGoForward,
  walletAddress,
  onPhoneVerified,
}: OnboardingWizardProps) {
  const { keyboardHeight, isOpening } = useKeyboardAvoidance();

  // For early-init, track whether we're in the email/otp phase (0) or work type phase (1).
  // This is purely visual — the underlying hook still controls otpSent.
  const [earlySubStep, setEarlySubStep] = React.useState<0 | 1>(0);

  // When otpSent goes false again (back from otp), revert visual sub-step.
  // Do NOT reset while verifyingFromOtp — the backend call is still in-flight.
  React.useEffect(() => {
    if (!otpSent && !verifyingFromOtp) setEarlySubStep(0);
  }, [otpSent, verifyingFromOtp]);

  const segments = buildSegments(screen, earlySubStep);

  // When email OTP is confirmed, verify the code with the backend.
  // Account initialization happens later (after phone verification).
  const handleOtpConfirmed = () => {
    handleEarlyAccessStart?.();
  };

  // Derive the current step title
  const stepTitle = React.useMemo(() => {
    if (screen === "terms") return "Términos y condiciones";
    if (screen === "early-init") return "Verificá tu email";
    if (screen === "phone-verify") return "Verificá tu teléfono";
    if (screen === "work-type") return "Una última cosa";
    return "";
  }, [screen]);

  const renderContent = () => {
    if (screen === "terms") {
      return <TermsStep accepting={accepting} onAccept={onAccept} />;
    }

    if (screen === "early-init") {
      return (
        <EmailStep
          journey={journey}
          email={email}
          setEmail={setEmail}
          otp={otp}
          setOtp={setOtp}
          otpSent={otpSent}
          sendingOtp={sendingOtp}
          handleSendOtp={handleSendOtp}
          verifying={verifying}
          verifyingFromOtp={verifyingFromOtp}
          verifyError={verifyError}
          onOtpConfirmed={handleOtpConfirmed}
        />
      );
    }

    // phone-verify
    if (screen === "work-type") {
      return (
        <WorkTypeStep
          workType={workType}
          setWorkType={setWorkType}
          verifying={verifying}
          verifyError={verifyError}
          onSubmit={handleEarlyAccessStart}
        />
      );
    }

    if (!walletAddress || !onPhoneVerified) return null;
    return <PhoneStep walletAddress={walletAddress} onVerified={onPhoneVerified} />;
  };

  return (
    // bg-background is opaque white — covers the global GridBackground from App.tsx
    <div className="relative min-h-[calc(100vh-4rem)] flex flex-col bg-background overflow-x-hidden">
      <div className="flex flex-col flex-1 max-w-lg mx-auto w-full">
        {/* Header (title + progress) — sticky, never scrolls away */}
        <div className="shrink-0 pt-8 px-5">
          <div className="flex items-center gap-3 mb-4">
            {onGoBack && screen !== "terms" && screen !== "work-type" && (
              <button
                type="button"
                onClick={onGoBack}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted hover:bg-muted/80 transition-colors"
                aria-label="Volver"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
              </button>
            )}
            <h1 key={stepTitle} className="text-2xl font-bold flex-1">
              {stepTitle}
            </h1>
            {onGoForward && screen === "early-init" && journey?.email && !journey?.requiresWaitlistOtp && (
              <button
                type="button"
                onClick={onGoForward}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 hover:bg-primary/20 transition-colors"
                aria-label="Siguiente"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary"><path d="m9 18 6-6-6-6"/></svg>
              </button>
            )}
          </div>
          <ProgressBar segments={segments} />
        </div>

        {/* Scrollable step content */}
        <div
          className="flex-1 flex flex-col px-5 mt-1"
          style={{
            overflowY: "auto",
            paddingBottom: keyboardHeight > 0 ? `${keyboardHeight + 16}px` : "16px",
            transition: isOpening
              ? "padding-bottom 320ms cubic-bezier(0.33, 1, 0.68, 1)"
              : "padding-bottom 280ms cubic-bezier(0.42, 0, 0.58, 1)",
          }}
        >
          <div key={`${screen}-${earlySubStep}`} className="flex flex-col flex-1 min-h-0">
            {renderContent()}
          </div>
        </div>
      </div>

      {/* Fixed bottom button for T&C — enabled only after reading all */}
      {screen === "terms" && (
        <FixedBottomBar keyboardHeight={0} isOpening={false}>
          <TermsAcceptButton onAccept={onAccept!} accepting={accepting} />
        </FixedBottomBar>
      )}
    </div>
  );
}
