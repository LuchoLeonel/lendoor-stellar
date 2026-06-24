// src/components/on-boarding/TermsAndConditionsCard.tsx
"use client";

import * as React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeftCircle } from "lucide-react";
import TermsBody from "./TermsBody";
import PrivacyBody from "./PrivacyBody";

type TermsAndConditionsCardProps = {
  isAccepted: boolean;
  accepting?: boolean;
  onAccept?: () => void;

  // 👉 Opcionales: barra fija para volver a la línea de crédito
  showBackToCreditLine?: boolean;
  onBackToCreditLine?: () => void;

  /** Skip scroll-to-bottom requirement (user already read them before) */
  alreadyRead?: boolean;
};

type SectionKey = "terms" | "privacy";

export default function TermsAndConditionsCard({
  isAccepted,
  accepting,
  onAccept,
  showBackToCreditLine,
  onBackToCreditLine,
  alreadyRead = false,
}: TermsAndConditionsCardProps) {
  const [activeSection, setActiveSection] = React.useState<SectionKey>(alreadyRead ? "privacy" : "terms");
  const [privacyUnlocked, setPrivacyUnlocked] = React.useState<boolean>(
    isAccepted || alreadyRead
  );

  // Always allow accepting — no scroll-to-bottom requirement
  const [termsRead, setTermsRead] = React.useState(true);
  const [privacyRead, setPrivacyRead] = React.useState(true);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  // Si desde afuera marcan como aceptado, desbloqueamos todo
  React.useEffect(() => {
    if (isAccepted) {
      setPrivacyUnlocked(true);
      setTermsRead(true);
      setPrivacyRead(true);
    }
  }, [isAccepted]);

  // Check if scrolled to bottom
  const handleScroll = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    // Consider "read" when within 20px of the bottom
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20;
    if (atBottom) {
      if (activeSection === "terms") setTermsRead(true);
      if (activeSection === "privacy") setPrivacyRead(true);
    }
  }, [activeSection]);

  // Reset scroll position when switching sections
  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [activeSection]);

  // Check on mount in case content is shorter than container (no scroll needed)
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // If content doesn't overflow, mark as read immediately
    if (el.scrollHeight <= el.clientHeight + 20) {
      if (activeSection === "terms") setTermsRead(true);
      if (activeSection === "privacy") setPrivacyRead(true);
    }
  }, [activeSection]);

  const showFooter = !isAccepted || showBackToCreditLine;

  const handleGoToPrivacy = () => {
    setPrivacyUnlocked(true);
    setActiveSection("privacy");
  };

  const isTermsStep = activeSection === "terms";
  const isPrivacyStep = activeSection === "privacy";

  return (
    <div className="w-full flex justify-center px-4 mt-6 mb-4">
      <Card
        className="
          w-full max-w-md
          max-h-[calc(100dvh-96px)]
          flex flex-col
          shadow-sm
          gap-3
          border-2 border-border/50 rounded-2xl
        "
      >
        <CardHeader className="shrink-0 space-y-2">
          <CardTitle className="text-base">
            {activeSection === "terms"
              ? "TÉRMINOS Y CONDICIONES DE USO"
              : "POLÍTICA DE PRIVACIDAD"}
          </CardTitle>

          {/* Selector de sección: TyC / Privacy */}
          <div className="inline-flex rounded-full bg-muted p-1 text-[11px] font-medium">
            <button
              type="button"
              onClick={() => setActiveSection("terms")}
              className={`
                px-4 py-2.5 min-h-[44px] rounded-full transition-colors
                ${isTermsStep
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"}
              `}
            >
              Términos y Condiciones
            </button>
            <button
              type="button"
              disabled={!privacyUnlocked}
              onClick={() => privacyUnlocked && setActiveSection("privacy")}
              className={`
                px-4 py-2.5 min-h-[44px] rounded-full transition-colors
                ${isPrivacyStep
                  ? "bg-background text-foreground shadow-xs"
                  : privacyUnlocked
                  ? "text-muted-foreground hover:text-foreground"
                  : "text-muted-foreground opacity-60 cursor-not-allowed"}
              `}
            >
              Política de Privacidad
            </button>
          </div>

        </CardHeader>

        {/* Área scrollable interna */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-6 pb-4 space-y-4 text-xs leading-relaxed text-muted-foreground"
        >
          {activeSection === "terms" ? <TermsBody /> : <PrivacyBody />}
        </div>

        {/* Footer fijo dentro de la card */}
        {showFooter && (
          <CardFooter
            className="
              shrink-0
              mt-3
              flex flex-col gap-2
              border-t
              bg-background/95 backdrop-blur
              px-6 pb-3 pt-4
            "
          >
            {showBackToCreditLine && (
              <Button
                size="xl"
                variant="ghost"
                type="button"
                onClick={onBackToCreditLine}
                className="w-full gap-2 text-base font-semibold"
              >
                <ArrowLeftCircle className="h-5 w-5" />
                Volver a tu línea de crédito
              </Button>
            )}

            {/* Flow de aceptación */}
            {!isAccepted && isTermsStep && (
              <Button
                size="xl"
                type="button"
                onClick={handleGoToPrivacy}
                disabled={accepting || !termsRead}
                className="w-full text-base font-semibold disabled:opacity-60"
              >
                {!termsRead
                  ? "Leé hasta el final para continuar"
                  : accepting
                  ? "Continuando..."
                  : "Continuar a Política de Privacidad"}
              </Button>
            )}

            {!isAccepted && isPrivacyStep && (
              <div className="flex w-full flex-col gap-2">
                <Button
                  size="xl"
                  type="button"
                  onClick={onAccept}
                  disabled={accepting || !privacyRead}
                  className="w-full text-base font-semibold disabled:opacity-60"
                >
                  {!privacyRead
                    ? "Leé hasta el final para aceptar"
                    : accepting
                    ? "Aceptando..."
                    : "Aceptar todo"}
                </Button>
              </div>
            )}
          </CardFooter>
        )}
      </Card>
    </div>
  );
}
