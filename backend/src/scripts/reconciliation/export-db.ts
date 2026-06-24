/**
 * Phase 0 — Step 2: Export ALL loan and user data from production DB
 *
 * Usage: DATABASE_URL=postgresql://... npx ts-node backend/src/scripts/reconciliation/export-db.ts
 *
 * Or run inside the backend container:
 *   docker exec -i backend npx ts-node src/scripts/reconciliation/export-db.ts
 *
 * Outputs:
 *   - backend/src/scripts/reconciliation/output/db-loans.json
 *   - backend/src/scripts/reconciliation/output/db-users.json
 *   - backend/src/scripts/reconciliation/output/db-summary.json
 */

import { Client } from "pg";
import * as fs from "fs";
import * as path from "path";

const OUTPUT_DIR = path.join(__dirname, "output");

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Connect via pgbouncer if inside docker, or direct DATABASE_URL
  const connectionString =
    process.env.DATABASE_URL ??
    `postgresql://${process.env.POSTGRES_USER ?? "lendoor"}:${process.env.POSTGRES_PASSWORD ?? ""}@${process.env.POSTGRES_HOST ?? "pgbouncer"}:${process.env.POSTGRES_PORT ?? "6432"}/${process.env.POSTGRES_DB ?? "lendoor_production"}`;

  const client = new Client({ connectionString });
  await client.connect();

  console.log("🚀 DB export started");

  // ── Export loans ────────────────────────────────────────────
  console.log("\n📦 Exporting loans...");
  const loansResult = await client.query(`
    SELECT
      id, "userId", LOWER("borrowerAddress") as "borrowerAddress",
      principal::float, "amountDueAtOpen"::float, "amountPaid"::float,
      "tenorDays", "feeBps",
      "startAt", "dueAt", "closedAt",
      status, "repaidOnTime",
      "openTxHash", "closeTxHash",
      "syncedByChain",
      "createdAt", "updatedAt"
    FROM loans
    ORDER BY id ASC
  `);

  // ── Export users (loan-relevant fields) ─────────────────────
  console.log("👥 Exporting users...");
  const usersResult = await client.query(`
    SELECT
      id, LOWER("walletAddress") as "walletAddress",
      platform, email, score, "creditLimit"::float,
      "waitlistJoinedAt", "earlyAccessNotifiedAt",
      xp, "workType",
      "waitlistPriority",
      "riskDecision", "riskPDefault"::float, "riskClass",
      "riskScoredAt", "riskCreditLimitUsd"::float,
      "createdAt", "updatedAt"
    FROM users
    ORDER BY id ASC
  `);

  // ── Summary stats ──────────────────────────────────────────
  console.log("📊 Generating summary...");

  const summaryResult = await client.query(`
    SELECT
      COUNT(*)::int as total_loans,
      COUNT(DISTINCT "userId")::int as unique_borrowers_by_user_id,
      COUNT(DISTINCT LOWER("borrowerAddress"))::int as unique_borrowers_by_address,
      COUNT(*) FILTER (WHERE status = 'open')::int as open_loans,
      COUNT(*) FILTER (WHERE status = 'repaid_on_time')::int as repaid_on_time,
      COUNT(*) FILTER (WHERE status = 'repaid_late')::int as repaid_late,
      COUNT(*) FILTER (WHERE status = 'defaulted')::int as defaulted,
      COUNT(*) FILTER (WHERE "syncedByChain" = true)::int as synced_by_chain,
      COUNT(*) FILTER (WHERE "openTxHash" IS NOT NULL)::int as has_open_tx_hash,
      COUNT(*) FILTER (WHERE "closeTxHash" IS NOT NULL)::int as has_close_tx_hash,
      ROUND(SUM(principal)::numeric, 2)::float as total_principal,
      ROUND(SUM("amountPaid")::numeric, 2)::float as total_amount_paid,
      MIN("startAt") as earliest_loan,
      MAX("startAt") as latest_loan
    FROM loans
  `);

  const userSummaryResult = await client.query(`
    SELECT
      COUNT(*)::int as total_users,
      COUNT(*) FILTER (WHERE "waitlistJoinedAt" IS NOT NULL)::int as in_waitlist,
      COUNT(*) FILTER (WHERE "earlyAccessNotifiedAt" IS NOT NULL)::int as early_access_notified,
      COUNT(*) FILTER (WHERE "riskPDefault" IS NOT NULL)::int as has_risk_score,
      COUNT(DISTINCT u."walletAddress") FILTER (
        WHERE EXISTS (SELECT 1 FROM loans l WHERE LOWER(l."borrowerAddress") = LOWER(u."walletAddress"))
      )::int as users_with_loans
    FROM users u
  `);

  // ── Loan count per borrower (for mismatch detection) ───────
  console.log("🔍 Computing per-borrower loan counts...");
  const perBorrowerResult = await client.query(`
    SELECT
      LOWER("borrowerAddress") as address,
      COUNT(*)::int as loan_count,
      ROUND(SUM(principal)::numeric, 2)::float as total_principal,
      COUNT(*) FILTER (WHERE status = 'open')::int as open_count,
      COUNT(*) FILTER (WHERE status = 'repaid_on_time')::int as on_time_count,
      COUNT(*) FILTER (WHERE status = 'repaid_late')::int as late_count,
      COUNT(*) FILTER (WHERE status = 'defaulted')::int as default_count,
      MIN("startAt") as first_loan,
      MAX("startAt") as last_loan
    FROM loans
    GROUP BY LOWER("borrowerAddress")
    ORDER BY loan_count DESC
  `);

  // ── Write outputs ──────────────────────────────────────────
  const write = (name: string, data: unknown) => {
    const filePath = path.join(OUTPUT_DIR, `${name}.json`);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    console.log(`  ✅ ${filePath} (${Array.isArray(data) ? data.length + " rows" : "object"})`);
  };

  write("db-loans", loansResult.rows);
  write("db-users", usersResult.rows);
  write("db-borrowers-summary", perBorrowerResult.rows);
  write("db-summary", {
    exportedAt: new Date().toISOString(),
    loans: summaryResult.rows[0],
    users: userSummaryResult.rows[0],
  });

  // ── Console summary ────────────────────────────────────────
  const ls = summaryResult.rows[0];
  const us = userSummaryResult.rows[0];

  console.log("\n═══ DB EXPORT SUMMARY ═══");
  console.log(`Loans: ${ls.total_loans} (open=${ls.open_loans}, on_time=${ls.repaid_on_time}, late=${ls.repaid_late}, defaulted=${ls.defaulted})`);
  console.log(`Unique borrowers: ${ls.unique_borrowers_by_address} (by address), ${ls.unique_borrowers_by_user_id} (by userId)`);
  console.log(`Principal: $${ls.total_principal} lent, $${ls.total_amount_paid} repaid`);
  console.log(`With openTxHash: ${ls.has_open_tx_hash}/${ls.total_loans}, closeTxHash: ${ls.has_close_tx_hash}/${ls.total_loans}`);
  console.log(`SyncedByChain: ${ls.synced_by_chain}/${ls.total_loans}`);
  console.log(`Users: ${us.total_users} total, ${us.users_with_loans} with loans, ${us.has_risk_score} risk-scored`);
  console.log(`Date range: ${ls.earliest_loan} → ${ls.latest_loan}`);

  await client.end();
  console.log(`\n✅ Export complete. Files in ${OUTPUT_DIR}/`);
}

main().catch((e) => {
  console.error("❌ Export failed:", e);
  process.exit(1);
});
