// src/components/onboarding/JoinWaitlist.tsx
"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normalizeErrorMessage } from "@/lib/utils";
import { isValidEmail, suggestFixedEmail } from "@/lib/email-utils";
import { OtpStep } from "@/components/onboarding/OtpStep";
import { WorkTypeStep } from "@/components/onboarding/WorkTypeStep";
import { useTranslation } from "@/i18n/useTranslation";
import type { UserJourneyResponse } from "@shared/types/api";
import type { WorkType } from "@shared/types/work-type";

type JoinWaitlistProps = {
  journey: UserJourneyResponse | null;
  email: string;
  setEmail: (value: string) => void;
  joining: boolean;
  error: string | null;
  otp: string;
  setOtp: (value: string) => void;
  otpSent: boolean;
  sendingOtp: boolean;
  handleWaitlistSendOtp: (e?: React.FormEvent) => Promise<boolean>;
  handleWaitlistConfirm: (e?: React.FormEvent) => Promise<void>;
  workType: WorkType | null;
  setWorkType: (value: WorkType | null) => void;
};

const JoinWaitlist = ({
  journey: _journey,
  email,
  setEmail,
  joining,
  error,
  otp,
  setOtp,
  otpSent: _otpSent,
  sendingOtp,
  handleWaitlistSendOtp,
  handleWaitlistConfirm,
  workType,
  setWorkType,
}: JoinWaitlistProps) => {
  const { t } = useTranslation();

  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSuggestion, setEmailSuggestion] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);

  const backendError = normalizeErrorMessage(error);
  const errorMessage = emailError || backendError;

  const sliderTransform =
    step === 1
      ? "translateX(0%)"
      : step === 2
      ? "translateX(-33.3333%)"
      : "translateX(-66.6667%)";

  const handleEmailSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!isValidEmail(email)) {
      setEmailError(t("onboarding.joinWaitlist.email.invalid"));
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

    const ok = await handleWaitlistSendOtp(e);

    if (ok) {
      setStep(2);
    } else {
      setStep(1);
    }
  };

  const handleAcceptSuggestion = () => {
    if (!emailSuggestion) return;
    setEmail(emailSuggestion);
    setEmailSuggestion(null);
  };

  return (
    <div className="bg-background min-h-[calc(100vh-4rem)] px-5 pt-8 max-w-lg mx-auto overflow-x-hidden">
      <div className="relative overflow-x-hidden">
        <div
          className="flex w-[300%] transform-gpu transition-transform duration-500 ease-in-out"
          style={{ transform: sliderTransform }}
        >
          {/* Step 1: email */}
          <div className="w-1/3 shrink-0 pr-3">
            <h1 className="text-2xl font-bold leading-tight">
              {t("onboarding.joinWaitlist.step1.title")}
            </h1>

            <p className="mt-2 mb-8 text-[15px] leading-relaxed text-muted-foreground">
              {t("onboarding.joinWaitlist.step1.body")}
            </p>

            <form onSubmit={handleEmailSubmit} className="space-y-3">
              <Input
                type="email"
                inputMode="email"
                autoComplete="email"
                required
                placeholder={t("onboarding.joinWaitlist.email.placeholder")}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (emailError) setEmailError(null);
                  if (emailSuggestion) setEmailSuggestion(null);
                }}
                className="rounded-xl py-3.5 text-[15px]"
                disabled={sendingOtp || joining}
              />

              {emailSuggestion && (
                <p className="text-[15px] leading-snug text-muted-foreground">
                  {t("onboarding.joinWaitlist.email.suggestionPrefix")}{" "}
                  <button
                    type="button"
                    onClick={handleAcceptSuggestion}
                    className="font-medium underline underline-offset-2"
                  >
                    {emailSuggestion}
                  </button>
                  ?
                </p>
              )}

              <Button
                type="submit"
                size="xl"
                disabled={sendingOtp || joining}
                className="w-full h-14 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 font-semibold text-[15px] tracking-wider uppercase disabled:opacity-50 cursor-pointer"
              >
                {sendingOtp && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {sendingOtp
                  ? t("onboarding.joinWaitlist.cta.sending")
                  : t("onboarding.joinWaitlist.cta.send")}
              </Button>
            </form>
          </div>

          {/* Step 2: OTP */}
          <div className="w-1/3 shrink-0 px-1">
            {step === 2 && (
              <OtpStep
                variant="waitlist"
                email={email}
                otp={otp}
                setOtp={setOtp}
                loading={joining}
                onNext={() => setStep(3)}
                onBack={() => {
                  setOtp("");
                  setStep(1);
                }}
              />
            )}
          </div>

          {/* Step 3: work type */}
          <div className="w-1/3 shrink-0 pl-3">
            {step === 3 && (
              <WorkTypeStep
                workType={workType}
                setWorkType={setWorkType}
                loading={joining}
                buttonLabel={
                  joining
                    ? t("onboarding.joinWaitlist.step3.button.loading")
                    : t("onboarding.joinWaitlist.step3.button.ready")
                }
                onSubmit={() => handleWaitlistConfirm()}
                buttonClassName=""
              />
            )}
          </div>
        </div>
      </div>

      {errorMessage && (
        <div className="mt-3 flex items-start gap-2.5 rounded-xl bg-red-50/80 px-4 py-3 border border-red-200/60">
          <p className="text-[12px] leading-snug text-red-700">{errorMessage}</p>
        </div>
      )}
    </div>
  );
};

export default JoinWaitlist;
