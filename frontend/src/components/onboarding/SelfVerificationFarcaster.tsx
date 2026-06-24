"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  SelfAppBuilder,
  type SelfApp,
  SelfQRcodeWrapper,
} from "@selfxyz/qrcode";
import { getUniversalLink } from "@selfxyz/core";
import { dedupeToast as toast } from "@/lib/dedupeToast";

import { useWallet } from "@/providers/WalletProvider";
import { useTranslation } from "@/i18n/useTranslation";
import { BACKEND_URL, SELF_SCOPE } from "@/lib/constants";

type SelfVerificationFarcasterProps = {
  onVerified: () => void | Promise<void>;
  errorMessage?: string | null;
};

export default function SelfVerificationFarcaster({
  onVerified,
  errorMessage = null,
}: SelfVerificationFarcasterProps) {
  const { t } = useTranslation();
  const { mode, primaryWallet } = useWallet();

  const [selfApp, setSelfApp] = useState<SelfApp | null>(null);
  const [deeplink, setDeeplink] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<"idle" | "verifying" | "verified">(
    "idle",
  );

  const walletAddress = useMemo(
    () => primaryWallet?.address?.toLowerCase() ?? null,
    [primaryWallet],
  );

  // ================================
  // 1) Build SelfApp + deeplink
  // ================================
  useEffect(() => {
    if (mode !== "farcaster" || !walletAddress) return;

    const verifyEndpoint = `${BACKEND_URL}/self/verify`;

    const app = new SelfAppBuilder({
      version: 2,
      appName: "Lendoor",
      scope: SELF_SCOPE,
      endpoint: verifyEndpoint,
      endpointType: "https",
      devMode: true,
      logoBase64: import.meta.env.VITE_SELF_LOGO_BASE64 || undefined,
      userId: walletAddress,
      userIdType: "hex",
      userDefinedData: "To continue, Lendoor needs to verify your identity.",
      disclosures: {
        minimumAge: 18,
        excludedCountries: ["USA", "RUS", "IRN", "PRK", "SYR", "VEN"],
        ofac: false,
        nationality: true,
        gender: true,
        name: true,
        date_of_birth: true,
        passport_number: true,
      },
    }).build();

    setSelfApp(app);
    setDeeplink(getUniversalLink(app));
  }, [mode, walletAddress]);

  // ================================
  // 2) Poll simple a /self/profile (sin auth)
  // ================================
  const isSyncingRef = useRef(false);

  const syncSelfProfile = useCallback(async () => {
    if (!walletAddress) return;
    if (isSyncingRef.current) return;
    if (status === "verified") return;

    isSyncingRef.current = true;
    setChecking(true);
    setStatus("verifying");

    const url = `${BACKEND_URL}/self/profile?walletAddress=${encodeURIComponent(
      walletAddress,
    )}`;

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    try {
      for (let attempt = 1; attempt <= 5; attempt++) {
        let res: Response | null = null;

        try {
          res = await fetch(url, {
            method: "GET",
            headers: {
              Accept: "application/json",
            },
          });
        } catch (err) {
          console.error("[SelfFarcaster] /self/profile network error", err);
          if (attempt < 5) {
            await sleep(300 * attempt);
            continue;
          }
          toast.error(t("onboarding.selfFarcaster.toast.syncError"));
          setStatus("idle");
          return;
        }

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          console.error(
            "[SelfFarcaster] /self/profile http error",
            res.status,
            text,
          );

          if (attempt < 5) {
            await sleep(300 * attempt);
            continue;
          }

          toast.error(t("onboarding.selfFarcaster.toast.notYetVisible"));
          setStatus("idle");
          return;
        }

        const data = await res.json().catch(() => null);

        if (data?.verified) {
          setStatus("verified");
          toast.success(t("onboarding.selfFarcaster.toast.verified"));
          await onVerified();
          return;
        }

        if (attempt < 5) {
          await sleep(400 * attempt);
          continue;
        }

        toast.error(t("onboarding.selfFarcaster.toast.notConfirmed"));
        setStatus("idle");
        return;
      }
    } catch (e: unknown) {
      console.error("[SelfFarcaster] syncSelfProfile error", e);
      toast.error(t("onboarding.selfFarcaster.toast.syncError"));
      setStatus("idle");
    } finally {
      setChecking(false);
      isSyncingRef.current = false;
    }
  }, [walletAddress, status, onVerified, t]);

  // ================================
  // 3) Auto-check al montar
  // ================================
  const autoCheckedRef = useRef(false);
  useEffect(() => {
    if (autoCheckedRef.current) return;
    if (mode !== "farcaster") return;
    if (!walletAddress) return;

    autoCheckedRef.current = true;
    const id = setTimeout(() => {
      void syncSelfProfile();
    }, 500);

    return () => clearTimeout(id);
  }, [mode, walletAddress, syncSelfProfile]);

  // ================================
  // 4) Auto-check al volver a foco/visibilidad
  // ================================
  useEffect(() => {
    if (mode !== "farcaster") return;
    if (!walletAddress) return;

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        // Volvimos de Self o de background → reintentar sync
        void syncSelfProfile();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
  }, [mode, walletAddress, syncSelfProfile]);

  // ================================
  // 5) Render
  // ================================
  if (mode !== "farcaster") return null;

  if (!walletAddress || !selfApp || !deeplink) {
    return (
      <div className="flex min-h-[calc(100vh-10rem)] items-center justify-center px-4">
        <p className="text-sm text-muted-foreground">
          {t("onboarding.selfFarcaster.loading")}
        </p>
      </div>
    );
  }

  const isVerifying = checking;

  return (
    <div className="flex min-h-[calc(100vh-10rem)] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border bg-background/80 p-5 shadow-md">
        <div className="mb-3 text-xs font-mono tracking-[0.18em] text-muted-foreground">
          {t("onboarding.selfFarcaster.badge")}
        </div>

        <h1 className="mb-2 text-lg font-semibold">
          {t("onboarding.selfFarcaster.title")}
        </h1>

        <p className="mb-2 text-sm text-muted-foreground">
          {t("onboarding.selfFarcaster.body1")}
        </p>

        <p className="mb-4 text-[11px] text-muted-foreground">
          {t("onboarding.selfFarcaster.body2")}
        </p>

        {errorMessage ? (
          <div className="mb-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {errorMessage}
          </div>
        ) : null}

        {/* Botón iPhone: abre Self y se va de la página */}
        <button
          className="mb-2 w-full rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          onClick={() => {
            window.location.href = deeplink;
          }}
        >
          {t("onboarding.selfFarcaster.cta.iphone")}
        </button>

        {/* Botón Android: abre Self en nueva pestaña / contexto */}
        <button
          className="mb-2 w-full rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          onClick={() => {
            window.open(deeplink, "_blank");
          }}
        >
          {t("onboarding.selfFarcaster.cta.android")}
        </button>

        {/* QR (desktop / tablets) */}
        <div className="mt-4 hidden md:block">
          <SelfQRcodeWrapper
            selfApp={selfApp}
            onSuccess={syncSelfProfile}
            onError={(e) => {
              console.error("Error Self QR", e);
              toast.error(t("onboarding.selfFarcaster.toast.qrError"));
            }}
          />
        </div>

        {/* Botón manual para “ya terminé en Self” */}
        <button
          className="mt-4 w-full rounded-xl border px-4 py-2 text-xs font-medium"
          disabled={isVerifying}
          onClick={() => void syncSelfProfile()}
        >
          {isVerifying
            ? t("onboarding.selfFarcaster.cta.checking")
            : status === "verified"
              ? t("onboarding.selfFarcaster.cta.completed")
              : t("onboarding.selfFarcaster.cta.doneInSelf")}
        </button>
      </div>
    </div>
  );
}
