// Spec 077 (2026-06-03) — top-level error boundary that does NOT use any
// hook tied to a context provider (no useTranslation, no useWallet, no
// useContractsProvider, etc.). It must work even when the entire provider
// stack underneath has crashed — that's its whole job.
//
// Lives ABOVE WalletProvider / ContractsProvider in `main.tsx`. The other
// boundary (`AppErrorBoundary`) lives INSIDE the provider stack and keeps
// the localized fallback + toast for "normal" UI crashes. This one catches
// the "providers themselves crashed" case that `AppErrorBoundary` cannot
// reach (a React boundary only catches descendants, not ancestors).
//
// Why this exists: the first attempt at this spec moved AppErrorBoundary
// to the top of the tree, but AppErrorBoundary internally uses
// `useTranslation`, which uses `useWallet`, which throws when there is no
// WalletProvider above — i.e. always, when placed at the top of the tree.
// Result: the boundary itself crashed during render, the whole app went
// blank, and we had to roll back. This component is hook-free on purpose.

"use client";

import * as React from "react";

type State = { hasError: boolean };

type Props = { children: React.ReactNode };

const FALLBACK_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "100vh",
  padding: "24px",
  fontFamily:
    "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  background: "#fff",
  color: "#111",
  textAlign: "center",
};

const TITLE_STYLE: React.CSSProperties = {
  fontSize: "18px",
  fontWeight: 600,
  marginBottom: "8px",
};

const BODY_STYLE: React.CSSProperties = {
  fontSize: "14px",
  color: "#666",
  marginBottom: "20px",
  maxWidth: "320px",
  lineHeight: "1.4",
};

const BUTTON_STYLE: React.CSSProperties = {
  padding: "10px 20px",
  borderRadius: "10px",
  border: "1px solid #111",
  background: "#111",
  color: "#fff",
  fontSize: "14px",
  fontWeight: 600,
  cursor: "pointer",
};

export class SimpleErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string }) {
    // Same telemetry channel the regular AppErrorBoundary uses. Best-effort,
    // we never want this fetch to throw and mask the real error.
    try {
      fetch("/__client-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          level: "error",
          tag: "SimpleErrorBoundary",
          msg: String((error as Error)?.message || error),
          stack: String((error as Error)?.stack || ""),
          componentStack: info?.componentStack || "",
          path:
            typeof window !== "undefined" ? window.location.pathname : "",
          ua: typeof navigator !== "undefined" ? navigator.userAgent : "",
          time: Date.now(),
        }),
      }).catch(() => {});
    } catch {
      /* intentionally ignored */
    }
  }

  handleReload = () => {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    // Bilingual hardcoded copy (no i18n hook available at this layer).
    return (
      <div style={FALLBACK_STYLE} role="alert" aria-live="assertive">
        <div style={TITLE_STYLE}>
          Algo salió mal · Something went wrong
        </div>
        <div style={BODY_STYLE}>
          Tuvimos un problema cargando la app. Probá recargar la página.
          <br />
          We had a problem loading the app. Please reload the page.
        </div>
        <button
          type="button"
          style={BUTTON_STYLE}
          onClick={this.handleReload}
        >
          Recargar · Reload
        </button>
      </div>
    );
  }
}

export default SimpleErrorBoundary;
