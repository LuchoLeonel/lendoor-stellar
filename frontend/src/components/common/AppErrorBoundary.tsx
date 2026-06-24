// src/components/common/AppErrorBoundary.tsx
"use client";

import * as React from "react";
import { dedupeToast as toast } from "@/lib/dedupeToast";
import { useTranslation } from "@/i18n/useTranslation";

type BoundaryMessages = {
  toastTitle: string;
  uiTitle: string;
  uiBody: string;
  reloadCta: string;
};

type BoundaryProps = {
  children: React.ReactNode;
  messages: BoundaryMessages;
};

type State = { hasError: boolean };

class AppErrorBoundaryInner extends React.Component<BoundaryProps, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string }) {
    try {
      fetch("/__client-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          level: "error",
          tag: "AppErrorBoundary",
          msg: String((error as Error)?.message || error),
          stack: String((error as Error)?.stack || info?.componentStack || ""),
          path: typeof window !== "undefined" ? window.location.pathname : "",
          ua: typeof navigator !== "undefined" ? navigator.userAgent : "",
          time: Date.now(),
        }),
      }).catch(() => {});
    } catch { /* intentionally ignored */ }

    toast.error(this.props.messages.toastTitle);
  }

  handleReload = () => {
    this.setState({ hasError: false });
    if (typeof window !== "undefined") window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      const { messages } = this.props;
      return (
        <div className="relative min-h-[calc(100vh-4rem)] flex flex-col bg-background overflow-x-hidden">
          <div className="flex-1 flex flex-col items-center justify-center px-6 max-w-lg mx-auto w-full text-center">
            <div
              className="flex h-16 w-16 items-center justify-center rounded-full mb-6"
              style={{ backgroundColor: "rgba(239,68,68,0.1)" }}
            >
              <svg
                className="h-8 w-8 text-red-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                />
              </svg>
            </div>

            <h1 className="text-2xl font-bold text-foreground mb-3">
              {messages.uiTitle}
            </h1>

            <p className="text-[15px] leading-relaxed text-muted-foreground mb-8">
              {messages.uiBody}
            </p>

            <button
              onClick={this.handleReload}
              className="w-full h-14 rounded-xl bg-primary text-primary-foreground font-semibold text-[15px] tracking-wider uppercase hover:bg-primary/90 active:scale-[0.98] transition-all cursor-pointer"
            >
              {messages.reloadCta}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

type WrapperProps = { children: React.ReactNode };

export default function AppErrorBoundary({ children }: WrapperProps) {
  const { t } = useTranslation();

  const messages: BoundaryMessages = {
    toastTitle: t("common.errorBoundary.toastTitle"),
    uiTitle: t("common.errorBoundary.uiTitle"),
    uiBody: t("common.errorBoundary.uiBody"),
    reloadCta: t("common.errorBoundary.reloadCta"),
  };

  return <AppErrorBoundaryInner messages={messages}>{children}</AppErrorBoundaryInner>;
}
