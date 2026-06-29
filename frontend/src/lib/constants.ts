// ======= ENV / CONSTS =======
const configuredBackendUrl =
  import.meta.env.VITE_PUBLIC_BACKEND_URL?.trim() || undefined;

if (!configuredBackendUrl && !import.meta.env.DEV) {
  throw new Error("VITE_PUBLIC_BACKEND_URL must be set outside local development");
}

if (configuredBackendUrl) {
  try {
    new URL(configuredBackendUrl);
  } catch {
    throw new Error("VITE_PUBLIC_BACKEND_URL must be a valid absolute URL");
  }
}

export const BACKEND_URL = configuredBackendUrl ?? "http://localhost:5000";

export const FRONTEND_URL = import.meta.env.VITE_APP_BASE_URL ?? "http://localhost:3000";

// Address del LoanManager / CLM desde Vite
export const CLM_ADDRESS = import.meta.env
  .VITE_LOAN_MANAGER_ADDRESS as `0x${string}` | undefined

// Direcciones (Base 8453)
export const EVAULT_ADDRESS = import.meta.env.VITE_EVAULT as `0x${string}` | undefined;

export const EVAULT_JUNIOR_ADDRESS = import.meta.env
  .VITE_EVAULT_JUNIOR as `0x${string}` | undefined;

export const EVAULT_CONTROLLER_ADDRESS = import.meta.env
  .VITE_EVAULT_CONTROLLER as `0x${string}` | undefined;

export const USDC_ADDRESS = import.meta.env.VITE_USDC as `0x${string}` | undefined;

// Lista de RPCs para Base (puede venir por env, separado por coma)
const ENV_BASE_RPCS =
  (import.meta.env.VITE_BASE_RPCS as string | undefined)
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean) ?? [];

// Defaults robustos (orden de preferencia)
// Hardcoded entries at the end are emergency fallbacks — tried only when all env-configured RPCs fail.
export const DEFAULT_CELO_RPCS = [
  ...(ENV_BASE_RPCS || []),
  (import.meta.env.VITE_RPC_URL as string) || "",
  (import.meta.env.VITE_PUBLIC_RPC_URL as string) || "",
  "https://celo-mainnet.infura.io/v3/4378899573754c11af13454a514f385d",
  "https://forno.celo.org",
].filter(Boolean);

// Siempre escribimos en Base. Si no seteás env, caemos a 8453.
export const EXPECTED_CHAIN_ID: number = (() => {
  const raw = (import.meta.env.VITE_EXPECTED_CHAIN_ID as string | undefined)?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : 8453;
})();

export { MAX_SCORE, MAX_CREDIT_LEVEL, XP_PER_SCORE } from "@shared/constants";

export const CLARITY_ID = import.meta.env.VITE_CLARITY_ID;
export const NODE_ENV = import.meta.env.VITE_NODE_ENV || "development";

// 500394ef-b95c-4372-b7bf-6ddb0a2ea6e7
export const LEMON_MINI_APP_ID = '81e99927-984c-47e9-8c32-5524af5fd5c1';

// Scope que usa Self (de tu .env)
export const SELF_SCOPE =
  import.meta.env.VITE_SELF_SCOPE ?? 'self-playground';

// Logo opcional en base64 (si querés usarlo)
export const SELF_LOGO_BASE64 =
  import.meta.env.VITE_SELF_LOGO_BASE64 ?? undefined;