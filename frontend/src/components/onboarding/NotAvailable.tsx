// src/components/onboarding/NotAvailable.tsx
import { Card } from "../ui/card";
import { useTranslation } from "@/i18n/useTranslation";
import { GridBackground } from "@/components/common/GridBackground";

const NotAvailable = () => {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 relative overflow-hidden">
      <GridBackground />
      <Card className="relative w-full max-w-sm p-5 border-2 border-border/50 rounded-2xl">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[12px] text-muted-foreground mono-text tracking-[0.18em]">
            {t("onboarding.notAvailable.badge")} {/* ACCESS STATUS */}
          </span>
          <span className="text-[12px] text-muted-foreground">
            {t("onboarding.notAvailable.soon")} {/* Próximamente */}
          </span>
        </div>

        <h1 className="mb-2 text-xl font-semibold">
          {t("onboarding.notAvailable.title")}
        </h1>

        <p className="text-base text-muted-foreground">
          {t("onboarding.notAvailable.body")}
        </p>
      </Card>
    </div>
  );
};

export default NotAvailable;
