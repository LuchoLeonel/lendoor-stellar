// src/components/borrow/MiniAppFundsBox.tsx
"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/providers/WalletProvider";
import { LemonFundsDialogs } from "@/components/common/LemonFundsDialogs";
import { useTranslation } from "@/i18n/useTranslation";

/** Bloque para manejar fondos entre Lemon Cash y la mini app */
export function MiniAppFundsBox() {
  const { isMiniApp, mode } = useWallet();
  const [openDeposit, setOpenDeposit] = React.useState(false);
  const [openWithdraw, setOpenWithdraw] = React.useState(false);
  const { t } = useTranslation();

  // Solo tiene sentido en mini-app de Lemon, no en web ni Farcaster
  if (!isMiniApp || mode !== "lemon") {
    return null;
  }

  return (
    <>
      <div className="mx-4 mb-5 space-y-2 rounded-2xl border-2 border-border/60 bg-muted/50 p-4">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
              {t("borrow.miniAppFunds.header")}
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOpenDeposit(true)}
            >
              {t("borrow.miniAppFunds.depositCta")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOpenWithdraw(true)}
            >
              {t("borrow.miniAppFunds.withdrawCta")}
            </Button>
          </div>
        </div>
        <p className="text-[11px] leading-snug text-muted-foreground">
          {t("borrow.miniAppFunds.description")}
        </p>
      </div>

      <LemonFundsDialogs
        openDeposit={openDeposit}
        onOpenDepositChange={setOpenDeposit}
        openWithdraw={openWithdraw}
        onOpenWithdrawChange={setOpenWithdraw}
        depositDescription={t("borrow.miniAppFunds.depositDescription")}
        withdrawDescription={t("borrow.miniAppFunds.withdrawDescription")}
      />
    </>
  );
}
