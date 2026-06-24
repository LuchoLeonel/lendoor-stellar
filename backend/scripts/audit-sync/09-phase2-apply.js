#!/usr/bin/env node
/**
 * Spec 019 Phase 2 apply — backfill the 8 Group B loans.
 *
 * Unlike Phase 1 (which only filled in the missing `closeTxHash`),
 * Phase 2 rows need more fields corrected because the backend wrote
 * bad data for them at repayment time:
 *
 *   - `amountPaid`    = $0  (chain says otherwise)
 *   - `closedAt`      = server time, drifted 37–149 s from chain
 *   - `closeTxHash`   = NULL
 *   - `syncedByChain` = false
 *
 * Fix per loan:
 *
 *   1. Pick the latest LoanClosed event whose block.timestamp is
 *      ≤ db.closedAt + 5 s ("latest event before or at DB closedAt").
 *      Events after that cutoff belong to a *different* loan the
 *      same wallet opened and closed shortly afterwards — we must
 *      NOT sum them into this loan's amountPaid.
 *   2. UPDATE:
 *        closeTxHash   := chosen event.tx
 *        amountPaid    := chosen event.paid                     (from chain)
 *        closedAt      := chosen event.block.timestamp          (from chain)
 *        syncedByChain := true
 *        repaidOnTime  := new closedAt ≤ dueAt + 24h grace
 *        status        := repaid_on_time if repaidOnTime else repaid_late
 *
 * Guards:
 *   - Transaction with BEGIN…COMMIT. Dry-run by default (ROLLBACK).
 *     APPLY=1 commits.
 *   - WHERE closeTxHash IS NULL AND id = $1 per statement (idempotent).
 *   - Every UPDATE must affect exactly 1 row, otherwise ROLLBACK.
 *   - Defence-in-depth: re-read each row FOR UPDATE inside the tx and
 *     assert closeTxHash is still NULL before updating.
 *   - Before/after snapshot per loan in execution-log artifact.
 *
 * Inputs:
 *   SCAN_JSON         required; path to event-scan-YYYY-MM-DD.json
 *                     from 06-verify-null-txhash.js
 *   APPLY             "1" to commit; anything else = dry-run
 *   POSTGRES_PASSWORD / DATABASE_URL — as usual
 *   OUTPUT_PATH       optional; default
 *                     /tmp/phase2-execution-log-YYYY-MM-DD{.dry-run}.json
 *
 * Exit codes:
 *   0  success (COMMIT with APPLY=1, or dry-run all-green)
 *   1  bad input / preflight
 *   2  any UPDATE mismatch during tx → ROLLBACK + abort
 *   3  unexpected error
 */

'use strict';

const fs = require('fs');
const { Client } = require('pg');

const SCAN_JSON = process.env.SCAN_JSON;
if (!SCAN_JSON) {
  console.error('FATAL: SCAN_JSON env var required');
  process.exit(1);
}
if (!fs.existsSync(SCAN_JSON)) {
  console.error(`FATAL: SCAN_JSON not found at ${SCAN_JSON}`);
  process.exit(1);
}

const APPLY = process.env.APPLY === '1';
const GRACE_MS = 24 * 60 * 60 * 1000;
const MAX_CLOSEDAT_LOOKAHEAD_SEC = 5; // events after closedAt + 5s are NOT this loan's

function today() {
  return new Date().toISOString().slice(0, 10);
}

const OUTPUT_PATH =
  process.env.OUTPUT_PATH ||
  (APPLY
    ? `/tmp/phase2-execution-log-${today()}.json`
    : `/tmp/phase2-execution-log-${today()}.dry-run.json`);

function buildConnString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const user = process.env.POSTGRES_USER || 'lendoor';
  const pw = process.env.POSTGRES_PASSWORD;
  const host = process.env.POSTGRES_HOST || 'pgbouncer';
  const port = process.env.POSTGRES_PORT || '6432';
  const db = process.env.POSTGRES_DB || 'lendoor_production';
  if (!pw) {
    console.error(
      'FATAL: neither DATABASE_URL nor POSTGRES_PASSWORD is set.',
    );
    process.exit(1);
  }
  return `postgresql://${user}:${pw}@${host}:${port}/${db}`;
}

function parseIsoToUnix(iso) {
  return Math.floor(new Date(iso).getTime() / 1000);
}

/**
 * Given DB closedAt and events_in_window (array with {tx, block, ts, tsUnix, paid}),
 * pick the LATEST event whose block.timestamp ≤ db.closedAt + MAX_CLOSEDAT_LOOKAHEAD_SEC.
 * Returns null if no event qualifies.
 */
function pickClosingEvent(dbClosedAtIso, events) {
  const cutoff = parseIsoToUnix(dbClosedAtIso) + MAX_CLOSEDAT_LOOKAHEAD_SEC;
  const eligible = events.filter((e) => {
    const ts = e.tsUnix ?? parseIsoToUnix(e.ts);
    return ts <= cutoff;
  });
  if (eligible.length === 0) return null;
  eligible.sort((a, b) => (a.tsUnix ?? parseIsoToUnix(a.ts)) - (b.tsUnix ?? parseIsoToUnix(b.ts)));
  return eligible[eligible.length - 1];
}

(async () => {
  const scan = JSON.parse(fs.readFileSync(SCAN_JSON, 'utf8'));
  // Phase 2 scope: every row in the scan (all 8 are Group B). Filter
  // defensively to drop any row that now already has a closeTxHash in
  // DB (set between scan and apply).
  const candidates = scan.results;
  console.log(
    `Phase 2 apply — ${candidates.length} candidates, mode=${APPLY ? 'APPLY' : 'DRY-RUN'}`,
  );
  console.log(`Scan source: ${SCAN_JSON} (ran ${scan.runTs})\n`);

  const c = new Client({ connectionString: buildConnString() });
  await c.connect();

  const perLoan = [];
  let totalAffected = 0;
  let errored = false;
  let abortReason = '';

  try {
    await c.query('BEGIN');

    for (const r of candidates) {
      const loanId = r.id;
      const events = r.events_in_window || [];
      const dbClosedAtIso = r.db_closedAt;

      const chosen = pickClosingEvent(dbClosedAtIso, events);
      if (!chosen) {
        abortReason = `loan=${loanId} has no event with block.ts ≤ db.closedAt + ${MAX_CLOSEDAT_LOOKAHEAD_SEC}s`;
        errored = true;
        break;
      }

      // Defence-in-depth: re-read + lock row.
      const beforeRes = await c.query(
        `SELECT id, "userId", status::text AS status, principal,
                "amountDueAtOpen", "amountPaid", "tenorDays", "feeBps",
                "startAt", "dueAt", "closedAt", "repaidOnTime",
                LOWER("borrowerAddress") AS wallet,
                "openTxHash", "closeTxHash", "syncedByChain"
           FROM loans WHERE id = $1 FOR UPDATE;`,
        [loanId],
      );
      const before = beforeRes.rows[0] ?? null;
      if (!before) {
        abortReason = `loan=${loanId} not found in DB`;
        errored = true;
        break;
      }
      if (before.closeTxHash != null) {
        abortReason = `loan=${loanId} closeTxHash no longer NULL (now=${before.closeTxHash})`;
        errored = true;
        break;
      }

      // Compute new closedAt + repaidOnTime + status.
      const newClosedAtMs = (chosen.tsUnix ?? parseIsoToUnix(chosen.ts)) * 1000;
      const dueAtMs = new Date(before.dueAt).getTime();
      const repaidOnTime = newClosedAtMs <= dueAtMs + GRACE_MS;
      const newStatus = repaidOnTime ? 'repaid_on_time' : 'repaid_late';

      const updateRes = await c.query(
        `UPDATE loans
            SET "closeTxHash"   = $1,
                "amountPaid"    = $2,
                "closedAt"      = to_timestamp($3),
                "syncedByChain" = true,
                "repaidOnTime"  = $4,
                status          = $5::loans_status_enum
          WHERE id = $6
            AND "closeTxHash" IS NULL;`,
        [
          chosen.tx,
          chosen.paid,
          Math.floor(newClosedAtMs / 1000),
          repaidOnTime,
          newStatus,
          loanId,
        ],
      );
      if (updateRes.rowCount !== 1) {
        abortReason = `loan=${loanId} UPDATE affected ${updateRes.rowCount} rows`;
        errored = true;
        break;
      }
      totalAffected++;

      const afterRes = await c.query(
        `SELECT id, status::text AS status, "amountPaid", "closedAt",
                "repaidOnTime", "closeTxHash", "syncedByChain"
           FROM loans WHERE id = $1;`,
        [loanId],
      );
      const after = afterRes.rows[0] ?? null;

      const oldIso = before.closedAt.toISOString();
      const newIso = new Date(newClosedAtMs).toISOString();
      console.log(
        `loan=${String(loanId).padStart(5)}  ${before.status.padEnd(14)} → ${newStatus.padEnd(14)}  amountPaid $0 → $${chosen.paid.toFixed(4)}  closedAt ${oldIso} → ${newIso}  tx=${chosen.tx.slice(0, 14)}…`,
      );

      perLoan.push({
        id: loanId,
        chosen_event: {
          txHash: chosen.tx,
          blockNumber: chosen.block,
          timestamp: chosen.ts,
          paid: chosen.paid,
        },
        update: {
          closeTxHash: chosen.tx,
          amountPaid: chosen.paid,
          closedAt: newIso,
          syncedByChain: true,
          repaidOnTime,
          status: newStatus,
        },
        ignored_events: events
          .filter((e) => e.tx !== chosen.tx)
          .map((e) => ({ tx: e.tx, block: e.block, ts: e.ts, paid: e.paid })),
        before,
        after,
      });
    }

    if (errored) {
      await c.query('ROLLBACK');
      console.error(`\nABORT: ${abortReason}`);
      console.error('ROLLBACK executed. No DB mutation persisted.');
      fs.writeFileSync(
        OUTPUT_PATH,
        JSON.stringify(
          {
            runTs: new Date().toISOString(),
            mode: APPLY ? 'APPLY-ABORTED' : 'DRY-RUN-ABORTED',
            reason: abortReason,
            total_candidates: candidates.length,
            affected_before_abort: totalAffected,
            per_loan: perLoan,
          },
          null,
          2,
        ),
      );
      console.error(`Wrote abort log: ${OUTPUT_PATH}`);
      process.exit(2);
    }

    if (APPLY) {
      await c.query('COMMIT');
      console.log(
        `\n✓ COMMIT executed. ${totalAffected} rows updated in Phase 2.`,
      );
    } else {
      await c.query('ROLLBACK');
      console.log(
        `\n✓ DRY-RUN complete. ${totalAffected} rows WOULD have been updated. ROLLBACK applied — DB unchanged.`,
      );
    }

    fs.writeFileSync(
      OUTPUT_PATH,
      JSON.stringify(
        {
          runTs: new Date().toISOString(),
          mode: APPLY ? 'APPLY' : 'DRY-RUN',
          scan_source: SCAN_JSON,
          scan_runTs: scan.runTs,
          grace_ms: GRACE_MS,
          max_closedat_lookahead_sec: MAX_CLOSEDAT_LOOKAHEAD_SEC,
          total_candidates: candidates.length,
          rows_affected: totalAffected,
          per_loan: perLoan,
        },
        null,
        2,
      ),
    );
    console.log(`Wrote execution log: ${OUTPUT_PATH}`);
    process.exit(0);
  } catch (e) {
    try {
      await c.query('ROLLBACK');
    } catch {}
    console.error('UNEXPECTED ERROR:', e.message);
    console.error(e.stack);
    process.exit(3);
  } finally {
    await c.end();
  }
})();
