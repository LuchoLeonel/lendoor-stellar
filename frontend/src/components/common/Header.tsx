// components/layout/Header.tsx
"use client";

import * as React from "react";
import { Link, NavLink } from "react-router-dom";
import { useContracts } from "@/providers/ContractsProvider";
import { useWallet } from "@/providers/WalletProvider";
import { HeaderUsdcArea } from "./HeaderUsdcArea";
import { useTranslation } from "@/i18n/useTranslation";

const WebAuthArea = React.lazy(() => import("./WebAuthArea"));

function labelClasses(isActive: boolean) {
  const base =
    "relative inline-block tracking-wide transition-colors duration-150 " +
    "after:absolute after:left-1/2 after:bottom-[-2px] after:h-[2px] after:w-0 " +
    "after:-translate-x-1/2 after:rounded-full after:bg-primary " +
    "after:transition-all after:duration-200";
  return isActive
    ? [base, "text-foreground after:w-10"].join(" ")
    : [
        base,
        "text-muted-foreground group-hover:text-primary group-hover:after:w-6",
      ].join(" ");
}

export function Header() {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const { ready } = useContracts();
  const { isMiniApp } = useWallet();
  const { t } = useTranslation();

  // Hide header entirely in mini-app mode — Lemon/Farcaster provide their own nav bar
  if (isMiniApp) return null;

  return (
    <header className="border-b border-primary/20 bg-background/95 backdrop-blur-md sticky top-0 z-50 overflow-x-hidden">
      <div
        className="
          max-w-7xl mx-auto px-3 md:px-6 py-2 md:py-3
          grid items-center
          grid-cols-[minmax(0,1fr)_auto]
          md:grid-cols-[auto_1fr_auto]
          gap-2 md:gap-4
        "
      >
        {/* Brand */}
        {!isMiniApp ? (
          <Link
            to="/"
            data-testid="header-brand"
            className="group focus:outline-none flex items-center gap-2 md:gap-3 min-w-0"
          >
            <img
              src="/favicon.png"
              alt="favicon"
              width={15}
              height={15}
              className="h-7 w-7 shrink-0 object-contain"
            />
            <div className="text-xl md:text-2xl font-bold text-primary mono-text truncate">
              LENDOOR
            </div>
          </Link>
        ) : (
          <div className="group focus:outline-none flex items-center gap-2 md:gap-3 min-w-0">
            <img
              src="/favicon.png"
              alt="favicon"
              width={15}
              height={15}
              className="h-7 w-7 shrink-0 object-contain"
            />
            <div className="text-xl md:text-2xl font-bold text-primary mono-text truncate">
              LENDOOR
            </div>
          </div>
        )}

        {/* Nav solo en web (no mini-app) */}
        {!isMiniApp && (
          <nav className="hidden md:flex items-center justify-center gap-6">
            <NavLink to="/borrow" data-testid="nav-borrow">
              {({ isActive }) => (
                <div className="group px-2 py-1.5 text-sm flex items-center gap-2">
                  <span className={labelClasses(isActive)}>
                    {t("common.nav.borrow")}
                  </span>
                </div>
              )}
            </NavLink>
            <NavLink to="/stats" data-testid="nav-stats">
              {({ isActive }) => (
                <div className="group px-2 py-1.5 text-sm flex items-center gap-2">
                  <span className={labelClasses(isActive)}>{t("common.nav.stats")}</span>
                </div>
              )}
            </NavLink>
          </nav>
        )}

        {/* Right area */}
        <div className="justify-self-end w-auto md:w-[280px] md:min-w-[280px] flex justify-end items-center min-h-[40px]">
          {!ready ? (
            <div className="h-10 w-28 rounded-xl bg-muted/50 animate-pulse" />
          ) : isMiniApp ? (
            <HeaderUsdcArea />
          ) : (
            <React.Suspense fallback={<div className="h-10 w-28 rounded-xl bg-muted/50 animate-pulse" />}>
              <WebAuthArea mounted={mounted} />
            </React.Suspense>
          )}
        </div>
      </div>
    </header>
  );
}
