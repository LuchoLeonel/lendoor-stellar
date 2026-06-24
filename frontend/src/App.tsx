// src/App.tsx
import * as React from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import { Header } from "@/components/common/Header";
import ClientConsoleBridge from "@/components/common/ClientConsoleBridge";
import BorrowPage from "@/pages/Borrow";
import Home from "@/pages/Home";
// Spec 084 — companion "firmá desde la computadora" (solo web, fuera de Lemon).
import WalletLink from "@/pages/WalletLink";
import LandingV2 from "@/pages/LandingV2";
import LendPage from "@/pages/Lend";
import StatsPage from "@/pages/Stats";
import TermsPage from "@/pages/Terms";
import PrivacyPage from "@/pages/Privacy";
import { BorrowerProvider } from "@/providers/BorrowerProvider";
import { RepaymentRecoveryGuard } from "@/components/borrow/RepaymentRecoveryGuard";
import { LenderProvider } from "./providers/LenderProvider";
import { useInteractionTracker } from "@/hooks/analytics/useInteractionTracker";
import { useAnalyticsWallet } from "@/hooks/analytics/useAnalyticsWallet";

function ScrollToTop() {
  const { pathname } = useLocation();
  React.useLayoutEffect(() => {
    const root = document.getElementById("root");
    if (root) root.scrollTop = 0;
  }, [pathname]);
  return null;
}

// Prevent layout-shift-induced scroll jumps on initial page load.
// Components mounting asynchronously (RainbowKit, Farcaster SDK) can
// cause #root to scroll down. This resets it for the first 2 seconds.
function ScrollShiftGuard() {
  React.useEffect(() => {
    // Only on desktop — mobile doesn't have the layout shift issue
    if (window.innerWidth < 768) return;
    const root = document.getElementById("root");
    if (!root) return;
    const handler = () => {
      if (root.scrollTop > 0 && root.scrollTop < 50) {
        root.scrollTop = 0;
      }
    };
    root.addEventListener("scroll", handler);
    const timer = setTimeout(() => root.removeEventListener("scroll", handler), 2000);
    return () => {
      root.removeEventListener("scroll", handler);
      clearTimeout(timer);
    };
  }, []);
  return null;
}

function InteractionTrackerComponent() {
  useInteractionTracker();
  useAnalyticsWallet();
  return null;
}

export default function App() {
  return (
    <div className="min-h-screen flex flex-col overflow-x-hidden">
      <ScrollToTop />
      <ScrollShiftGuard />
      <ClientConsoleBridge />
      <InteractionTrackerComponent />
      <Header />

      <div className="relative flex-1 overflow-x-hidden">
        <Routes>
          {/* Home renders full-width — no container wrapper */}
          <Route path="/" element={<Home />} />

          {/* Landing v2 — LaaS narrative (for partners). Lives in parallel
              to Home while we iterate. */}
          <Route path="/v2" element={<LandingV2 />} />

          {/* All other routes stay constrained in the centred container */}
          <Route
            path="/lend"
            element={
              <LenderProvider>
                <LendPage />
              </LenderProvider>
            }
          />

          <Route
            path="/borrow"
            element={
              <BorrowerProvider>
                <RepaymentRecoveryGuard>
                  <BorrowPage />
                </RepaymentRecoveryGuard>
              </BorrowerProvider>
            }
          />

          {/* Spec 084 — companion wallet link. Solo web (BrowserRouter);
              el mini-app (LemonShell/MemoryRouter) nunca llega acá. */}
          <Route path="/link" element={<WalletLink />} />

          <Route path="/stats" element={<StatsPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
        </Routes>
      </div>
    </div>
  );
}
