// src/components/common/AppGate.tsx
"use client";

import * as React from "react";
import { useContracts } from "@/providers/ContractsProvider";
import { useTranslation } from "@/i18n/useTranslation";

export default function AppGate({ children }: { children: React.ReactNode }) {
  const { ready } = useContracts();
  const { t } = useTranslation();

  if (!ready) {
    return (
      <div className="w-full flex justify-center items-center min-h-[calc(100vh-10rem)]">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span className="h-2.5 w-2.5 animate-ping rounded-full bg-primary/70" />
          <span>{t("common.appGate.loading")}</span>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
