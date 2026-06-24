import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { isWebView as lemonIsWebView } from "@lemoncash/mini-app-sdk";

// DEV-ONLY (spec 082): `?reset=1` limpia localStorage/sessionStorage y recarga
// sin el query param. Útil para testing en el WebView de Lemon desde el celu,
// donde no hay devtools: borra el RPC cacheado (lendoor:rpc:base:url) + JWT
// (lendoor:accessToken/tokenWallet) que apuntaban al RPC viejo capado.
try {
  const sp = new URLSearchParams(window.location.search);
  if (sp.get("reset") === "1") {
    localStorage.clear();
    sessionStorage.clear();
    sp.delete("reset");
    const clean =
      window.location.pathname +
      (sp.toString() ? `?${sp.toString()}` : "") +
      window.location.hash;
    window.location.replace(clean);
  }
} catch {
  /* no-op */
}

// Debe correr antes de cualquier import que cargue el SDK de Farcaster.
import { installLemonComlinkShield } from "@/lib/lemon-comlink-shield";
installLemonComlinkShield();

import { WagmiProvider } from "@/providers/WagmiProvider";
import { ContractsProvider } from "@/providers/ContractsProvider";
import { WalletProvider } from "./providers/WalletProvider";
import { AnalyticsProvider } from "./providers/AnalyticsProvider";
import { LemonShell } from "@/components/common/LemonShell";

import GlobalErrorToasts from "@/components/common/GlobalErrorToasts";
import AppErrorBoundary from "@/components/common/AppErrorBoundary";
import { SimpleErrorBoundary } from "@/components/common/SimpleErrorBoundary";

import { Toaster } from "sonner";
import App from "./App";

import "buffer";
import "./index.css";

// Anti-zoom: bloquea pinch-zoom y double-tap-zoom (rompen el layout de la
// mini-app y se ven como bug). El viewport ya tiene user-scalable=no, pero
// algunos WKWebView lo ignoran → reforzamos por JS.
//   - gesturestart/change/end: gesto pinch nativo de iOS Safari/WKWebView.
//   - touchmove con 2+ dedos: pinch en webviews que no disparan 'gesture*'.
//   - dblclick: double-tap-zoom en desktop/algunos webviews.
["gesturestart", "gesturechange", "gestureend"].forEach((ev) =>
  document.addEventListener(ev, (e) => e.preventDefault(), { passive: false }),
);
document.addEventListener("dblclick", (e) => e.preventDefault(), { passive: false });

// Guard de gestos para el WebView de Lemon. Bloquea el swipe-back nativo
// (edge-swipe horizontal) SIN romper el scroll vertical.
//
// Bug previo: el handler permitía TODO el gesto apenas el dedo estaba dentro de
// un scroller vertical → el componente horizontal del swipe disparaba el
// edge-swipe-back (se veía la pantalla anterior al deslizar en Inicio). Fix:
// mirar la DIRECCIÓN y bloquear lo horizontal-dominante aunque haya un scroller
// vertical debajo. Solo se permite horizontal si hay un scroller horizontal real.
let __touchStartX = 0;
let __touchStartY = 0;
document.addEventListener("touchstart", (e) => {
  if (e.touches.length === 1) {
    __touchStartX = e.touches[0].clientX;
    __touchStartY = e.touches[0].clientY;
  }
}, { passive: true });

function __hasScrollableAncestor(target: EventTarget | null, axis: "x" | "y"): boolean {
  let el = target as HTMLElement | null;
  while (el) {
    const style = window.getComputedStyle(el);
    if (axis === "y") {
      const oy = style.overflowY;
      if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight) return true;
    } else {
      const ox = style.overflowX;
      if ((ox === "auto" || ox === "scroll") && el.scrollWidth > el.clientWidth) return true;
    }
    el = el.parentElement;
  }
  return false;
}

document.addEventListener("touchmove", (e) => {
  // 2+ dedos = pinch-zoom → bloquear (refuerza el anti-zoom en webviews que
  // no disparan los eventos 'gesture*').
  if (e.touches.length > 1) { e.preventDefault(); return; }
  if (e.touches.length !== 1) return;
  const dx = e.touches[0].clientX - __touchStartX;
  const dy = e.touches[0].clientY - __touchStartY;

  // Gesto horizontal-dominante → bloquear (mata el edge-swipe-back), salvo que
  // haya un scroller horizontal real bajo el dedo (carruseles, etc.).
  if (Math.abs(dx) > Math.abs(dy)) {
    if (!__hasScrollableAncestor(e.target, "x")) e.preventDefault();
    return;
  }

  // Gesto vertical → permitir solo si hay un scroller vertical; si no, bloquear.
  if (!__hasScrollableAncestor(e.target, "y")) e.preventDefault();
}, { passive: false });
import "@rainbow-me/rainbowkit/styles.css";
import "./i18n/i18n";

// Detect Lemon WebView at module load time so we select the correct Router.
// MemoryRouter in Lemon mode prevents React Router from touching window.history.
function safeIsLemonWebView(): boolean {
  try {
    return lemonIsWebView() === true;
  } catch {
    return false;
  }
}
const IS_LEMON = safeIsLemonWebView();
const AppRoot = IS_LEMON ? LemonShell : BrowserRouter;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppRoot>
      {/*
        🚨 Spec 077 (2026-06-03, revised) — TWO error boundaries.

        Outer boundary: `SimpleErrorBoundary`. Hook-free, no i18n, no
        context dependency. Lives ABOVE WalletProvider/ContractsProvider so
        it can catch crashes IN those providers (which the inner boundary
        cannot — a React boundary only catches its own descendants).

        Inner boundary: `AppErrorBoundary`. Lives INSIDE the provider
        stack as before, uses useTranslation for a localized fallback
        + dedupeToast. Catches the common "child component crashed" case.

        The FIRST attempt at this fix (commit 494b080a) tried to move
        AppErrorBoundary itself to the top of the tree. That crashed the
        whole app because AppErrorBoundary → useTranslation → useWallet
        threw without WalletProvider above it. Rolled back same day.
        SimpleErrorBoundary is the hook-free fix that does the job.
      */}
      <SimpleErrorBoundary>
        <AnalyticsProvider>
          <WagmiProvider>
            <WalletProvider>
              <ContractsProvider>
                <AppErrorBoundary>
                  <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading UI…</div>}>
                    <App />
                  </Suspense>

                  <GlobalErrorToasts />
                  <Toaster
                    richColors
                    position="top-center"
                    toastOptions={{
                      style: {
                        borderRadius: '16px',
                        fontSize: '13px',
                        fontWeight: 500,
                        padding: '12px 16px',
                        boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
                        border: '1px solid rgba(0,0,0,0.06)',
                      },
                    }}
                  />
                </AppErrorBoundary>
              </ContractsProvider>
            </WalletProvider>
          </WagmiProvider>
        </AnalyticsProvider>
      </SimpleErrorBoundary>
    </AppRoot>
  </StrictMode>,
);
