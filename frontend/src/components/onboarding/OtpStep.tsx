// src/components/onboarding/OtpStep.tsx
"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/i18n/useTranslation";

type OtpStepProps = {
  variant?: "waitlist" | "earlyAccess";
  email: string;
  otp: string;
  setOtp: (value: string) => void;
  loading?: boolean;
  onNext: () => void;
  onBack?: () => void;
};

export function OtpStep({
  variant = "waitlist",
  email,
  otp,
  setOtp,
  loading,
  onNext,
  onBack,
}: OtpStepProps) {
  const { t } = useTranslation();

  const titleClass =
    variant === "earlyAccess"
      ? "text-2xl font-semibold sm:text-3xl"
      : "text-[1.35rem] font-semibold leading-tight sm:text-[1.5rem]";

  const title =
    variant === "earlyAccess"
      ? t("onboarding.otpStep.title.earlyAccess")
      : t("onboarding.otpStep.title.waitlist");

  const inputClass =
    variant === "earlyAccess"
      ? "rounded-xl py-3.5 text-center text-[18px] tracking-[0.25em]"
      : "rounded-xl py-3.5 text-[15px] text-center tracking-[0.2em]";

  const buttonLabel =
    variant === "earlyAccess"
      ? t("onboarding.otpStep.cta.continue")
      : t("onboarding.otpStep.cta.next");

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!otp.trim()) return;
    onNext();
  };

  return (
    <>
      <h1 className={`${titleClass} mb-3`}>{title}</h1>

      <div className="mb-5 text-[15px] leading-relaxed text-muted-foreground">
        <p className="mb-2">
          {t("onboarding.otpStep.body.line1", { email })}
        </p>

        {variant === "earlyAccess" ? (
          <p>{t("onboarding.otpStep.body.earlyAccess")}</p>
        ) : (
          <p>{t("onboarding.otpStep.body.waitlist")}</p>
        )}

        <p className="mt-2 text-[13px] text-muted-foreground/70">
          {t("onboarding.otpStep.body.checkSpam")}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <Input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder={t("onboarding.otpStep.input.placeholder")}
          value={otp}
          onChange={(e) => setOtp(e.target.value)}
          className={inputClass}
          disabled={!!loading}
        />

        <Button
          type="submit"
          size="xl"
          disabled={!!loading || !otp.trim()}
          className="w-full cursor-pointer font-semibold disabled:opacity-60"
        >
          {buttonLabel}
        </Button>

        {onBack && (
          <Button
            type="button"
            size="xl"
            variant="outline"
            onClick={onBack}
            className="w-full cursor-pointer font-semibold"
          >
            {t("onboarding.otpStep.cta.changeEmail")}
          </Button>
        )}
      </form>
    </>
  );
}
