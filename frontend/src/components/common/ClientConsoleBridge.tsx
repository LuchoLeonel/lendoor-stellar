"use client";

import * as React from "react";

type Level = "log" | "info" | "warn" | "error";

export default function ClientConsoleBridge() {
  React.useEffect(() => {
    const orig = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
    };

    const send = (level: Level, args: unknown[]) => {
      try {
        const msg = args
          .map((a) =>
            typeof a === "string" ? a : JSON.stringify(a, null, 2),
          )
          .join(" ");
        fetch("/__client-log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          keepalive: true,
          body: JSON.stringify({
            level,
            tag: "console",
            msg,
            time: Date.now(),
            path: window.location.pathname,
            ua: navigator.userAgent,
          }),
        }).catch(() => {});
      } catch { /* intentionally ignored */ }
    };

    console.log = (...a) => {
      orig.log(...a);
      send("log", a);
    };
    console.info = (...a) => {
      orig.info(...a);
      send("info", a);
    };
    console.warn = (...a) => {
      orig.warn(...a);
      send("warn", a);
    };
    console.error = (...a) => {
      orig.error(...a);
      send("error", a);
    };

    return () => {
      console.log = orig.log;
      console.info = orig.info;
      console.warn = orig.warn;
      console.error = orig.error;
    };
  }, []);

  return null;
}
