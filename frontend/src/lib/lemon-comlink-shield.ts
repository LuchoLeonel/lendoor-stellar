// Filtra mensajes que NO son del SDK de Lemon antes de llegar a
// window.ReactNativeWebView.postMessage. El SDK de Farcaster (cargado vía
// @farcaster/miniapp-wagmi-connector) detecta ReactNativeWebView y envía
// payloads Comlink (GET/SET/APPLY/CONSTRUCT/ENDPOINT/RELEASE) por el mismo
// bridge. Lemon, al no reconocerlos, dispara su modal de "actualizar app".

type RnWebView = { postMessage: (msg: string) => void };

declare global {
  interface Window {
    ReactNativeWebView?: RnWebView;
    __lemonShield?: {
      installed: boolean;
      version: number;
      dropped: number;
      passed: number;
      lastDropPreview?: string;
    };
  }
}

const LEMON_ACTIONS = new Set<string>([
  "IS_LEMON_WEBVIEW",
  "AUTHENTICATE",
  "DEPOSIT",
  "WITHDRAW",
  "CALL_SMART_CONTRACT",
]);

const SHIELD_VERSION = 2;

function looksLikeLemon(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object") return false;
    const action = parsed.action;
    return typeof action === "string" && LEMON_ACTIONS.has(action);
  } catch {
    return false;
  }
}

export function installLemonComlinkShield(): void {
  if (typeof window === "undefined") return;
  const existing = window.__lemonShield;
  if (existing?.installed && existing.version >= SHIELD_VERSION) return;

  const rn = window.ReactNativeWebView;
  if (!rn || typeof rn.postMessage !== "function") {
    console.log("[lemon-shield] no ReactNativeWebView, skip");
    return;
  }

  const original = rn.postMessage.bind(rn);
  const stats = { installed: true, version: SHIELD_VERSION, dropped: 0, passed: 0, lastDropPreview: undefined as string | undefined };
  window.__lemonShield = stats;

  rn.postMessage = (msg: string) => {
    if (typeof msg !== "string") {
      try {
        original(msg as unknown as string);
      } catch {}
      return;
    }
    if (looksLikeLemon(msg)) {
      stats.passed += 1;
      original(msg);
      return;
    }
    stats.dropped += 1;
    stats.lastDropPreview = msg.length > 200 ? msg.slice(0, 200) + "…" : msg;
    if (stats.dropped <= 5) {
      console.warn(
        `[lemon-shield] dropped non-Lemon payload (#${stats.dropped})`,
        stats.lastDropPreview,
      );
    }
  };

  console.log(`[lemon-shield] installed v${SHIELD_VERSION}`);
}
