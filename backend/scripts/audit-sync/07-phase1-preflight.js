#!/usr/bin/env node
/**
 * Spec 019 §3.1.1 — Phase 1 preflight.
 *
 * For every Group A candidate (match.txHash set in the scan JSON),
 * verifies:
 *
 *   1. getTransactionReceipt(txHash) succeeds with status === 1
 *   2. receipt.blockNumber matches the scan's recorded blockNumber
 *   3. provider.getBlock(blockNumber).timestamp matches scan.ts ± 5s
 *   4. The txHash is not already assigned to another loan in DB
 *   5. Capture the loan row's current state (before-snapshot)
 *
 * If every loan passes all five checks, exit 0. Otherwise exit 1 with
 * a per-loan failure report. Emits phase1-preflight-YYYY-MM-DD.json
 * containing full per-loan verification data + before-snapshots —
 * that file is the audit-trail input for the Phase 1 UPDATE.
 *
 * Read-only. No DB writes, no chain writes.
 *
 * Environment:
 *   SCAN_JSON          required; path to event-scan-YYYY-MM-DD.json
 *   CELO_RPC_URL       default https://forno.celo.org
 *   DATABASE_URL       optional; falls back to POSTGRES_* (pgbouncer-style)
 *   OUTPUT_PATH        optional; default /tmp/phase1-preflight-YYYY-MM-DD.json
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { ethers } = require('ethers');

const SCAN_JSON = process.env.SCAN_JSON;
if (!SCAN_JSON) {
  console.error(
    'FATAL: SCAN_JSON env var required (path to event-scan-YYYY-MM-DD.json)',
  );
  process.exit(1);
}
if (!fs.existsSync(SCAN_JSON)) {
  console.error(`FATAL: SCAN_JSON not found at ${SCAN_JSON}`);
  process.exit(1);
}

const CELO_RPC_URL = process.env.CELO_RPC_URL || 'https://forno.celo.org';
const BLOCK_TIMESTAMP_TOLERANCE_SEC = 5;

function today() {
  return new Date().toISOString().slice(0, 10);
}

const OUTPUT_PATH =
  process.env.OUTPUT_PATH || `/tmp/phase1-preflight-${today()}.json`;

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
  const scan = JSON.parse(fs.readFileSync(SCAN_JSON, 'utf8'));
  const candidates = scan.results.filter((r) => r && r.match);
  console.log(
    `Preflight for ${candidates.length} Group A candidates (scan: ${scan.runTs})\n`,
  );

  const c = new Client({ connectionString: buildConnString() });
  await c.connect();
  const provider = new ethers.JsonRpcProvider(CELO_RPC_URL);

  const perLoan = [];
  let passed = 0;
  let failed = 0;

  for (const r of candidates) {
    const issues = [];
    const txHash = r.match.txHash;
    const expectedBlock = r.match.blockNumber;
    // r.match.ts may be a Unix second (number) OR an ISO string depending on
    // which version of the scan script produced the file. Support both.
    const expectedTs =
      typeof r.match.ts === 'number'
        ? Math.floor(r.match.ts)
        : Math.floor(new Date(r.match.ts).getTime() / 1000);

    // ── (1)(2) Receipt check ──────────────────────────────
    let receipt = null;
    try {
      receipt = await provider.getTransactionReceipt(txHash);
    } catch (e) {
      issues.push(`receipt fetch failed: ${e.message.slice(0, 80)}`);
    }
    if (receipt === null) {
      issues.push('receipt not found — tx may have been reorged');
    } else {
      if (receipt.status !== 1) issues.push(`receipt.status=${receipt.status}`);
      if (receipt.blockNumber !== expectedBlock) {
        issues.push(
          `blockNumber drift: scan=${expectedBlock} chain=${receipt.blockNumber}`,
        );
      }
    }

    // ── (3) Block timestamp check ─────────────────────────
    if (receipt && receipt.blockNumber) {
      let block = null;
      try {
        block = await provider.getBlock(receipt.blockNumber);
      } catch (e) {
        issues.push(`getBlock failed: ${e.message.slice(0, 80)}`);
      }
      if (block) {
        const drift = Math.abs(block.timestamp - expectedTs);
        if (drift > BLOCK_TIMESTAMP_TOLERANCE_SEC) {
          issues.push(
            `block.ts drift: scan=${expectedTs} chain=${block.timestamp} drift=${drift}s`,
          );
        }
      }
    }

    // ── (4) DB duplicate check ────────────────────────────
    const dupRes = await c.query(
      `SELECT id FROM loans WHERE LOWER("closeTxHash") = LOWER($1) AND id <> $2;`,
      [txHash, r.id],
    );
    if (dupRes.rowCount > 0) {
      issues.push(
        `closeTxHash already assigned to loanId(s)=${dupRes.rows.map((x) => x.id).join(',')}`,
      );
    }

    // ── (5) Before-snapshot ──────────────────────────────
    const snap = await c.query(
      `SELECT id, "userId", status::text AS status, principal,
              "amountDueAtOpen", "amountPaid", "tenorDays", "feeBps",
              "startAt", "dueAt", "closedAt", "repaidOnTime",
              LOWER("borrowerAddress") AS wallet,
              "openTxHash", "closeTxHash", "syncedByChain",
              "createdAt", "updatedAt"
         FROM loans WHERE id = $1;`,
      [r.id],
    );
    const before = snap.rows[0] ?? null;
    if (!before) {
      issues.push(`loan id=${r.id} not found in DB — was it deleted?`);
    } else {
      if (before.closeTxHash != null) {
        issues.push(
          `DB closeTxHash already set to ${before.closeTxHash} — no longer NULL`,
        );
      }
      if (!['repaid_on_time', 'repaid_late'].includes(before.status)) {
        issues.push(`DB status changed to ${before.status}`);
      }
    }

    const ok = issues.length === 0;
    if (ok) passed++;
    else failed++;

    console.log(
      `loan=${String(r.id).padStart(5)}  ${ok ? '✓ PASS' : '✗ FAIL'}${ok ? '' : ' ' + issues.join(' | ')}`,
    );

    perLoan.push({
      id: r.id,
      ok,
      issues,
      scan_match: r.match,
      receipt_status: receipt?.status ?? null,
      receipt_block: receipt?.blockNumber ?? null,
      before,
    });
  }

  await c.end();

  console.log('\n=== SUMMARY ===');
  console.log(`  Total candidates: ${candidates.length}`);
  console.log(`  PASS: ${passed}`);
  console.log(`  FAIL: ${failed}`);

  fs.writeFileSync(
    OUTPUT_PATH,
    JSON.stringify(
      {
        runTs: new Date().toISOString(),
        script: 'backend/scripts/audit-sync/07-phase1-preflight.js',
        scan_source: SCAN_JSON,
        scan_runTs: scan.runTs,
        rpc: CELO_RPC_URL,
        total_candidates: candidates.length,
        passed,
        failed,
        per_loan: perLoan,
      },
      null,
      2,
    ),
  );
  console.log(`\n✓ Wrote ${OUTPUT_PATH}`);

  if (failed > 0) {
    console.error(
      `\nFAIL: ${failed} candidate(s) did not pass preflight. Do NOT run Phase 1 until all fail items are triaged.`,
    );
    process.exit(1);
  }
  console.log('OK: all candidates pass. Safe to proceed with Phase 1 UPDATE.');
  process.exit(0);
})().catch((e) => {
  console.error('FATAL:', e.message);
  console.error(e.stack);
  process.exit(2);
});
