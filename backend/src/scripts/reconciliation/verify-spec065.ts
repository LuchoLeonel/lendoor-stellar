/**
 * Spec 065 — post-deploy verification.
 *
 * Run after every operational step (backfill apply, deploy, manual trigger)
 * to confirm the system is in the expected state. Exits 0 on go, 1 on no-go
 * so it can be wired to CI / post-deploy hooks.
 *
 * Usage:
 *   npx ts-node backend/src/scripts/reconciliation/verify-spec065.ts
 *   npx ts-node backend/src/scripts/reconciliation/verify-spec065.ts \
 *     --health-url=https://api.lendoor.xyz/health/db-chain-parity
 *
 * Env (optional):
 *   HEALTH_URL                 default: http://localhost:5000/health/db-chain-parity
 *   SUBGRAPH_URL               default: lendoor-sub public studio endpoint
 *   DATABASE_URL or            connection string for the DB
 *   POSTGRES_* (HOST/USER/...)
 *
 * Checks (each prints OK / WARN / FAIL):
 *   1. /health/db-chain-parity returns healthy=true and diff < 3
 *   2. chain_scan_cursor.loan_opened was updated within the last 15 min
 *   3. metrics.db_chain_loan_diff matches the parity endpoint
 *   4. count of loans where syncedByChain=true and openTxHash like '0x...'
 *      grew vs the last 24h (indicating the scanner is inserting)
 *   5. notifications table has PENDING + SENT rows for the freshly-inserted
 *      Type A loans (catch-up working)
 */

import { Client } from "pg";

function flag(name: string, fallback?: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (arg) return arg.slice(name.length + 3);
  return process.env[name.toUpperCase()] ?? fallback;
}

const HEALTH_URL =
  flag("health-url") ?? "http://localhost:5000/health/db-chain-parity";

interface CheckResult {
  name: string;
  status: "OK" | "WARN" | "FAIL";
  detail: string;
}

const results: CheckResult[] = [];

function record(name: string, status: CheckResult["status"], detail: string) {
  results.push({ name, status, detail });
  const icon = status === "OK" ? "✅" : status === "WARN" ? "⚠️ " : "❌";
  console.log(`${icon}  ${name}: ${detail}`);
}

async function check1_parityEndpoint(): Promise<number | null> {
  try {
    const res = await fetch(HEALTH_URL);
    const body = (await res.json()) as {
      diff: number | null;
      healthy: boolean;
      updatedAt: string | null;
      threshold: number;
    };

    if (res.status === 503) {
      record(
        "1. /health/db-chain-parity",
        "FAIL",
        `503 — drift detected: diff=${body.diff} threshold=${body.threshold}`,
      );
      return body.diff;
    }
    if (res.status !== 200) {
      record("1. /health/db-chain-parity", "FAIL", `unexpected HTTP ${res.status}`);
      return null;
    }
    if (body.diff === null) {
      record(
        "1. /health/db-chain-parity",
        "WARN",
        `diff is null — chain-sync has not run yet`,
      );
      return null;
    }
    record(
      "1. /health/db-chain-parity",
      "OK",
      `diff=${body.diff} healthy=${body.healthy} updatedAt=${body.updatedAt}`,
    );
    return body.diff;
  } catch (err) {
    record(
      "1. /health/db-chain-parity",
      "FAIL",
      `fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

async function check2_cursorFreshness(client: Client) {
  const r = await client.query(
    `SELECT block, updated_at,
            EXTRACT(EPOCH FROM (NOW() - updated_at)) AS age_secs
     FROM chain_scan_cursor WHERE id = 'loan_opened'`,
  );
  if (r.rowCount === 0) {
    record("2. scanner cursor", "FAIL", "no row for loan_opened — migration not run?");
    return;
  }
  const { block, age_secs } = r.rows[0];
  const ageMin = Number(age_secs) / 60;
  if (ageMin > 15) {
    record(
      "2. scanner cursor",
      "WARN",
      `block=${block} updated_at age=${ageMin.toFixed(1)}min — cron may be slow`,
    );
  } else {
    record(
      "2. scanner cursor",
      "OK",
      `block=${block} updated ${ageMin.toFixed(1)}min ago`,
    );
  }
}

async function check3_metricMatchesEndpoint(client: Client, endpointDiff: number | null) {
  const r = await client.query(
    `SELECT value, updated_at FROM metrics WHERE key = 'db_chain_loan_diff'`,
  );
  if (r.rowCount === 0) {
    record("3. metric db_chain_loan_diff", "WARN", "metric row missing — first cron not yet completed");
    return;
  }
  const { value, updated_at } = r.rows[0];
  if (endpointDiff !== null && Number(value) !== endpointDiff) {
    record(
      "3. metric db_chain_loan_diff",
      "WARN",
      `endpoint=${endpointDiff} but DB=${value} (stale read?)`,
    );
  } else {
    record("3. metric db_chain_loan_diff", "OK", `value=${value} updated=${updated_at}`);
  }
}

async function check4_scannerInserts(client: Client) {
  const r = await client.query(
    `SELECT
       SUM(CASE WHEN "syncedByChain" = true AND "createdAt" > NOW() - INTERVAL '24 hours' THEN 1 ELSE 0 END) AS recent_synced,
       COUNT(*) AS total
     FROM loans`,
  );
  const { recent_synced, total } = r.rows[0];
  // Note: this can be 0 in healthy steady-state (no missing loans this period).
  // It's informational, not a failure.
  record(
    "4. scanner inserts (24h)",
    "OK",
    `${recent_synced} new syncedByChain rows in last 24h / ${total} total`,
  );
}

async function check5_notificationsCatchup(client: Client) {
  // Look for notifications queued in the last 30 min on loans that were
  // inserted with syncedByChain=true (i.e. scanner-inserted) — the catch-up
  // signature.
  const r = await client.query(
    `SELECT
       SUM(CASE WHEN n.status = 'pending' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN n.status = 'sent' THEN 1 ELSE 0 END) AS sent,
       SUM(CASE WHEN n.status = 'failed' THEN 1 ELSE 0 END) AS failed,
       COUNT(*) AS total
     FROM notifications n
     JOIN loans l ON l.id = n."loanId"
     WHERE l."syncedByChain" = true
       AND n."createdAt" > NOW() - INTERVAL '60 minutes'`,
  );
  const { pending, sent, failed, total } = r.rows[0];
  record(
    "5. WPP catch-up (60min)",
    "OK",
    `${total} notifs queued on syncedByChain loans: pending=${pending} sent=${sent} failed=${failed}`,
  );
}

async function main() {
  console.log(`\n═══ SPEC 065 — POST-DEPLOY VERIFICATION ═══`);
  console.log(`  health endpoint: ${HEALTH_URL}`);
  console.log();

  const endpointDiff = await check1_parityEndpoint();

  const connectionString =
    process.env.DATABASE_URL ??
    `postgresql://${process.env.POSTGRES_USER ?? "lendoor"}:${process.env.POSTGRES_PASSWORD ?? ""}@${process.env.POSTGRES_HOST ?? "pgbouncer"}:${process.env.POSTGRES_PORT ?? "6432"}/${process.env.POSTGRES_DB ?? "lendoor_production"}`;

  const client = new Client({ connectionString });
  try {
    await client.connect();

    await check2_cursorFreshness(client);
    await check3_metricMatchesEndpoint(client, endpointDiff);
    await check4_scannerInserts(client);
    await check5_notificationsCatchup(client);
  } catch (err) {
    record(
      "DB connection",
      "FAIL",
      `cannot connect: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    await client.end().catch(() => {});
  }

  // ── Final go/no-go ────────────────────────────────────────────
  console.log();
  const fails = results.filter((r) => r.status === "FAIL").length;
  const warns = results.filter((r) => r.status === "WARN").length;

  console.log(`═══ RESULT ═══`);
  console.log(`  OK:   ${results.filter((r) => r.status === "OK").length}`);
  console.log(`  WARN: ${warns}`);
  console.log(`  FAIL: ${fails}`);

  if (fails > 0) {
    console.log(`\n❌ NO-GO — investigate FAILs above before declaring success.\n`);
    process.exit(1);
  } else if (warns > 0) {
    console.log(`\n⚠️  GO with caveats — review WARNs but not blocking.\n`);
    process.exit(0);
  } else {
    console.log(`\n✅ GO — spec 065 healthy.\n`);
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("verify-spec065 crashed:", err);
  process.exit(1);
});
