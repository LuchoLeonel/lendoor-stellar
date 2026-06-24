// src/components/onboarding/NotLoggedIn.tsx
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { useTranslation } from "@/i18n/useTranslation";
import { GridBackground } from "@/components/common/GridBackground";

const NotLoggedIn = ({ setShowAuthFlow }: { setShowAuthFlow: (show?: boolean) => void }) => {
  const { t } = useTranslation();

  return (
    <div data-testid="connect-wallet-prompt" className="flex min-h-[calc(100vh-4rem)] items-center justify-center relative overflow-hidden px-4">
      <GridBackground />
      <Card className="relative w-full max-w-md rounded-2xl p-5 sm:p-6 border-2 border-border/50 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground mono-text">
            {t("onboarding.notLoggedIn.badge")} {/* EARLY ACCESS */}
          </span>
        </div>

        <h1 className="mb-2 text-lg font-semibold">
          {t("onboarding.notLoggedIn.title")} {/* Conectá tu wallet */}
        </h1>

        <p className="mb-2 text-sm text-muted-foreground">
          {t("onboarding.notLoggedIn.body")}
        </p>

        <Button
          type="button"
          size="xl"
          onClick={() => setShowAuthFlow(true)}
          className="w-full text-base font-semibold"
        >
          {t("onboarding.notLoggedIn.cta")} {/* Conectar wallet */}
        </Button>
      </Card>
    </div>
  );
};

export default NotLoggedIn;
