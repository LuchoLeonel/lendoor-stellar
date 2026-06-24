/**
 * Spec 065 — DB ↔ chain drift backfill (extends backfill-loans.ts).
 *
 * Repairs four classes of drift detected against the subgraph:
 *
 *   Type A  — loan exists on chain, missing in DB (~55 real users after
 *             filtering testing wallets via LAUNCH_DATE=2025-12-04).
 *   Type B  — DB loan carries the wrong closeTxHash, cross-contaminated
 *             from a sibling loan of the same wallet (~13).
 *   Type B′ — closeTxHash correct but amountPaid differs from chain by
 *             a small rounding amount (~7).
 *   Type C  — DB loan has an openTxHash that doesn't correspond to any
 *             LoanOpened event on chain (~1).
 *
 * Prerequisites — run first, in this order, with prod env:
 *   npx ts-node backend/src/scripts/reconciliation/export-db.ts
 *   npx ts-node backend/src/scripts/reconciliation/export-subgraph.ts
 *   npx ts-node backend/src/scripts/reconciliation/generate-diff.ts
 *
 * Usage:
 *   DRY RUN  (default):  npx ts-node backend/src/scripts/reconciliation/backfill-loans-spec065.ts
 *   APPLY:               npx ts-node backend/src/scripts/reconciliation/backfill-loans-spec065.ts --apply
 *
 * IMPORTANT — before --apply:
 *   1. Review the dry-run output line-by-line.
 *   2. Take a snapshot of the loans table:
 *        pg_dump -t loans $DATABASE_URL > backup-pre-spec065-$(date +%s).sql
 *   3. Run with --apply.
 *   4. Re-run generate-diff.ts and confirm subgraph_count − db_count == 0
 *      for non-testing wallets.
 *
 * Post-apply: the next chain-sync cycle (≤10 min) reconciles any Type A
 * inserted as OPEN-but-actually-closed. The next notifications cron
 * (≤30 min) starts queueing WhatsApp reminders for the Type A loans that
 * are still OPEN or DEFAULTED — these users have never received a single
 * notification since their loan was never in DB.
 */

import { Client } from "pg";
import * as fs from "fs";
import * as path from "path";

const OUTPUT_DIR = path.join(__dirname, "output");
const APPLY = process.argv.includes("--apply");
const DRY_RUN = !APPLY;

// Spec 065 — extended testing cutoff. The classifier in generate-diff.ts
// marks a wallet as "real" if it has a row in the `users` table, regardless
// of whether its loans are pre-launch. Investigation found 4 wallets opened
// pre-launch (2025-11-22 → 2025-12-01) whose only on-chain loans were
// batch-defaulted by the relayer on 2026-04-27. These are testing artifacts
// — not real-user drift. We exclude them here by rejecting any candidate
// whose openedAt < LAUNCH_TS.
const LAUNCH_TS = Math.floor(new Date("2025-12-04T00:00:00Z").getTime() / 1000);

// ── Types (mirror generate-diff.ts) ─────────────────────────────

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

interface SubgraphLoan {
  id: string;
  borrower: string;
  principal: string;
  amountDue: string;
  openedAt: string;
  due: string;
  gracePeriod: string;
  status: "OPEN" | "CLOSED" | "DEFAULTED";
  closedAt: string | null;
  paid: string | null;
  tenorDays: number | null;
  sequenceNumber: number;
}

interface SubgraphActivity {
  id: string;
  type: "OPEN" | "CLOSE";
  borrower: string;
  principal: string;
  amountDue: string;
  paid: string | null;
  txHash: string;
  blockTimestamp: string;
}

interface DbLoan {
  id: number;
  userId: number;
  borrowerAddress: string;
  principal: number;
  amountPaid: number;
  status: string;
  startAt: string;
  closedAt: string | null;
  openTxHash: string | null;
  closeTxHash: string | null;
}

interface LogEntry {
  action: string;
  detail: Record<string, unknown>;
  success: boolean;
  error?: string;
}

// ── Helpers ────────────────────────────────────────────────────

function load<T>(filename: string): T {
  return JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, filename), "utf-8"));
}

function deriveStatus(
  onChainStatus: string,
  dueTs: number,
  closedAtTs: number | null,
  gracePeriodSecs = 86400,
): { status: string; repaidOnTime: boolean } {
  if (onChainStatus === "OPEN") {
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

function short(s: string | null | undefined, n = 12): string {
  if (!s) return "<null>";
  return s.slice(0, n) + "…";
}

// ── Main ───────────────────────────────────────────────────────

async function main() {
  console.log(`\n${"═".repeat(64)}`);
  console.log(
    `  SPEC 065 BACKFILL — ${DRY_RUN ? "🔍 DRY RUN" : "⚡ APPLYING"}`,
  );
  console.log(`${"═".repeat(64)}\n`);

  if (DRY_RUN) {
    console.log("  Pass --apply to actually write to the database.");
    console.log(
      "  Before --apply: pg_dump -t loans \\$DATABASE_URL > backup-pre-spec065-\\$(date +%s).sql\n",
    );
  }

  // Load data
  const missingLoans = load<MissingLoan[]>("diff-real-missing.json");
  const subgraphLoans = load<SubgraphLoan[]>("subgraph-loans.json");
  const activities = load<SubgraphActivity[]>("subgraph-loan-activities.json");
  const dbLoans = load<DbLoan[]>("db-loans.json");

  // Index everything we need ──────────────────────────────────────

  // subgraph LoanOpened events by openTxHash (Type C detection)
  const openTxHashesOnChain = new Set<string>();
  for (const a of activities) {
    if (a.type === "OPEN") openTxHashesOnChain.add(a.txHash.toLowerCase());
  }

  // subgraph loans by borrower (for Type B + Type A close lookup)
  const sgLoansByBorrower = new Map<string, SubgraphLoan[]>();
  for (const l of subgraphLoans) {
    const addr = l.borrower.toLowerCase();
    if (!sgLoansByBorrower.has(addr)) sgLoansByBorrower.set(addr, []);
    sgLoansByBorrower.get(addr)!.push(l);
  }
  // Sort each borrower's loans by openedAt asc — newest last
  for (const arr of sgLoansByBorrower.values()) {
    arr.sort((a, b) => Number(a.openedAt) - Number(b.openedAt));
  }

  // subgraph CLOSE activities by borrower (for Type A close lookup)
  const closeActsByBorrower = new Map<string, SubgraphActivity[]>();
  for (const a of activities) {
    if (a.type !== "CLOSE") continue;
    const addr = a.borrower.toLowerCase();
    if (!closeActsByBorrower.has(addr)) closeActsByBorrower.set(addr, []);
    closeActsByBorrower.get(addr)!.push(a);
  }
  for (const arr of closeActsByBorrower.values()) {
    arr.sort((a, b) => Number(a.blockTimestamp) - Number(b.blockTimestamp));
  }

  // subgraph close txHash → which subgraph Loan it belongs to (Type B)
  // Build by walking each borrower's loans: a CLOSE activity at ts T belongs to
  // the borrower's most recent loan opened before T.
  const closeTxToOwner = new Map<
    string, // closeTxHash
    { openTxHash: string; borrower: string; closedAtTs: number; paid: number }
  >();
  for (const [borrower, acts] of closeActsByBorrower) {
    const sgLoans = sgLoansByBorrower.get(borrower) ?? [];
    for (const act of acts) {
      const ts = Number(act.blockTimestamp);
      // Find sg loan opened before ts and not yet "owned" by an earlier close.
      // Simplest correct rule: each close maps to the loan with the largest
      // openedAt that is <= ts AND status indicates a close (not OPEN).
      const candidate = [...sgLoans]
        .reverse()
        .find((l) => Number(l.openedAt) <= ts);
      if (!candidate) continue;
      // Derive the openTxHash from the loan id: "loan-<openTxHash>-<logIndex>"
      const idParts = candidate.id.split("-");
      // id format: loan-<0xHASH>-<idx> → element 1 is the hash
      const openTxHash = idParts[1] ?? "";
      const paid = act.paid ? Number(act.paid) / 1e6 : 0;
      closeTxToOwner.set(act.txHash.toLowerCase(), {
        openTxHash: openTxHash.toLowerCase(),
        borrower,
        closedAtTs: ts,
        paid,
      });
    }
  }

  // db loans by openTxHash (for cross-checks)
  const dbByOpenTx = new Map<string, DbLoan>();
  for (const l of dbLoans) {
    if (l.openTxHash) dbByOpenTx.set(l.openTxHash.toLowerCase(), l);
  }

  // db loans by closeTxHash (for Type B detection).
  // Exclude all synthetic markers — these are intentional non-tx values
  // written by past specs to mark a loan closed without an on-chain
  // counterpart (spec 048 ghost auto-closes, spec 053 orphan markers, etc).
  // Treating them as "Type B drift" would un-do those intentional resolutions.
  // Heuristic: real txHashes are 0x-prefixed 66-char hex strings. Anything
  // else is synthetic.
  function isRealTxHash(h: string): boolean {
    return /^0x[0-9a-fA-F]{64}$/.test(h);
  }
  const dbByCloseTx = new Map<string, DbLoan>();
  for (const l of dbLoans) {
    if (l.closeTxHash && isRealTxHash(l.closeTxHash)) {
      dbByCloseTx.set(l.closeTxHash.toLowerCase(), l);
    }
  }

  // ── Detect Type B (closeTxHash cross-contamination) ───────────
  const typeB: Array<{ dbLoan: DbLoan; reason: string }> = [];
  for (const [closeTxHash, dbLoan] of dbByCloseTx) {
    const owner = closeTxToOwner.get(closeTxHash);
    if (!owner) {
      // closeTxHash in DB but no matching CLOSE event in subgraph.
      // This means the closeTxHash is fabricated or stale — treat as Type C-ish.
      typeB.push({
        dbLoan,
        reason: "close_tx_not_in_subgraph",
      });
      continue;
    }
    const dbOpenTx = (dbLoan.openTxHash ?? "").toLowerCase();
    if (dbOpenTx !== owner.openTxHash) {
      // The close belongs to a DIFFERENT loan of the same wallet (or wrong wallet).
      typeB.push({
        dbLoan,
        reason: `close_belongs_to_open_${owner.openTxHash}_not_${dbOpenTx}`,
      });
    }
  }

  // ── Detect Type B′ (amountPaid mismatch on otherwise-healthy rows) ──
  const typeBp: Array<{
    dbLoan: DbLoan;
    chainPaid: number;
    diff: number;
  }> = [];
  for (const [closeTxHash, dbLoan] of dbByCloseTx) {
    const owner = closeTxToOwner.get(closeTxHash);
    if (!owner) continue;
    // Only check rows where the close + open both match (i.e. NOT in typeB)
    const dbOpenTx = (dbLoan.openTxHash ?? "").toLowerCase();
    if (dbOpenTx !== owner.openTxHash) continue;
    const diff = Math.abs(dbLoan.amountPaid - owner.paid);
    if (diff > 0.005) {
      // Half-cent threshold to ignore floating point noise
      typeBp.push({ dbLoan, chainPaid: owner.paid, diff });
    }
  }

  // ── Detect Type C (openTxHash invalid) ────────────────────────
  const typeC: Array<{ dbLoan: DbLoan }> = [];
  for (const dbLoan of dbLoans) {
    if (!dbLoan.openTxHash) continue;
    if (dbLoan.openTxHash.startsWith("SYNTHETIC")) continue;
    if (!openTxHashesOnChain.has(dbLoan.openTxHash.toLowerCase())) {
      typeC.push({ dbLoan });
    }
  }

  console.log(`── Detection results ───────────────────────────────`);
  console.log(`  Type A  (missing in DB):           ${missingLoans.length}`);
  console.log(`  Type B  (cross-contaminated):      ${typeB.length}`);
  console.log(`  Type B′ (amountPaid mismatch):     ${typeBp.length}`);
  console.log(`  Type C  (invalid openTxHash):      ${typeC.length}`);
  console.log();

  // ── Connect to DB ─────────────────────────────────────────────
  const connectionString =
    process.env.DATABASE_URL ??
    `postgresql://${process.env.POSTGRES_USER ?? "lendoor"}:${process.env.POSTGRES_PASSWORD ?? ""}@${process.env.POSTGRES_HOST ?? "pgbouncer"}:${process.env.POSTGRES_PORT ?? "6432"}/${process.env.POSTGRES_DB ?? "lendoor_production"}`;

  const client = new Client({ connectionString });
  await client.connect();

  const log: LogEntry[] = [];

  // ─── Part 1: Insert Type A missing loans ───────────────────────
  console.log(`── Part 1: Insert ${missingLoans.length} Type A loans ──\n`);

  let aInserted = 0;
  let aSkipped = 0;
  let aSkippedPreLaunch = 0;

  for (const loan of missingLoans) {
    const borrowerLoans = sgLoansByBorrower.get(loan.borrower.toLowerCase()) ?? [];
    const sgLoan = borrowerLoans.find(
      (l) => Math.abs(Number(l.openedAt) - Number(loan.timestamp)) < 60,
    );

    if (!sgLoan) {
      console.log(`  ⚠️  No matching subgraph loan for tx ${short(loan.txHash)}`);
      log.push({
        action: "A_skip_no_match",
        detail: { txHash: loan.txHash, borrower: loan.borrower },
        success: false,
        error: "no matching subgraph loan",
      });
      aSkipped++;
      continue;
    }

    // Spec 065 — extended testing filter: skip pre-launch loans that
    // generate-diff's classifier missed because the wallet has a DB user
    // entry. These are launch-period testing artifacts (4 known historical
    // cases, all batch-defaulted by relayer 2026-04-27, total $7 principal).
    if (Number(sgLoan.openedAt) < LAUNCH_TS) {
      console.log(
        `  🔬 Skipping pre-launch (testing-extended): ${short(loan.borrower, 10)} | opened ${new Date(Number(sgLoan.openedAt) * 1000).toISOString().slice(0, 10)} | tx=${short(loan.txHash)}`,
      );
      log.push({
        action: "A_skip_pre_launch",
        detail: {
          txHash: loan.txHash,
          borrower: loan.borrower,
          openedAt: sgLoan.openedAt,
          reason: "pre-launch testing artifact, excluded by spec 065",
        },
        success: true,
      });
      aSkippedPreLaunch++;
      continue;
    }

    // Idempotency — already in DB?
    const existing = await client.query(
      `SELECT id FROM loans WHERE "openTxHash" = $1`,
      [loan.txHash],
    );
    if (existing.rows.length > 0) {
      console.log(`  ⏭  Already in DB: tx ${short(loan.txHash)} (id=${existing.rows[0].id})`);
      log.push({
        action: "A_skip_exists",
        detail: { txHash: loan.txHash, existingId: existing.rows[0].id },
        success: true,
      });
      aSkipped++;
      continue;
    }

    const principal = Number(sgLoan.principal) / 1e6;
    const amountDue = Number(sgLoan.amountDue) / 1e6;
    const openedAtTs = Number(sgLoan.openedAt);
    const dueTs = Number(sgLoan.due);
    const closedAtTs = sgLoan.closedAt ? Number(sgLoan.closedAt) : null;
    const tenorDays = sgLoan.tenorDays ?? Math.round((dueTs - openedAtTs) / 86400);
    const feeBps = deriveFeeBps(principal, amountDue);
    const gracePeriod = sgLoan.gracePeriod ? Number(sgLoan.gracePeriod) : 86400;

    const { status, repaidOnTime } = deriveStatus(
      sgLoan.status,
      dueTs,
      closedAtTs,
      gracePeriod,
    );

    // Find close txHash + paid from activities (chain truth)
    let closeTxHash: string | null = null;
    let amountPaid = 0;
    if (closedAtTs) {
      const closeActs = closeActsByBorrower.get(loan.borrower.toLowerCase()) ?? [];
      const closeAct = closeActs.find(
        (a) => Math.abs(Number(a.blockTimestamp) - closedAtTs) < 60,
      );
      closeTxHash = closeAct?.txHash ?? null;
      amountPaid = closeAct?.paid ? Number(closeAct.paid) / 1e6 : 0;
    }

    const startAt = new Date(openedAtTs * 1000).toISOString();
    const dueAt = new Date(dueTs * 1000).toISOString();
    const closedAt = closedAtTs ? new Date(closedAtTs * 1000).toISOString() : null;

    console.log(
      `  ${DRY_RUN ? "🔍" : "✅"} ${short(loan.borrower, 10)} | $${principal} | ${tenorDays}d | ${status} | open=${short(loan.txHash)} close=${short(closeTxHash)}`,
    );

    if (!DRY_RUN) {
      try {
        // Note: no ON CONFLICT clause. The `idx_loans_open_tx_hash_unique`
        // index is partial (WHERE openTxHash IS NOT NULL) so ON CONFLICT
        // ("openTxHash") doesn't match it implicitly. Duplicate-protection
        // comes from the explicit SELECT check above (the `existing` row
        // fetch). The partial unique index still protects against races at
        // the DB layer — if two scanners race on the same txHash, postgres
        // raises a 23505 which we'd surface to the caller.
        await client.query(
          `INSERT INTO loans (
            "userId", "borrowerAddress", principal, "amountDueAtOpen", "amountPaid",
            "tenorDays", "feeBps", "startAt", "dueAt", "closedAt",
            status, "repaidOnTime", "openTxHash", "closeTxHash",
            "syncedByChain", "createdAt", "updatedAt"
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW(),NOW())`,
          [
            loan.userId, loan.borrower.toLowerCase(), principal, amountDue, amountPaid,
            tenorDays, feeBps, startAt, dueAt, closedAt,
            status, repaidOnTime, loan.txHash, closeTxHash,
            true,
          ],
        );
        aInserted++;
        log.push({
          action: "A_insert",
          detail: {
            txHash: loan.txHash,
            borrower: loan.borrower,
            principal,
            status,
            tenorDays,
            closeTxHash,
            amountPaid,
          },
          success: true,
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`  ❌ INSERT failed for ${short(loan.txHash)}: ${msg}`);
        log.push({
          action: "A_insert",
          detail: { txHash: loan.txHash },
          success: false,
          error: msg,
        });
      }
    } else {
      aInserted++;
      log.push({
        action: "A_dryrun",
        detail: {
          txHash: loan.txHash,
          borrower: loan.borrower,
          principal,
          status,
          tenorDays,
          closeTxHash,
          amountPaid,
        },
        success: true,
      });
    }
  }

  console.log(
    `\n  Result: ${aInserted} ${DRY_RUN ? "would be" : ""} inserted, ${aSkipped} skipped, ${aSkippedPreLaunch} pre-launch testing-extended\n`,
  );

  // ─── Part 2: Fix Type B (cross-contaminated closeTxHash) ────────
  console.log(`── Part 2: Fix ${typeB.length} Type B loans (NULL closeTxHash + reset) ──\n`);

  let bFixed = 0;

  for (const { dbLoan, reason } of typeB) {
    console.log(
      `  ${DRY_RUN ? "🔍" : "✅"} loanId=${dbLoan.id} ${short(dbLoan.borrowerAddress, 10)} | ` +
        `status=${dbLoan.status} closeTx=${short(dbLoan.closeTxHash)} → NULL | ${reason}`,
    );

    if (!DRY_RUN) {
      try {
        // Reset: NULL out close fields + revert status to OPEN.
        // Next chain-sync cycle (with spec 043 guards) reconciles correctly,
        // since the rightful owner of the closeTxHash is now in DB (Part 1).
        // Idempotent: WHERE clause skips rows already cleared (closeTxHash IS NULL).
        await client.query(
          `UPDATE loans SET
             "closeTxHash" = NULL,
             "closedAt" = NULL,
             "amountPaid" = 0,
             "repaidOnTime" = false,
             status = 'open',
             "syncedByChain" = false,
             "updatedAt" = NOW()
           WHERE id = $1 AND "closeTxHash" IS NOT NULL`,
          [dbLoan.id],
        );
        bFixed++;
        log.push({
          action: "B_clear",
          detail: { loanId: dbLoan.id, prevCloseTx: dbLoan.closeTxHash, reason },
          success: true,
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`  ❌ Type B clear failed for loanId=${dbLoan.id}: ${msg}`);
        log.push({
          action: "B_clear",
          detail: { loanId: dbLoan.id },
          success: false,
          error: msg,
        });
      }
    } else {
      bFixed++;
      log.push({
        action: "B_dryrun_clear",
        detail: { loanId: dbLoan.id, prevCloseTx: dbLoan.closeTxHash, reason },
        success: true,
      });
    }
  }

  console.log(`\n  Result: ${bFixed} ${DRY_RUN ? "would be" : ""} cleared\n`);

  // ─── Part 3: Fix Type B′ (amountPaid mismatch) ────────────────
  console.log(`── Part 3: Fix ${typeBp.length} Type B′ loans (UPDATE amountPaid) ──\n`);

  let bpFixed = 0;

  for (const { dbLoan, chainPaid, diff } of typeBp) {
    console.log(
      `  ${DRY_RUN ? "🔍" : "✅"} loanId=${dbLoan.id} ${short(dbLoan.borrowerAddress, 10)} | ` +
        `paid: $${dbLoan.amountPaid} → $${chainPaid} (Δ=$${diff.toFixed(4)})`,
    );

    if (!DRY_RUN) {
      try {
        await client.query(
          `UPDATE loans SET
             "amountPaid" = $1,
             "syncedByChain" = true,
             "updatedAt" = NOW()
           WHERE id = $2`,
          [chainPaid, dbLoan.id],
        );
        bpFixed++;
        log.push({
          action: "Bprime_update",
          detail: { loanId: dbLoan.id, from: dbLoan.amountPaid, to: chainPaid, diff },
          success: true,
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`  ❌ Type B′ update failed for loanId=${dbLoan.id}: ${msg}`);
        log.push({
          action: "Bprime_update",
          detail: { loanId: dbLoan.id },
          success: false,
          error: msg,
        });
      }
    } else {
      bpFixed++;
      log.push({
        action: "Bprime_dryrun",
        detail: { loanId: dbLoan.id, from: dbLoan.amountPaid, to: chainPaid, diff },
        success: true,
      });
    }
  }

  console.log(`\n  Result: ${bpFixed} ${DRY_RUN ? "would be" : ""} updated\n`);

  // ─── Part 4: Log Type C (invalid openTxHash) — NO AUTO-FIX ─────
  console.log(`── Part 4: Type C cases — logged for manual review (NO auto-fix) ──\n`);

  for (const { dbLoan } of typeC) {
    console.log(
      `  ⚠️  loanId=${dbLoan.id} ${short(dbLoan.borrowerAddress, 10)} | ` +
        `openTx=${short(dbLoan.openTxHash)} not found on chain | status=${dbLoan.status} principal=$${dbLoan.principal}`,
    );
    log.push({
      action: "C_manual_review",
      detail: {
        loanId: dbLoan.id,
        borrower: dbLoan.borrowerAddress,
        openTxHash: dbLoan.openTxHash,
        status: dbLoan.status,
        principal: dbLoan.principal,
      },
      success: false,
      error: "openTxHash not present on chain — needs manual investigation",
    });
  }

  // ─── Write log file ───────────────────────────────────────────
  const logFile = path.join(
    OUTPUT_DIR,
    `backfill-spec065-${DRY_RUN ? "dry" : "apply"}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  );
  fs.writeFileSync(logFile, JSON.stringify(log, null, 2));

  await client.end();

  // ─── Summary ──────────────────────────────────────────────────
  console.log(`\n${"═".repeat(64)}`);
  console.log(`  SUMMARY — ${DRY_RUN ? "🔍 DRY RUN" : "⚡ APPLIED"}`);
  console.log(`${"═".repeat(64)}`);
  console.log(
    `  Type A  (insert):           ${aInserted} ${DRY_RUN ? "would be" : ""} inserted, ${aSkipped} skipped, ${aSkippedPreLaunch} pre-launch (testing-extended)`,
  );
  console.log(`  Type B  (clear closeTx):    ${bFixed} ${DRY_RUN ? "would be" : ""} cleared`);
  console.log(`  Type B′ (fix amountPaid):   ${bpFixed} ${DRY_RUN ? "would be" : ""} updated`);
  console.log(`  Type C  (manual review):    ${typeC.length} logged`);
  console.log(`  Log file: ${logFile}`);
  console.log(`${"═".repeat(64)}\n`);

  if (DRY_RUN) {
    console.log("👉 Review the log file. If correct, re-run with --apply.\n");
  } else {
    console.log("✅ Applied. Next: re-run generate-diff.ts and confirm drift=0.\n");
    console.log(
      "   The next chain-sync cycle (≤10 min) will refine any Type A inserted as OPEN\n" +
        "   but actually closed (close events landing on the rightful row). The next\n" +
        "   notifications cron (≤30 min) will start sending WhatsApp reminders for the\n" +
        "   Type A users who never received any (currently OPEN past-due or DEFAULTED).\n",
    );
  }
}

main().catch((e) => {
  console.error("❌ Spec 065 backfill failed:", e);
  process.exit(1);
});
