/**
 * Logs Lemon SDK operation outcomes to the backend `/client-log` endpoint
 * so errors that happen inside Lemon's native modal (like "El recurso ya
 * existe" or "Internal Server Error") become visible in our server logs.
 *
 * The Lemon SDK only surfaces `res.result` + `res.error.{code,message}` —
 * without this, we have no way to know WHY Lemon rejected an op.
 *
 * Targets the real backend (via BACKEND_URL). The `/__client-log` endpoint
 * only exists as a Vite dev-server middleware, so in production builds it
 * would silently drop logs.
 */
import { BACKEND_URL } from "@/lib/constants";

type LemonOperation =
  | "callSmartContract"
  | "callSmartContract.batch"
  | "deposit"
  | "withdraw"
  | "authenticate";

type LemonResult = {
  result?: string;
  data?: { txHash?: string };
  error?: {
    message?: string;
    code?: string;
  } | string | null;
};

/** Sanitize the payload so we never log secrets. */
function sanitizePayload(payload: unknown): Record<string, unknown> | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const p = payload as Record<string, unknown>;

  const out: Record<string, unknown> = {};
  if (p.contracts && Array.isArray(p.contracts)) {
    out.contracts = (p.contracts as unknown[]).map((c) => {
      const cc = c as Record<string, unknown>;
      return {
        contractAddress: cc.contractAddress,
        functionName: cc.functionName,
        chainId: cc.chainId,
        contractStandard: cc.contractStandard,
        hasPermits: Array.isArray(cc.permits) && cc.permits.length > 0,
        paramsCount: Array.isArray(cc.functionParams)
          ? cc.functionParams.length
          : 0,
      };
    });
  }
  if (typeof p.amount === "string") out.amount = p.amount;
  if (typeof p.tokenName === "string") out.tokenName = p.tokenName;
  if (typeof p.chainId !== "undefined") out.chainId = p.chainId;
  return out;
}

export function logLemonOutcome(
  operation: LemonOperation,
  res: LemonResult | null | undefined,
  context: {
    wallet?: string | null;
    payload?: unknown;
    extra?: Record<string, unknown>;
  } = {},
) {
  // Only fire from mobile/Lemon contexts. No-op on server render.
  if (typeof window === "undefined") return;

  const err = (res as { error?: unknown })?.error;
  const errObj =
    err && typeof err === "object"
      ? (err as Record<string, unknown>)
      : err != null
        ? { message: String(err) }
        : null;

  const body = {
    level: "error" as const,
    msg: `[Lemon] ${operation} -> ${res?.result ?? "NO_RESULT"}`,
    tag: "LemonSDK",
    time: Date.now(),
    operation,
    result: res?.result ?? null,
    errorCode:
      (errObj as { code?: string } | null)?.code ?? null,
    errorMessage:
      (errObj as { message?: string } | null)?.message ?? null,
    txHash: res?.data?.txHash ?? null,
    wallet: context.wallet ?? null,
    payload: sanitizePayload(context.payload),
    ...(context.extra ?? {}),
  };

  try {
    fetch(`${BACKEND_URL}/client-log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => {});
  } catch {
    // swallow — logging must never throw
  }
}
