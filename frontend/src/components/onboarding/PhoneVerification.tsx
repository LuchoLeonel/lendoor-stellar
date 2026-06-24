// src/components/onboarding/PhoneVerification.tsx
// Standalone phone verification screen — reuses the PhoneStep from OnboardingWizard
// but without the progress bar or wizard shell.
import * as React from "react";
import { useTranslation } from "@/i18n/useTranslation";
import {
  PhoneStep,
  useKeyboardAvoidance,
} from "@/components/onboarding/OnboardingWizard";

type PhoneVerificationProps = {
  walletAddress: string;
  onVerified: () => void;
};

export function PhoneVerification({
  walletAddress,
  onVerified,
}: PhoneVerificationProps) {
  const { t } = useTranslation();
  const { keyboardHeight, isOpening } = useKeyboardAvoidance();

  return (
    <div className="relative min-h-[calc(100vh-4rem)] flex flex-col bg-background overflow-x-hidden">
      <div
        className="flex-1 flex flex-col pt-8 px-5 max-w-lg mx-auto w-full"
        style={{
          paddingBottom: keyboardHeight > 0 ? `${keyboardHeight + 16}px` : "16px",
          overflowY: "auto",
          transition: isOpening
            ? "padding-bottom 320ms cubic-bezier(0.33, 1, 0.68, 1)"
            : "padding-bottom 280ms cubic-bezier(0.42, 0, 0.58, 1)",
        }}
      >
        {/* Title — hidden when keyboard is open to save space */}
        <div
          className="flex items-center gap-3 mb-4"
          style={{ display: keyboardHeight > 0 ? "none" : undefined }}
        >
          <h1 className="text-2xl font-bold flex-1">
            {t("onboarding.phoneVerification.step1.title")}
          </h1>
        </div>

        {/* Phone step content */}
        <div className={`flex-1 flex flex-col ${keyboardHeight > 0 ? "mt-2" : "mt-1"}`}>
          <PhoneStep walletAddress={walletAddress} onVerified={onVerified} />
        </div>
      </div>
    </div>
  );
}
