// src/i18n/useTranslation.ts
import { useEffect } from "react";
import { useTranslation as useI18n } from "react-i18next";
import { useWallet } from "@/providers/WalletProvider";

function getBrowserLanguage(): "es" | "en" {
  const lang = navigator.language || (navigator as unknown as Record<string, string>).userLanguage || "en";
  return lang.startsWith("es") ? "es" : "en";
}

export function useTranslation() {
  const { mode } = useWallet();
  const { t, i18n } = useI18n();

  useEffect(() => {
    let lang: "es" | "en";

    if (mode === "lemon") {
      lang = "es";
    } else if (mode === "none") {
      // No wallet connected — use browser language
      lang = getBrowserLanguage();
    } else {
      // farcaster / webapp — English
      lang = "en";
    }

    if (i18n.language !== lang) {
      void i18n.changeLanguage(lang);
    }
  }, [mode, i18n]);

  return { t, i18n, mode };
}
