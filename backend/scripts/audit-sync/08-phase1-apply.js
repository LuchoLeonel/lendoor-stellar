#!/usr/bin/env node
/**
 * Spec 019 Phase 1 apply — backfill `closeTxHash` for 21 Group A loans.
 *
 * Inputs:
 *   PREFLIGHT_JSON  required; path to phase1-preflight-YYYY-MM-DD.json
 *                   produced by 07-phase1-preflight.js. Must report
 *                   passed === total_candidates before this script
 *                   will execute.
 *
 * Behaviour:
 *   - Default (no APPLY env):     dry-run. BEGIN → UPDATEs → ROLLBACK.
 *                                 Reports affected-row counts. DB
 *                                 state unchanged.
 *   - APPLY=1:                    real run. BEGIN → UPDATEs → COMMIT.
 *                                 Emits execution-log-YYYY-MM-DD.json
 *                                 with before/after per loan.
 *
 * SQL per loan (single statement inside the transaction):
 *   UPDATE loans
 *      SET "closeTxHash"    = $1,
 *          "syncedByChain"  = true
 *    WHERE id = $2
 *      AND "closeTxHash" IS NULL;
 *
 * Guards:
 *   - WHERE closeTxHash IS NULL → idempotent; re-running the script
 *     after a partial success cannot double-write. If a loan was
 *     touched between preflight and apply, its UPDATE affects 0 rows
 *     and the whole transaction aborts (safety).
 *   - Every UPDATE must affect exactly 1 row. If any row count != 1,
 *     ROLLBACK + exit 1.
 *   - No other columns are touched. closedAt, status, repaidOnTime,
 *     amountPaid stay as-is. Rationale: the event scan confirmed the
 *     DB values already match chain timestamp ±5s and the 24h grace
 *     rule was reapplied by spec 018 Paso 3. Only the missing receipt
 *     metadata is being filled in.
 *
 * Emits:
 *   /tmp/execution-log-YYYY-MM-DD.json (dry-run writes a .dry-run.json
 *   variant so it does not overwrite a real-run artifact).
 *
 * Exit codes:
 *   0  transaction committed (APPLY=1) or dry-run all-green
 *   1  any UPDATE affected 0 rows (preflight stale) or APPLY_GUARD
 *   2  unexpected error; transaction rolled back
 */

'use strict';

const fs = require('fs');
const { Client } = require('pg');

const PREFLIGHT_JSON = process.env.PREFLIGHT_JSON;
if (!PREFLIGHT_JSON) {
  console.error('FATAL: PREFLIGHT_JSON env var required');
  process.exit(1);
}
if (!fs.existsSync(PREFLIGHT_JSON)) {
  console.error(`FATAL: PREFLIGHT_JSON not found at ${PREFLIGHT_JSON}`);
  process.exit(1);
}

const APPLY = process.env.APPLY === '1';

function today() {
  return new Date().toISOString().slice(0, 10);
}

const OUTPUT_PATH =
  process.env.OUTPUT_PATH ||
  (APPLY
    ? `/tmp/execution-log-${today()}.json`
    : `/tmp/execution-log-${today()}.dry-run.json`);

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

(async () => {
  const preflight = JSON.parse(fs.readFileSync(PREFLIGHT_JSON, 'utf8'));

  if (
    preflight.passed !== preflight.total_candidates ||
    preflight.failed !== 0
  ) {
    console.error(
      `FATAL: preflight not green (passed=${preflight.passed}/${preflight.total_candidates}, failed=${preflight.failed}). Not eligible for apply.`,
    );
    process.exit(1);
  }

  const rows = preflight.per_loan.filter((r) => r.ok);
  console.log(
    `Phase 1 apply — ${rows.length} candidates, mode=${APPLY ? 'APPLY' : 'DRY-RUN'}`,
  );
  console.log(`Preflight source: ${PREFLIGHT_JSON} (ran ${preflight.runTs})\n`);

  const c = new Client({ connectionString: buildConnString() });
  await c.connect();

  const perLoan = [];
  let totalAffected = 0;
  let errored = false;

  try {
    await c.query('BEGIN');

    for (const r of rows) {
      const txHash = r.scan_match.txHash;
      const loanId = r.id;

      // Defence-in-depth: re-read the row inside the transaction.
      const beforeRes = await c.query(
        `SELECT id, "closeTxHash", "syncedByChain", status::text AS status,
                "closedAt", "amountPaid"
           FROM loans WHERE id = $1 FOR UPDATE;`,
        [loanId],
      );
      const before = beforeRes.rows[0] ?? null;
      if (!before) {
        console.error(`loan=${loanId} not found in DB`);
        errored = true;
        break;
      }
      if (before.closeTxHash != null) {
        console.error(
          `loan=${loanId} closeTxHash is no longer NULL (now=${before.closeTxHash}). Aborting.`,
        );
        errored = true;
        break;
      }

      const updateRes = await c.query(
        `UPDATE loans
            SET "closeTxHash"   = $1,
                "syncedByChain" = true
          WHERE id = $2
            AND "closeTxHash" IS NULL;`,
        [txHash, loanId],
      );
      if (updateRes.rowCount !== 1) {
        console.error(
          `loan=${loanId} UPDATE affected ${updateRes.rowCount} rows (expected 1). Aborting.`,
        );
        errored = true;
        break;
      }
      totalAffected++;

      const afterRes = await c.query(
        `SELECT id, "closeTxHash", "syncedByChain", status::text AS status,
                "closedAt", "amountPaid"
           FROM loans WHERE id = $1;`,
        [loanId],
      );
      const after = afterRes.rows[0] ?? null;

      console.log(
        `loan=${String(loanId).padStart(5)}  closeTxHash NULL → ${txHash.slice(0, 18)}…  syncedByChain → true`,
      );

      perLoan.push({
        id: loanId,
        update: {
          closeTxHash: txHash,
          syncedByChain: true,
        },
        before,
        after,
      });
    }

    if (errored) {
      await c.query('ROLLBACK');
      console.error('\nROLLBACK executed. No DB mutation persisted.');
      fs.writeFileSync(
        OUTPUT_PATH,
        JSON.stringify(
          {
            runTs: new Date().toISOString(),
            mode: APPLY ? 'APPLY-ABORTED' : 'DRY-RUN-ABORTED',
            reason: 'see stderr',
            total_candidates: rows.length,
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
      console.log(`\n✓ COMMIT executed. ${totalAffected} rows updated.`);
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
          preflight_source: PREFLIGHT_JSON,
          preflight_runTs: preflight.runTs,
          total_candidates: rows.length,
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
    process.exit(2);
  } finally {
    await c.end();
  }
})();
