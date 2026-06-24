import { useState, useCallback, useRef, useEffect } from "react";
import { dedupeToast as toast } from "@/lib/dedupeToast";
import { useApi } from "@/hooks/useApi";
import { useTranslation } from "@/i18n/useTranslation";
import { AuthError } from "@/lib/api";

export type PhoneVerificationChannel = "whatsapp" | "sms";

export type PhoneVerificationState =
  | "idle"
  | "sending"
  | "otp_sent"
  | "verifying"
  | "verified"
  | "error";

type UsePhoneVerificationOptions = {
  onVerified?: () => void;
  /** If true, skip to OTP input screen (user already has a pending OTP from a previous session) */
  pendingOtp?: boolean;
};

const RESEND_COOLDOWN_SECONDS = 60;

export function usePhoneVerification({ onVerified, pendingOtp = false }: UsePhoneVerificationOptions = {}) {
  const { t } = useTranslation();
  const api = useApi();

  const [state, setState] = useState<PhoneVerificationState>(pendingOtp ? "otp_sent" : "idle");
  const [error, setError] = useState<string | null>(null);

  // OTP input value
  const [otp, setOtp] = useState("");

  // Countdown timer for resend
  const [resendSecondsLeft, setResendSecondsLeft] = useState(0);
  const resendTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // in-flight guards
  const sendInFlightRef = useRef(false);
  const verifyInFlightRef = useRef(false);
  // Track if OTP was sent at least once (survives "sending" state during resend)
  const otpSentOnceRef = useRef(false);

  // ── Cleanup timer on unmount ──
  useEffect(() => {
    return () => {
      if (resendTimerRef.current) clearInterval(resendTimerRef.current);
    };
  }, []);

  // ── Start the 60-second resend countdown ──
  const startResendCountdown = useCallback(() => {
    if (resendTimerRef.current) clearInterval(resendTimerRef.current);
    setResendSecondsLeft(RESEND_COOLDOWN_SECONDS);

    resendTimerRef.current = setInterval(() => {
      setResendSecondsLeft((prev) => {
        if (prev <= 1) {
          if (resendTimerRef.current) clearInterval(resendTimerRef.current);
          resendTimerRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  // ── Helper: parse a 409/429 as a "cooldown / already sent" case ──
  const isCooldownResponse = useCallback((status: number, bodyText: string): boolean => {
    if (![409, 429].includes(status)) return false;
    const lower = bodyText.toLowerCase();
    return (
      lower.includes("cooldown") ||
      lower.includes("already") ||
      lower.includes("too many") ||
      lower.includes("rate limit")
    );
  }, []);

  /**
   * verifyPhone — sends the OTP to the given phone number via the chosen channel.
   * POST /user/verify-phone
   */
  const verifyPhone = useCallback(
    async (
      walletAddress: string,
      phone: string,
      channel: PhoneVerificationChannel = "whatsapp",
    ): Promise<boolean> => {
      if (sendInFlightRef.current) return true;
      sendInFlightRef.current = true;

      setError(null);
      setState("sending");

      try {
        const { res, authFailed } = await api.rawAuthedPost("/user/verify-phone", {
          walletAddress,
          phone,
          channel,
        });

        if (authFailed) {
          const msg = t("hooks.usePhoneVerification.errors.sessionInvalid");
          setError(msg);
          toast.error(msg);
          setState("error");
          return false;
        }

        if (!res) {
          const msg = t("hooks.usePhoneVerification.errors.sendFailed");
          setError(msg);
          toast.error(t("hooks.usePhoneVerification.toast.sendFailedTitle"));
          setState("error");
          return false;
        }

        if (!res.ok) {
          const text = await res.text().catch(() => "");

          // Duplicate phone — check 409 FIRST (before cooldown, since cooldown also uses 409)
          if (res.status === 409) {
            const lower = text.toLowerCase();

            // Check for duplicate phone FIRST (more specific match)
            const isDuplicate =
              lower.includes("ya fue verificado") ||
              lower.includes("already verified") ||
              lower.includes("phone_duplicate") ||
              lower.includes("otro usuario");

            if (isDuplicate) {
              const msg = t("hooks.usePhoneVerification.errors.phoneDuplicate");
              setError(msg);
              setState("error");
              return false;
            }

            // Otherwise treat as cooldown / OTP already pending
            setState("otp_sent");
            startResendCountdown();
            toast.info(t("hooks.usePhoneVerification.toast.otpAlreadySent"));
            return true;
          }

          // 429 = rate limit
          if (isCooldownResponse(res.status, text)) {
            setState("otp_sent");
            startResendCountdown();
            toast.info(t("hooks.usePhoneVerification.toast.otpAlreadySent"));
            return true;
          }

          // Never render raw server text — use i18n keys to prevent social engineering
          const msg = t("hooks.usePhoneVerification.errors.sendHttpError", { status: res.status });
          setError(msg);
          toast.error(t("hooks.usePhoneVerification.toast.sendFailedTitle"));
          setState("error");
          return false;
        }

        setState("otp_sent");
        otpSentOnceRef.current = true;
        setOtp("");
        startResendCountdown();
        toast.success(t("hooks.usePhoneVerification.toast.otpSent"));
        return true;
      } catch (e: unknown) {
        if (e instanceof AuthError) {
          const msg = t("hooks.usePhoneVerification.errors.sessionInvalid");
          setError(msg);
          toast.error(msg);
        } else {
          const msg =
            e instanceof Error
              ? e.message
              : t("hooks.usePhoneVerification.errors.sendFailed");
          setError(msg);
          toast.error(t("hooks.usePhoneVerification.toast.sendFailedTitle"));
        }
        setState("error");
        return false;
      } finally {
        sendInFlightRef.current = false;
      }
    },
    [api, t, isCooldownResponse, startResendCountdown],
  );

  /**
   * verifyPhoneOtp — checks the OTP code the user entered.
   * POST /user/verify-phone-otp
   */
  const verifyPhoneOtp = useCallback(
    async (walletAddress: string, phone: string, code: string): Promise<boolean> => {
      if (verifyInFlightRef.current) return false;
      verifyInFlightRef.current = true;

      setError(null);
      setState("verifying");

      try {
        const { res, authFailed } = await api.rawAuthedPost("/user/verify-phone-otp", {
          walletAddress,
          phone,
          code: code.trim(),
        });

        if (authFailed) {
          const msg = t("hooks.usePhoneVerification.errors.sessionInvalid");
          setError(msg);
          toast.error(msg);
          setState("error");
          return false;
        }

        if (!res) {
          const msg = t("hooks.usePhoneVerification.errors.verifyFailed");
          setError(msg);
          toast.error(t("hooks.usePhoneVerification.toast.verifyFailedTitle"));
          setState("otp_sent");
          return false;
        }

        if (!res.ok) {
          const text = await res.text().catch(() => "");

          // 400 = invalid/expired code
          const msg =
            res.status === 400
              ? t("hooks.usePhoneVerification.errors.invalidCode")
              : text.trim() ||
                t("hooks.usePhoneVerification.errors.verifyHttpError", {
                  status: res.status,
                });

          setError(msg);
          setState("otp_sent");
          return false;
        }

        setState("verified");
        setError(null);
        if (resendTimerRef.current) clearInterval(resendTimerRef.current);
        setResendSecondsLeft(0);

        toast.success(t("hooks.usePhoneVerification.toast.verified"));
        onVerified?.();
        return true;
      } catch (e: unknown) {
        if (e instanceof AuthError) {
          const msg = t("hooks.usePhoneVerification.errors.sessionInvalid");
          setError(msg);
          toast.error(msg);
        } else {
          const msg =
            e instanceof Error
              ? e.message
              : t("hooks.usePhoneVerification.errors.verifyFailed");
          setError(msg);
          toast.error(t("hooks.usePhoneVerification.toast.verifyFailedTitle"));
        }
        setState("otp_sent");
        return false;
      } finally {
        verifyInFlightRef.current = false;
      }
    },
    [api, t, onVerified],
  );

  /**
   * resendPhoneOtp — re-sends OTP to same phone, respecting the cooldown.
   * POST /user/resend-phone-otp
   */
  const resendPhoneOtp = useCallback(
    async (
      walletAddress: string,
      phone: string,
      channel: PhoneVerificationChannel = "whatsapp",
    ): Promise<boolean> => {
      if (sendInFlightRef.current) return true;
      if (resendSecondsLeft > 0) {
        toast.info(
          t("hooks.usePhoneVerification.errors.resendCooldown", {
            seconds: resendSecondsLeft,
          }),
        );
        return false;
      }
      sendInFlightRef.current = true;

      setError(null);
      setState("sending");

      try {
        const { res, authFailed } = await api.rawAuthedPost("/user/resend-phone-otp", {
          walletAddress,
          phone,
          channel,
        });

        if (authFailed) {
          const msg = t("hooks.usePhoneVerification.errors.sessionInvalid");
          setError(msg);
          toast.error(msg);
          setState("otp_sent");
          return false;
        }

        if (!res) {
          const msg = t("hooks.usePhoneVerification.errors.resendFailed");
          setError(msg);
          setState("otp_sent");
          return false;
        }

        if (!res.ok) {
          const text = await res.text().catch(() => "");

          if (isCooldownResponse(res.status, text)) {
            setState("otp_sent");
            startResendCountdown();
            toast.info(t("hooks.usePhoneVerification.toast.otpAlreadySent"));
            return true;
          }

          if (res.status === 429) {
            const msg = t("hooks.usePhoneVerification.errors.rateLimit");
            setError(msg);
            setState("otp_sent");
            return false;
          }

          const msg =
            text.trim() ||
            t("hooks.usePhoneVerification.errors.resendHttpError", { status: res.status });
          setError(msg);
          setState("otp_sent");
          return false;
        }

        setState("otp_sent");
        setOtp("");
        startResendCountdown();
        toast.success(t("hooks.usePhoneVerification.toast.otpResent"));
        return true;
      } catch (e: unknown) {
        const msg =
          e instanceof Error
            ? e.message
            : t("hooks.usePhoneVerification.errors.resendFailed");
        setError(msg);
        setState("otp_sent");
        return false;
      } finally {
        sendInFlightRef.current = false;
      }
    },
    [api, t, isCooldownResponse, resendSecondsLeft, startResendCountdown],
  );

  const reset = useCallback(() => {
    setState("idle");
    setError(null);
    setOtp("");
    setResendSecondsLeft(0);
    otpSentOnceRef.current = false;
    if (resendTimerRef.current) clearInterval(resendTimerRef.current);
    resendTimerRef.current = null;
  }, []);

  return {
    state,
    error,
    otp,
    setOtp,
    resendSecondsLeft,
    canResend: resendSecondsLeft === 0 && state !== "sending",
    isOtpSent: state === "otp_sent" || state === "verifying" || state === "verified" || (state === "sending" && otpSentOnceRef.current),
    isVerified: state === "verified",
    isSending: state === "sending",
    isVerifying: state === "verifying",
    verifyPhone,
    verifyPhoneOtp,
    resendPhoneOtp,
    reset,
  };
}
