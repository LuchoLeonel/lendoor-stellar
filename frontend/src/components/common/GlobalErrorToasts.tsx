// src/components/common/GlobalErrorToasts.tsx
"use client";

import * as React from "react";
import { dedupeToast as toast } from "@/lib/dedupeToast";
import { useTranslation } from "@/i18n/useTranslation";

function postLog(payload: Record<string, unknown>) {
  try {
    fetch("/__client-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        ...payload,
        path: window.location.pathname,
        ua: navigator.userAgent,
        time: Date.now(),
      }),
    }).catch(() => {});
  } catch { /* intentionally ignored */ }
}

// ======== CONFIG: afiná esto a gusto ========

// Mensajes que NO querés toastear (pero sí loguear)
const IGNORED_ERROR_SUBSTRINGS = [
  "ResizeObserver loop limit exceeded",
  "ResizeObserver loop completed with undelivered notifications",
  "The user aborted a request",
  "AbortError",
  "Failed to fetch",
  "Script error",
];

// Ventana de tiempo en la que no repetimos el mismo mensaje
const DEDUPE_WINDOW_MS = 4000;

let lastToastMsg: string | null = null;
let lastToastTime = 0;

function shouldShowToast(msg: string) {
  const normalized = String(msg || "").trim();

  // Ignorar errores "ruido" conocidos
  if (
    IGNORED_ERROR_SUBSTRINGS.some((pattern) =>
      normalized.includes(pattern),
    )
  ) {
    return false;
  }

  // De-dupe por mensaje + tiempo
  const now = Date.now();
  if (
    normalized === lastToastMsg &&
    now - lastToastTime < DEDUPE_WINDOW_MS
  ) {
    return false;
  }

  lastToastMsg = normalized;
  lastToastTime = now;
  return true;
}

export default function GlobalErrorToasts() {
  const { t } = useTranslation();

  React.useEffect(() => {
    const onError = (ev: ErrorEvent) => {
      const msg = ev?.error?.message || ev.message || "Uncaught error";

      if (shouldShowToast(msg)) {
        toast.error(t("common.globalErrors.uncaughtErrorTitle"));
      }

      postLog({
        level: "error",
        tag: "window.onerror",
        msg,
        stack: String(ev?.error?.stack || ""),
      });
    };

    const onRejection = (ev: PromiseRejectionEvent) => {
      const reason = ev?.reason;
      const msg =
        (reason && (reason.message || reason.toString?.())) ||
        "Unhandled promise rejection";

      if (shouldShowToast(msg)) {
        toast.error(t("common.globalErrors.unhandledRejectionTitle"));
      }

      postLog({
        level: "error",
        tag: "unhandledrejection",
        msg: String(msg),
        stack: String(reason?.stack || ""),
      });
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [t]);

  return null;
}
