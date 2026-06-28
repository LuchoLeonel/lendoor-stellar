// src/components/onboarding/ErrorComponent.tsx
import { useTranslation } from "@/i18n/useTranslation";

const ErrorComponent = ({ error }: { error: string | null }) => {
  const { t } = useTranslation();

  const handleRetry = () => {
    window.location.reload();
  };

  return (
    <div className="relative min-h-[calc(100vh-4rem)] flex flex-col bg-background overflow-x-hidden">
      <div className="flex-1 flex flex-col items-center justify-center px-6 max-w-lg mx-auto w-full text-center">
        {/* Icon */}
        <div
          className="flex h-16 w-16 items-center justify-center rounded-full mb-6"
          style={{ backgroundColor: "rgba(239,68,68,0.1)" }}
        >
          <svg
            className="h-8 w-8 text-red-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
            />
          </svg>
        </div>

        <h1 className="text-2xl font-bold text-foreground mb-3">
          {t("onboarding.error.title")}
        </h1>

        <p className="text-[15px] leading-relaxed text-muted-foreground mb-8">
          {t("onboarding.error.body")}
        </p>

        {import.meta.env.DEV && error ? (
          <p className="mb-8 w-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-left text-xs text-red-700">
            {error}
          </p>
        ) : null}

        <button
          onClick={handleRetry}
          className="w-full h-14 rounded-xl bg-primary text-primary-foreground font-semibold text-[15px] tracking-wider uppercase hover:bg-primary/90 active:scale-[0.98] transition-all cursor-pointer"
        >
          {t("onboarding.error.retryCta")}
        </button>
      </div>
    </div>
  );
};

export default ErrorComponent;
