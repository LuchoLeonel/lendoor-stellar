/**
 * Phase 2 — Backfill missing loans from subgraph into DB
 *
 * Prerequisites: run export-subgraph.ts, export-db.ts, and generate-diff.ts first
 *
 * Usage:
 *   DRY RUN (default):  npx ts-node backend/src/scripts/reconciliation/backfill-loans.ts
 *   EXECUTE:            npx ts-node backend/src/scripts/reconciliation/backfill-loans.ts --execute
 *
 * What it does:
 *   1. Reads diff-real-missing.json (loans on-chain but not in DB)
 *   2. Reads diff-status-mismatches.json (Bucket B: DB says defaulted but on-chain says CLOSED)
 *   3. For missing loans: INSERTs new loan records
 *   4. For Bucket B: UPDATEs status from defaulted to repaid_late
 *   5. Writes a detailed log of everything it did
 */

import { Client } from "pg";
import * as fs from "fs";
import * as path from "path";

const OUTPUT_DIR = path.join(__dirname, "output");
const DRY_RUN = !process.argv.includes("--execute");

// ── Types ────────────────────────────────────────────────────

interface MissingLoan {
  borrower: string;
  userId: number;
  txHash: string;
  principal: number;
  amountDue: number;
  timestamp: string;
  date: string;
  onChainStatus: "OPEN" | "CLOSED" | "DEFAULTED";
  tenorDays: number | null;
  closedAt: string | null;
}

interface StatusMismatch {
  dbLoanId: number;
  borrowerAddress: string;
  dbStatus: string;
  onChainStatus: string;
  dbStartAt: string;
  principal: number;
  daysSinceStart: number;
}

interface SubgraphLoan {
  id: string;
  borrower: string;
  principal: string;
  amountDue: string;
  openedAt: string;
  due: string;
  gracePeriod: string;
  status: string;
  closedAt: string | null;
  paid: string | null;
  tenorDays: number | null;
  sequenceNumber: number;
}

interface SubgraphActivity {
  id: string;
  type: string;
  borrower: string;
  principal: string;
  amountDue: string;
  paid: string | null;
  txHash: string;
  blockTimestamp: string;
}

// ── Helpers ──────────────────────────────────────────────────

function load<T>(filename: string): T {
  return JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, filename), "utf-8"));
}

function deriveStatus(
  onChainStatus: string,
  openedAtTs: number,
  dueTs: number,
  closedAtTs: number | null,
  gracePeriodSecs = 86400,
): { status: string; repaidOnTime: boolean } {
  if (onChainStatus === "OPEN") {
    // Check if it should be defaulted (past due + grace + 15 days)
    const now = Math.floor(Date.now() / 1000);
    const defaultThreshold = dueTs + gracePeriodSecs + 15 * 86400;
    if (now > defaultThreshold) {
      return { status: "defaulted", repaidOnTime: false };
    }
    return { status: "open", repaidOnTime: false };
  }

  if (onChainStatus === "CLOSED" && closedAtTs) {
    const onTime = closedAtTs <= dueTs + gracePeriodSecs;
    return {
      status: onTime ? "repaid_on_time" : "repaid_late",
      repaidOnTime: onTime,
    };
  }

  return { status: "defaulted", repaidOnTime: false };
}

function deriveFeeBps(principal: number, amountDue: number): number {
  if (principal <= 0) return 0;
  return Math.round(((amountDue - principal) / principal) * 10000);
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  BACKFILL SCRIPT — ${DRY_RUN ? "🔍 DRY RUN" : "⚡ EXECUTING"}`);
  console.log(`${"=".repeat(60)}\n`);

  if (DRY_RUN) {
    console.log("  Pass --execute to actually write to the database.\n");
  }

  // Load data
  const missingLoans = load<MissingLoan[]>("diff-real-missing.json");
  const statusMismatches = load<{
    bucketA_defaulted_still_open: StatusMismatch[];
    bucketB_defaulted_but_repaid: StatusMismatch[];
    bucketC_open_but_closed: StatusMismatch[];
  }>("diff-status-mismatches.json");
  const subgraphLoans = load<SubgraphLoan[]>("subgraph-loans.json");
  const activities = load<SubgraphActivity[]>("subgraph-loan-activities.json");

  // Index subgraph data for lookups
  const sgLoansByBorrower = new Map<string, SubgraphLoan[]>();
  for (const l of subgraphLoans) {
    const addr = l.borrower.toLowerCase();
    if (!sgLoansByBorrower.has(addr)) sgLoansByBorrower.set(addr, []);
    sgLoansByBorrower.get(addr)!.push(l);
  }

  const closeActivitiesByBorrower = new Map<string, SubgraphActivity[]>();
  for (const a of activities) {
    if (a.type !== "CLOSE") continue;
    const addr = a.borrower.toLowerCase();
    if (!closeActivitiesByBorrower.has(addr)) closeActivitiesByBorrower.set(addr, []);
    closeActivitiesByBorrower.get(addr)!.push(a);
  }

  console.log(`Missing loans to backfill: ${missingLoans.length}`);
  console.log(`Bucket B (defaulted→repaid) to fix: ${statusMismatches.bucketB_defaulted_but_repaid.length}`);

  // Connect to DB
  const connectionString =
    process.env.DATABASE_URL ??
    `postgresql://${process.env.POSTGRES_USER ?? "lendoor"}:${process.env.POSTGRES_PASSWORD ?? ""}@${process.env.POSTGRES_HOST ?? "pgbouncer"}:${process.env.POSTGRES_PORT ?? "6432"}/${process.env.POSTGRES_DB ?? "lendoor_production"}`;

  const client = new Client({ connectionString });
  await client.connect();

  const log: Array<{ action: string; detail: Record<string, unknown>; success: boolean; error?: string }> = [];

  // ─── Part 1: Backfill missing loans ────────────────────────
  console.log(`\n── Part 1: Backfill ${missingLoans.length} missing loans ──\n`);

  let insertedCount = 0;
  let skippedCount = 0;

  for (const loan of missingLoans) {
    // Find the matching subgraph loan for full data
    const borrowerLoans = sgLoansByBorrower.get(loan.borrower.toLowerCase()) ?? [];
    const sgLoan = borrowerLoans.find(
      (l) => Math.abs(Number(l.openedAt) - Number(loan.timestamp)) < 60,
    );

    if (!sgLoan) {
      console.log(`  ⚠️  No matching subgraph loan for tx ${loan.txHash.slice(0, 12)}...`);
      log.push({ action: "skip_no_match", detail: { txHash: loan.txHash, borrower: loan.borrower }, success: false, error: "no matching subgraph loan" });
      skippedCount++;
      continue;
    }

    // Check for duplicate by txHash
    const existing = await client.query(
      `SELECT id FROM loans WHERE "openTxHash" = $1`,
      [loan.txHash],
    );
    if (existing.rows.length > 0) {
      console.log(`  ⏭  Already exists: tx ${loan.txHash.slice(0, 12)}... (loan id=${existing.rows[0].id})`);
      log.push({ action: "skip_duplicate", detail: { txHash: loan.txHash, existingId: existing.rows[0].id }, success: true });
      skippedCount++;
      continue;
    }

    // Derive fields
    const principal = Number(sgLoan.principal) / 1e6;
    const amountDue = Number(sgLoan.amountDue) / 1e6;
    const openedAtTs = Number(sgLoan.openedAt);
    const dueTs = Number(sgLoan.due);
    const closedAtTs = sgLoan.closedAt ? Number(sgLoan.closedAt) : null;
    const paidAmount = sgLoan.paid ? Number(sgLoan.paid) / 1e6 : 0;
    const tenorDays = sgLoan.tenorDays ?? Math.round((dueTs - openedAtTs) / 86400);
    const feeBps = deriveFeeBps(principal, amountDue);
    const gracePeriod = sgLoan.gracePeriod ? Number(sgLoan.gracePeriod) : 86400;

    const { status, repaidOnTime } = deriveStatus(sgLoan.status, openedAtTs, dueTs, closedAtTs, gracePeriod);

    // Find close txHash if closed
    let closeTxHash: string | null = null;
    if (closedAtTs) {
      const closeActs = closeActivitiesByBorrower.get(loan.borrower.toLowerCase()) ?? [];
      const closeAct = closeActs.find(
        (a) => Math.abs(Number(a.blockTimestamp) - closedAtTs) < 60,
      );
      closeTxHash = closeAct?.txHash ?? null;
    }

    const startAt = new Date(openedAtTs * 1000).toISOString();
    const dueAt = new Date(dueTs * 1000).toISOString();
    const closedAt = closedAtTs ? new Date(closedAtTs * 1000).toISOString() : null;

    console.log(
      `  ${DRY_RUN ? "🔍" : "✅"} ${loan.borrower.slice(0, 10)}... | $${principal} | ${tenorDays}d | ${status} | tx=${loan.txHash.slice(0, 12)}...`,
    );

    if (!DRY_RUN) {
      try {
        await client.query(
          `INSERT INTO loans (
            "userId", "borrowerAddress", principal, "amountDueAtOpen", "amountPaid",
            "tenorDays", "feeBps", "startAt", "dueAt", "closedAt",
            status, "repaidOnTime", "openTxHash", "closeTxHash",
            "syncedByChain", "createdAt", "updatedAt"
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW(),NOW())
          ON CONFLICT DO NOTHING`,
          [
            loan.userId, loan.borrower, principal, amountDue, paidAmount,
            tenorDays, feeBps, startAt, dueAt, closedAt,
            status, repaidOnTime, loan.txHash, closeTxHash,
            true, // syncedByChain = true (sourced from chain)
          ],
        );
        insertedCount++;
        log.push({ action: "insert", detail: { txHash: loan.txHash, borrower: loan.borrower, principal, status }, success: true });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`  ❌ INSERT failed: ${msg}`);
        log.push({ action: "insert", detail: { txHash: loan.txHash }, success: false, error: msg });
      }
    } else {
      insertedCount++;
      log.push({ action: "dry_run_insert", detail: { txHash: loan.txHash, borrower: loan.borrower, principal, status, tenorDays, feeBps }, success: true });
    }
  }

  console.log(`\nPart 1 result: ${insertedCount} ${DRY_RUN ? "would be" : ""} inserted, ${skippedCount} skipped`);

  // ─── Part 2: Fix Bucket B (defaulted → repaid) ────────────
  const bucketB = statusMismatches.bucketB_defaulted_but_repaid;
  console.log(`\n── Part 2: Fix ${bucketB.length} Bucket B loans (defaulted → repaid) ──\n`);

  let updatedCount = 0;

  for (const mismatch of bucketB) {
    // Find the close event on-chain
    const closeActs = closeActivitiesByBorrower.get(mismatch.borrowerAddress.toLowerCase()) ?? [];

    // Find closest close activity to the loan's start date
    const dbStartTs = Math.floor(new Date(mismatch.dbStartAt).getTime() / 1000);
    const closeAct = closeActs.find(
      (a) => Number(a.blockTimestamp) > dbStartTs,
    );

    const paidAmount = closeAct?.paid ? Number(closeAct.paid) / 1e6 : mismatch.principal;
    const closeTxHash = closeAct?.txHash ?? null;
    const closedAtTs = closeAct ? Number(closeAct.blockTimestamp) : null;
    const closedAt = closedAtTs ? new Date(closedAtTs * 1000).toISOString() : null;

    // Find corresponding subgraph loan for due date
    const sgLoans = sgLoansByBorrower.get(mismatch.borrowerAddress.toLowerCase()) ?? [];
    const sgLoan = sgLoans.find(
      (l) => Math.abs(Number(l.openedAt) - dbStartTs) < 120,
    );
    const dueTs = sgLoan ? Number(sgLoan.due) : 0;
    const gracePeriod = sgLoan?.gracePeriod ? Number(sgLoan.gracePeriod) : 86400;

    let newStatus = "repaid_late"; // default for defaulted→closed
    let repaidOnTime = false;
    if (closedAtTs && dueTs) {
      repaidOnTime = closedAtTs <= dueTs + gracePeriod;
      newStatus = repaidOnTime ? "repaid_on_time" : "repaid_late";
    }

    console.log(
      `  ${DRY_RUN ? "🔍" : "✅"} loan #${mismatch.dbLoanId} | ${mismatch.borrowerAddress.slice(0, 10)}... | defaulted → ${newStatus} | paid=$${paidAmount}`,
    );

    if (!DRY_RUN) {
      try {
        await client.query(
          `UPDATE loans SET
            status = $1, "repaidOnTime" = $2, "amountPaid" = $3,
            "closedAt" = $4, "closeTxHash" = $5, "syncedByChain" = true,
            "updatedAt" = NOW()
          WHERE id = $6 AND status = 'defaulted'`,
          [newStatus, repaidOnTime, paidAmount, closedAt, closeTxHash, mismatch.dbLoanId],
        );
        updatedCount++;
        log.push({ action: "update_bucket_b", detail: { loanId: mismatch.dbLoanId, from: "defaulted", to: newStatus, paidAmount }, success: true });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`  ❌ UPDATE failed: ${msg}`);
        log.push({ action: "update_bucket_b", detail: { loanId: mismatch.dbLoanId }, success: false, error: msg });
      }
    } else {
      updatedCount++;
      log.push({ action: "dry_run_update_bucket_b", detail: { loanId: mismatch.dbLoanId, from: "defaulted", to: newStatus, paidAmount, closedAt }, success: true });
    }
  }

  console.log(`\nPart 2 result: ${updatedCount} ${DRY_RUN ? "would be" : ""} updated`);

  // ─── Write log ─────────────────────────────────────────────
  const logFile = path.join(OUTPUT_DIR, `backfill-log-${DRY_RUN ? "dry" : "exec"}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(logFile, JSON.stringify(log, null, 2));

  await client.end();

  // ─── Summary ───────────────────────────────────────────────
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  BACKFILL SUMMARY — ${DRY_RUN ? "🔍 DRY RUN" : "⚡ EXECUTED"}`);
  console.log(`${"=".repeat(60)}`);
  console.log(`  Missing loans:  ${insertedCount} ${DRY_RUN ? "would be" : ""} inserted, ${skippedCount} skipped`);
  console.log(`  Bucket B fixes: ${updatedCount} ${DRY_RUN ? "would be" : ""} updated (defaulted → repaid)`);
  console.log(`  Log: ${logFile}`);
  console.log(`${"=".repeat(60)}\n`);

  if (DRY_RUN) {
    console.log("👉 Review the log, then run with --execute to apply changes.");
  }
}

main().catch((e) => {
  console.error("❌ Backfill failed:", e);
  process.exit(1);
});
