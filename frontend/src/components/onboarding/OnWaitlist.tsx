// src/components/onboarding/OnWaitlist.tsx
import { CheckCircle2, Clock, Mail } from "lucide-react";
import { useTranslation } from "@/i18n/useTranslation";
import { GridBackground } from "@/components/common/GridBackground";
import type { UserJourneyResponse } from "@shared/types/api";

const OnWaitList = ({ journey }: { journey: UserJourneyResponse }) => {
  const { t } = useTranslation();

  return (
    <div className="bg-background min-h-[calc(100vh-4rem)] px-5 max-w-lg mx-auto flex flex-col relative overflow-hidden">
      <GridBackground />

      {/* Top section — centered vertically */}
      <div className="flex-1 flex flex-col items-center justify-center text-center relative z-10">

        {/* Isotipo */}
        <img src="/favicon.png" alt="Lendoor" className="h-16 w-16 object-contain mt-12 mb-8" />

        {/* Title */}
        <h1 className="text-[22px] font-bold text-foreground leading-tight">
          {t("onboarding.onWaitlist.title")}
        </h1>

        <p className="mt-3 text-[14px] leading-relaxed text-muted-foreground max-w-[300px]">
          {t("onboarding.onWaitlist.subtitle")}
        </p>

        {/* Stepper */}
        <div className="mt-10 flex flex-col gap-0 items-center">

          {/* Step 1 — completed */}
          <div className="flex items-start gap-4">
            <div className="flex flex-col items-center">
              <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0 mt-0.5" />
              <div className="w-px flex-1 mt-1.5 mb-0" style={{ height: 36, background: 'linear-gradient(to bottom, rgb(34 197 94 / 0.35), hsl(var(--primary) / 0.25))' }} />
            </div>
            <p className="text-[14px] font-medium text-foreground pb-4 text-left">
              {t("onboarding.onWaitlist.step1")}
            </p>
          </div>

          {/* Step 2 — waiting (clock, no spinner) */}
          <div className="flex items-start gap-4">
            <div className="flex flex-col items-center">
              <Clock className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div className="w-px flex-1 mt-1.5" style={{ height: 36, background: 'linear-gradient(to bottom, hsl(var(--primary) / 0.25), hsl(var(--muted-foreground) / 0.06))' }} />
            </div>
            <p className="text-[14px] font-semibold text-primary pb-4 text-left">
              {t("onboarding.onWaitlist.step2")}
            </p>
          </div>

          {/* Step 3 — notification */}
          <div className="flex items-start gap-4">
            <Mail className="h-5 w-5 mt-0.5 shrink-0 text-muted-foreground/30" />
            <p className="text-[14px] font-medium text-muted-foreground/50 text-left">
              {t("onboarding.onWaitlist.step3")}
            </p>
          </div>

        </div>

        {/* Email notification */}
        {journey.email && (
          <div className="mt-10 flex items-center gap-2.5 rounded-xl bg-muted border border-border px-4 py-3 w-full">
            <Mail className="h-4 w-4 shrink-0 text-primary" />
            <p className="text-[12px] text-muted-foreground text-left">
              {t("onboarding.onWaitlist.notify", { email: journey.email })}
            </p>
          </div>
        )}
      </div>

      {/* Bottom padding */}
      <div className="h-20" />
    </div>
  );
};

export default OnWaitList;
