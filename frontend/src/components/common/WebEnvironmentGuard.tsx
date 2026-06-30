// src/components/common/WebEnvironmentGuard.tsx
"use client";

import * as React from "react";
import QRCode from "react-qr-code";
import { useWallet } from "@/providers/WalletProvider";
import { LEMON_MINI_APP_ID } from "@/lib/constants";
import { isStellarMode } from "@/lib/stellar-wallet";
import { useTranslation } from "@/i18n/useTranslation";
import BlurText from "@/components/reactbits/BlurText";

function isLocalhost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "127.0.1.1" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost")
  );
}

function isAllowedHost(hostname: string | null): boolean {
  if (!hostname) return false;

  // Stellar/Freighter local dev — keep Lemon-only gate for EVM web builds.
  // Stellar is web-native (Freighter) — never gate to Lemon, on any host.
  if (isStellarMode()) return true;

  // Dev tunnels (VS Code, etc.)
  if (hostname.endsWith(".devtunnels.ms")) return true;

  // ngrok
  if (hostname.endsWith(".ngrok-free.app") || hostname.endsWith(".ngrok.io"))
    return true;

  return false;
}

const LEMON_DEEPLINK = `lemoncash://app/mini-apps/webview/${LEMON_MINI_APP_ID}`;

export function WebEnvironmentGuard({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isMiniApp, sdkHasLoaded } = useWallet();
  const { t } = useTranslation();

  const [ready, setReady] = React.useState(false);
  const [blocked, setBlocked] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (!sdkHasLoaded) return;

    const { hostname } = window.location;
    const allowedHost = isAllowedHost(hostname);
    const shouldBlock = !isMiniApp && !allowedHost;

    if (shouldBlock) {
      console.warn(
        "[WebEnvironmentGuard] Web app bloqueada en hostname:",
        hostname,
      );
    }

    setBlocked(shouldBlock);
    setReady(true);
  }, [isMiniApp, sdkHasLoaded]);

  if (!ready) return null;

  // Vista bloqueada: QR + deeplink (card más baja)
  if (blocked) {
    return (
      <div className="flex h-[calc(100dvh-5rem)] w-full items-center justify-center px-6 overflow-hidden">
        <div className="w-full max-w-md">
          <div className="rounded-xl border border-border/50 bg-background p-8 md:p-10 text-center shadow-sm">

            {/* QR */}
            <div className="mx-auto mb-6 w-52 h-52 rounded-xl bg-white border border-border/30 p-4 shadow-sm">
              <QRCode
                value={LEMON_DEEPLINK}
                size={176}
                style={{ width: "100%", height: "auto" }}
              />
            </div>

            {/* Title — BlurText animation */}
            <BlurText
              text={t("common.webGuard.title")}
              delay={100}
              animateBy="words"
              direction="bottom"
              stepDuration={0.35}
              className="text-[18px] font-bold text-foreground leading-tight justify-center"
            />

            <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground max-w-sm mx-auto">
              {t("common.webGuard.description")}
            </p>

            {/* CTA — SpotlightButton */}
            <div className="mt-6">
              <a href={LEMON_DEEPLINK}>
                <button className="font-semibold bg-primary text-primary-foreground hover:bg-primary/90 hover:scale-105 active:scale-[0.98] rounded-2xl px-8 py-3 text-[14px] cursor-pointer transition-all duration-200">
                  {t("common.webGuard.openInLemonCta")}
                </button>
              </a>
            </div>

            <p className="mt-4 text-[11px] leading-snug text-muted-foreground">
              {t("common.webGuard.qrHelp")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Caso normal: renderizamos la app
  return <>{children}</>;
}
