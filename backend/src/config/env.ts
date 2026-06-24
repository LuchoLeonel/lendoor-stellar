// src/config/env.ts
// Validates ALL environment variables at startup.
// Import this module early (before NestFactory.create) so the app
// crashes immediately with a clear message instead of failing at
// random times when a service first reads a missing var.

import { z } from 'zod/v4';

const hexAddress = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'Must be a valid 0x hex address');
const hexKey = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, 'Must be a valid 0x private key');

const envSchema = z.object({
  // ── Server ─────────────────────────────────────────────
  NODE_ENV: z
    .enum(['production', 'development', 'staging', 'test'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(5000),

  // ── PostgreSQL (required) ──────────────────────────────
  POSTGRES_HOST: z.string().min(1),
  POSTGRES_PORT: z.coerce.number().int().positive().default(5432),
  POSTGRES_USER: z.string().min(1),
  POSTGRES_PASSWORD: z.string().min(1),
  POSTGRES_DB: z.string().min(1),

  // ── Blockchain (required) ──────────────────────────────
  ETH_RPC_URL: z.url(),
  ETH_LOAN_MANAGER: hexAddress,
  ETH_PRIVATE_KEY: hexKey,

  // ── SMTP / Email (optional — gracefully degrades) ──────
  SMTP_USER: z.string().optional(),
  SMTP_APP_PASS: z.string().optional(),
  SMTP_SENDER: z.string().email().optional(),

  // ── Kapso WhatsApp (optional — gracefully degrades) ────
  KAPSO_API_KEY: z.string().optional(),
  KAPSO_PHONE_NUMBER_ID: z.string().optional(),
  WA_TPL_LANG: z.string().default('es'),

  // ── WhatsApp templates (optional) ──────────────────────
  WA_TPL_DUE_3D: z.string().default(''),
  WA_TPL_DUE_TOMORROW: z.string().default(''),
  WA_TPL_DUE_TODAY: z.string().default(''),
  WA_TPL_OVERDUE: z.string().default(''),

  // ── Self.xyz verification (required) ───────────────────
  SELF_SCOPE: z.string().min(1),
  BACKEND_URL: z.url(),
  SELF_MOCK_PASSPORT: z.string().default('false'),

  // ── Waitlist ───────────────────────────────────────────
  USER_UNTIL_WAITLIST: z.coerce.number().int().nonnegative().default(100),
  WAITLIST_RELEASE_PAUSED: z.string().default('false'),
  // Spec 056 — pause the early-access email notifier independently from
  // slot growth. When 'true', the BullMQ cron tick exits before fetching
  // candidates AND the EmailProcessor short-circuits early-access jobs
  // (defense in depth — see early-access-notifier.service.ts and
  // infrastructure/queue/email.processor.ts).
  EARLY_ACCESS_NOTIFIER_PAUSED: z.string().default('false'),

  // ── App URLs ───────────────────────────────────────────
  LENDOOR_APP_URL: z.url().default('https://lendoor.xyz'),
  LENDOOR_UNSUBSCRIBE_URL: z.string().optional(),

  // ── Redis (optional — gracefully degrades) ────────────
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional(),

  // ── Alerting ───────────────────────────────────────────
  ALERT_PHONE: z.string().optional(),
  // Phone that receives risk-model reports/alerts (falls back to ALERT_PHONE).
  RISK_ALERT_PHONE: z.string().optional(),

  // ── Logging ────────────────────────────────────────────
  LOG_LEVEL: z.string().default('info'),

  // ── Sentry (optional — only active when DSN is set) ───
  SENTRY_DSN: z.string().optional(),

  // ── Risk model (optional — gracefully degrades) ───────
  RISK_API_URL: z.url().default('http://risk-api:8000'),
  // TODO: add cross-field .superRefine() to assert RISK_API_KEY is non-empty
  // when RISK_SCORING_ENABLED === 'true'. Currently the risk service degrades
  // gracefully when the key is missing, so this is a nice-to-have.
  RISK_API_KEY: z.string().default(''),
  RISK_SCORING_ENABLED: z.string().default('false'),
  RISK_API_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .max(60_000)
    .default(10_000),

  // ── Contract tuning (all have safe defaults) ───────────
  CLM_AUTO_CLEAR_PENDING_NONCES: z.string().default('true'),
  CLM_AUTO_CLEAR_MAX_STEPS: z.coerce.number().int().positive().default(500),
  CLM_TX_CONFIRM_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  CLM_CANCEL_CONFIRM_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(60_000),
  CLM_CANCEL_FEE_MULTIPLIER: z.coerce.number().int().positive().default(4),
  CLM_CANCEL_FEE_MULTIPLIER_STEP: z.coerce.number().int().positive().default(2),
  CLM_MIN_PRIORITY_FEE_WEI: z.string().default('2000000000'),

  // ── Spec 065 — DB↔chain parity observability ──────────
  // URL to the lendoor-subgraph used by `computeDbChainDiff`. Falls back
  // to the public studio endpoint when unset (no auth needed for read).
  SUBGRAPH_URL: z
    .url()
    .default('https://api.studio.thegraph.com/query/1718667/lendoor-sub/version/latest'),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

/**
 * Parse and validate process.env. Call once at startup (main.ts).
 * Throws a human-readable error listing every invalid/missing var.
 */
export function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const issues = result.error.issues
      .map((i) => {
        const path = i.path.join('.');
        return `  ${path}: ${i.message}`;
      })
      .join('\n');

    console.error(`\n❌  Invalid environment variables:\n${issues}\n`);
    process.exit(1);
  }

  _env = result.data;
  return _env;
}

/** Access the validated env (throws if validateEnv() was not called). */
export function env(): Env {
  if (!_env) throw new Error('validateEnv() must be called before env()');
  return _env;
}
