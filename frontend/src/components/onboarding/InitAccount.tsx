"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { normalizeErrorMessage } from "@/lib/utils";
import { isValidEmail, suggestFixedEmail } from "@/lib/email-utils";
import { OtpStep } from "@/components/onboarding/OtpStep";
import { WorkTypeStep } from "@/components/onboarding/WorkTypeStep";
import { useTranslation } from "@/i18n/useTranslation";
import type { WorkType } from "@shared/types/work-type";
import type { UserJourneyResponse } from "@shared/types/api";
import { GridBackground } from "@/components/common/GridBackground";

type InitAccountProps = {
  journey: UserJourneyResponse | null;

  // ✅ controlado desde BorrowPage
  step: 1 | 2 | 3;
  setStep: (s: 1 | 2 | 3) => void;

  handleEarlyAccessStart: () => Promise<void> | void;

  verifying: boolean;
  verifyError: unknown;

  otp: string;
  setOtp: (v: string) => void;

  email: string;
  setEmail: (v: string) => void;

  otpSent: boolean;
  handleSendOtp: () => Promise<boolean>;
  sendingOtp: boolean;

  workType: WorkType | null;
  setWorkType: (v: WorkType | null) => void;
};

export default function InitAccount({
  journey,
  step,
  setStep,
  handleEarlyAccessStart,
  verifying,
  verifyError,
  otp,
  setOtp,
  email,
  setEmail,
  otpSent,
  handleSendOtp,
  sendingOtp,
  workType,
  setWorkType,
}: InitAccountProps) {
  const { t } = useTranslation();

  const hasEmailFromBackend = !!journey?.email;

  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSuggestion, setEmailSuggestion] = useState<string | null>(null);

  const backendError = normalizeErrorMessage(verifyError);
  const errorMessage = emailError || backendError;

  const sliderTransform =
    step === 1
      ? "translateX(0%)"
      : step === 2
        ? "translateX(-33.3333%)"
        : "translateX(-66.6667%)";

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

    const ok = await handleSendOtp();

    // ✅ Avanzamos el paso desde acá (controlado), no adentro del componente
    if (ok) setStep(2);
  };

  return (
    <div className="relative overflow-hidden flex min-h-[calc(100vh-4rem)] items-start justify-center bg-background px-4 pt-8 pb-6">
      <GridBackground />
      <Card className="relative w-full max-w-md rounded-2xl border-2 border-border/50 bg-card/90 backdrop-blur-sm p-5 sm:p-6 shadow-md">
        {/* HEADER */}
        <div className="mb-3 flex items-center justify-between">
          <span className="mono-text text-[11px] tracking-[0.18em] text-muted-foreground">
            {t("onboarding.initAccount.badge")}
          </span>
        </div>

        {/* SLIDER */}
        <div className="relative overflow-hidden">
          <div
            className="flex w-[300%] transform-gpu transition-transform duration-500 ease-in-out"
            style={{ transform: sliderTransform }}
          >
            {/* STEP 1 - EMAIL */}
            <div className="w-1/3 shrink-0 pr-3">
              <h1 className="mb-3 text-2xl font-semibold sm:text-3xl">
                {t("onboarding.initAccount.step1.title")}
              </h1>

              <p className="mb-2 text-[15px] leading-relaxed text-muted-foreground">
                {t("onboarding.initAccount.step1.body1", {
                  limit: journey?.waitlistLimit,
                })}
              </p>

              <p className="mb-2 text-[15px] leading-relaxed text-muted-foreground">
                {t("onboarding.initAccount.step1.body2")}
              </p>

              <div className="mt-4 mb-4">
                <Input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder={t("onboarding.initAccount.email.placeholder")}
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (emailError) setEmailError(null);
                    if (emailSuggestion) setEmailSuggestion(null);
                  }}
                  className="rounded-xl py-3.5 text-[15px]"
                  disabled={verifying || sendingOtp}
                />

                <p className="mt-2 text-[12px] leading-snug text-muted-foreground">
                  {hasEmailFromBackend
                    ? t("onboarding.initAccount.email.helperWithExisting")
                    : t("onboarding.initAccount.email.helper")}
                </p>

                {emailSuggestion && (
                  <p className="mt-1 text-[16px] leading-snug text-muted-foreground">
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
              </div>

              <Button
                type="button"
                size="xl"
                onClick={handleEmailSend}
                disabled={verifying || sendingOtp}
                className="mb-3 w-full cursor-pointer font-semibold disabled:opacity-60"
              >
                {sendingOtp && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {sendingOtp
                  ? t("onboarding.initAccount.cta.sending")
                  : t("onboarding.initAccount.cta.send")}
              </Button>

              {/* Si ya hay OTP pendiente, dejale un shortcut al usuario */}
              {otpSent && (
                <Button
                  type="button"
                  variant="outline"
                  size="xl"
                  onClick={() => setStep(2)}
                  className="w-full cursor-pointer font-semibold"
                >
                  {t("onboarding.otpStep.cta.next")}
                </Button>
              )}
            </div>

            {/* STEP 2 - OTP */}
            <div className="w-1/3 shrink-0 px-1">
              {step === 2 && (
                <OtpStep
                  variant="earlyAccess"
                  email={email}
                  otp={otp}
                  setOtp={setOtp}
                  loading={verifying}
                  onNext={() => setStep(3)}
                  onBack={() => {
                    setOtp("");
                    setStep(1);
                  }}
                />
              )}
            </div>

            {/* STEP 3 - WORK TYPE */}
            <div className="w-1/3 shrink-0 pl-3">
              {step === 3 && (
                <WorkTypeStep
                  workType={workType}
                  setWorkType={setWorkType}
                  loading={verifying}
                  buttonLabel={
                    verifying
                      ? t("onboarding.initAccount.step3.button.loading")
                      : t("onboarding.initAccount.step3.button.ready")
                  }
                  onSubmit={handleEarlyAccessStart}
                  buttonClassName=""
                />
              )}
            </div>
          </div>
        </div>

        {/* ERROR */}
        {errorMessage && (
          <div className="mt-3 flex items-start gap-2.5 rounded-xl bg-red-50/80 px-4 py-3 border border-red-200/60"><p className="text-[12px] leading-snug text-red-700">{errorMessage}</p></div>
        )}
      </Card>
    </div>
  );
}
