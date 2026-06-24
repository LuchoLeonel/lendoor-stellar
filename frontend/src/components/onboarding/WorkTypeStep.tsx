// src/components/onboarding/WorkTypeStep.tsx
"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/i18n/useTranslation";

// eslint-disable-next-line react-refresh/only-export-components
export const WORK_TYPE_OPTIONS = [
  { value: "app_driver", labelKey: "onboarding.workType.options.app_driver" },
  { value: "app_delivery", labelKey: "onboarding.workType.options.app_delivery" },
  { value: "creator", labelKey: "onboarding.workType.options.creator" },
  { value: "freelance_cripto", labelKey: "onboarding.workType.options.freelance_cripto" },
  { value: "other_job", labelKey: "onboarding.workType.options.other_job" },
  { value: "no_job", labelKey: "onboarding.workType.options.no_job" },
] as const;

type WorkTypeValue = (typeof WORK_TYPE_OPTIONS)[number]['value'];

type WorkTypeStepProps = {
  workType: string | null;
  setWorkType: (value: WorkTypeValue) => void;
  loading?: boolean;
  buttonLabel: string;
  onSubmit: () => void;
  buttonClassName?: string;
};

export function WorkTypeStep({
  workType,
  setWorkType,
  loading,
  buttonLabel,
  onSubmit,
  buttonClassName,
}: WorkTypeStepProps) {
  const { t } = useTranslation();

  const defaultCtaClasses =
    "mt-1 w-full cursor-pointer bg-primary/85 text-base font-semibold " +
    "text-primary-foreground hover:bg-primary/90 disabled:opacity-60";

  const finalCtaClasses = [
    buttonClassName ?? defaultCtaClasses,
    "whitespace-normal break-words text-center leading-snug",
  ].join(" ");

  return (
    <>
      <h1 className="mb-3 text-[1.35rem] font-semibold leading-tight sm:text-[1.5rem]">
        {t("onboarding.workType.title")}
      </h1>

      <p className="mb-3 text-[15px] leading-relaxed text-muted-foreground">
        {t("onboarding.workType.body")}
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="space-y-3"
      >
        <div className="space-y-2">
          {WORK_TYPE_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              type="button"
              variant={workType === opt.value ? "default" : "outline"}
              onClick={() => setWorkType(opt.value)}
              className="w-full justify-start rounded-xl text-[15px]"
            >
              {t(opt.labelKey)}
            </Button>
          ))}
        </div>

        <Button
          type="submit"
          size="xl"
          disabled={!!loading || !workType}
          className={finalCtaClasses}
        >
          {buttonLabel}
        </Button>
      </form>
    </>
  );
}
