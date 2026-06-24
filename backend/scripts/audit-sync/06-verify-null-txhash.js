#!/usr/bin/env node
/**
 * Spec 019 §2.1 — Event scan for NULL-closeTxHash loans.
 *
 * For every loan with `status ∈ (repaid_on_time, repaid_late)` and
 * `closeTxHash IS NULL`, look up the borrower's LoanClosed events on
 * Celo and try to match the DB row's `amountPaid` (or a tight window
 * around `closedAt`). Emit a per-loan verdict and summary JSON.
 *
 * Read-only: RPC reads (getTransactionReceipt, queryFilter, getBlock,
 * getLoan) + DB SELECT. No DB writes, no on-chain writes.
 *
 * This script was originally produced ad-hoc in `/tmp` during the
 * 2026-04-21 audit. The 2026-04-23 re-run revealed that the original
 * version had a silent-failure bug in the chunked event loop:
 *
 *     try {
 *       for each chunk:
 *         events.push(...await queryFilter(...));
 *     } catch { events = []; }       // ← wipes everything on any failure
 *
 * A single transient RPC error on one chunk silently produced
 * zero-event verdicts for wallets that actually had events. Three
 * loans (919, 1108, 1176) were misclassified as "Group C — no on-chain
 * event" in the 2026-04-21 run because of this.
 *
 * Fix here: per-chunk retry + loud failure. If a chunk cannot be
 * fetched after retries, we abort the whole loan's scan with a clear
 * error rather than returning a false negative.
 *
 * Environment:
 *   CELO_RPC_URL       — default https://forno.celo.org
 *   LOAN_MANAGER_ADDR  — default 0x3E1536CC066C626Ee96D79bb00d1c9dC7d4D86b6
 *   DATABASE_URL       — optional; defaults to POSTGRES_* (pgbouncer-style)
 *   OUTPUT_PATH        — optional; default /tmp/event-scan-YYYY-MM-DD.json
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { ethers } = require('ethers');

const CELO_RPC_URL = process.env.CELO_RPC_URL || 'https://forno.celo.org';
const LM = (
  process.env.LOAN_MANAGER_ADDR ||
  '0x3E1536CC066C626Ee96D79bb00d1c9dC7d4D86b6'
).toLowerCase();

const ABI = [
  'event LoanClosed(address indexed borrower, uint256 paid)',
  'function getLoan(address) view returns (uint256 principal,uint256 amountDue,uint64 start,uint64 due,uint16 feeBps,uint32 gracePeriod,bool active)',
];

const USDC_DECIMALS = 6n;
const USDC_UNIT = 10 ** Number(USDC_DECIMALS);
const MATCH_TOLERANCE_USDC = 0.05;
const CHUNK_BLOCKS = 50_000;
const CHUNK_RETRIES = 3;
const CHUNK_BACKOFF_MS = 1000;
const DEFAULT_FROM_BLOCK = 32_000_000;

function today() {
  return new Date().toISOString().slice(0, 10);
}

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

const OUTPUT_PATH =
  process.env.OUTPUT_PATH || `/tmp/event-scan-${today()}.json`;

// ─────────────────────────────────────────────────────────────
// Chunk scan with per-chunk retry + loud failure.
//
// The old `try { ... } catch { events = [] }` wrapper is removed
// intentionally — a silent fallback hides real failures and produces
// wrong verdicts. If we can't scan a chunk, we throw and the caller
// decides what to do (mark loan as "scan_error", skip, or abort).
// ─────────────────────────────────────────────────────────────
async function queryFilterChunked(contract, filter, fromBlock, toBlock) {
  const events = [];
  for (let b = fromBlock; b <= toBlock; b += CHUNK_BLOCKS) {
    const to = Math.min(b + CHUNK_BLOCKS - 1, toBlock);
    let lastErr = null;
    let ok = false;
    for (let attempt = 0; attempt < CHUNK_RETRIES; attempt++) {
      try {
        const evs = await contract.queryFilter(filter, b, to);
        events.push(...evs);
        ok = true;
        break;
      } catch (e) {
        lastErr = e;
        const wait = CHUNK_BACKOFF_MS * (attempt + 1);
        console.warn(
          `  chunk ${b}-${to} failed (attempt ${attempt + 1}/${CHUNK_RETRIES}): ${e.message.slice(0, 80)}; retrying in ${wait}ms`,
        );
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    if (!ok) {
      throw new Error(
        `chunk ${b}-${to} failed after ${CHUNK_RETRIES} attempts: ${lastErr?.message ?? 'unknown'}`,
      );
    }
  }
  return events;
}

// ─────────────────────────────────────────────────────────────

(async () => {
  const c = new Client({ connectionString: buildConnString() });
  await c.connect();

  const provider = new ethers.JsonRpcProvider(CELO_RPC_URL);
  const lm = new ethers.Contract(LM, ABI, provider);

  const rows = (
    await c.query(`
      SELECT id, "userId", status::text AS status, principal,
             "amountDueAtOpen", "startAt", "dueAt", "closedAt",
             "amountPaid", LOWER("borrowerAddress") AS wallet,
             "openTxHash", "closeTxHash"
        FROM loans
       WHERE "closeTxHash" IS NULL
         AND status::text IN ('repaid_on_time','repaid_late')
       ORDER BY id;
    `)
  ).rows;

  console.log(`Verifying ${rows.length} loans via LoanClosed events\n`);

  const latest = await provider.getBlockNumber();
  const results = [];

  for (const L of rows) {
    const dbPaid = Number(L.amountPaid ?? 0);
    const dbDueAtOpen = Number(L.amountDueAtOpen ?? 0);

    // Figure out the scan start block: openTxHash receipt, if any.
    let openBlock = null;
    if (L.openTxHash) {
      try {
        const r = await provider.getTransactionReceipt(L.openTxHash);
        openBlock = r ? r.blockNumber : null;
      } catch {
        openBlock = null;
      }
    }
    const fromBlock = openBlock ?? DEFAULT_FROM_BLOCK;

    // Current chain state for the wallet.
    let currentChain = null;
    try {
      const g = await lm.getLoan(L.wallet);
      currentChain = {
        principal: Number(g[0]) / USDC_UNIT,
        amountDue: Number(g[1]) / USDC_UNIT,
        start: Number(g[2]),
        due: Number(g[3]),
        active: g[6],
      };
    } catch (e) {
      currentChain = { error: e.message.slice(0, 80) };
    }

    // Scan events — loudly, with retry.
    let events;
    try {
      const filter = lm.filters.LoanClosed(L.wallet);
      events = await queryFilterChunked(lm, filter, fromBlock, latest);
    } catch (e) {
      console.error(`loan=${L.id} SCAN ERROR: ${e.message}`);
      results.push({
        id: L.id,
        db_status: L.status,
        db_paid: dbPaid,
        db_closedAt: L.closedAt.toISOString(),
        wallet: L.wallet,
        openBlock,
        scan_error: e.message,
        events_in_window: [],
        match: null,
      });
      continue;
    }

    // Annotate each event with its block timestamp.
    const annotated = [];
    for (const ev of events) {
      if (openBlock && ev.blockNumber < openBlock) continue;
      const blk = await provider.getBlock(ev.blockNumber);
      annotated.push({
        tx: ev.transactionHash,
        block: ev.blockNumber,
        ts: new Date(blk.timestamp * 1000).toISOString(),
        tsUnix: blk.timestamp,
        paid: Number(ev.args.paid) / USDC_UNIT,
      });
    }

    // Match: pick the event closest in time to DB closedAt with amount
    // within tolerance of dbPaid (or fallback to amountDueAtOpen when
    // dbPaid is 0 — the $0-amountPaid bug class).
    const targetAmount = dbPaid > 0 ? dbPaid : dbDueAtOpen;
    let match = null;
    const dbTs = Math.floor(new Date(L.closedAt).getTime() / 1000);
    const startEpoch = Math.floor(new Date(L.startAt).getTime() / 1000);
    const dueEpoch = Math.floor(new Date(L.dueAt).getTime() / 1000);
    const candidates = annotated
      .filter((e) => e.tsUnix >= startEpoch - 86400)
      .filter((e) => e.tsUnix <= dueEpoch + 90 * 86400);
    // Strict match: amount within tolerance.
    const strict = candidates.find(
      (e) => Math.abs(e.paid - targetAmount) <= MATCH_TOLERANCE_USDC,
    );
    if (strict) {
      match = {
        txHash: strict.tx,
        blockNumber: strict.block,
        ts: strict.ts,
        paid: strict.paid,
      };
    }

    console.log(
      `loan=${String(L.id).padStart(5)}  status=${L.status.padEnd(15)}  db_paid=$${dbPaid.toFixed(2)}  db_closed=${L.closedAt.toISOString()}`,
    );
    console.log(
      `   wallet=${L.wallet}   openBlock=${openBlock ?? 'NULL'}`,
    );
    if (currentChain.error) {
      console.log(`   current chain: ERROR ${currentChain.error}`);
    } else {
      console.log(
        `   current chain: active=${currentChain.active}  principal=$${currentChain.principal}  due=${currentChain.due ? new Date(currentChain.due * 1000).toISOString() : 'n/a'}`,
      );
    }
    console.log(
      `   LoanClosed events for this wallet (after openBlock): ${annotated.length}`,
    );
    for (const e of annotated) {
      console.log(
        `     block=${e.block}  ts=${e.ts}  paid=$${e.paid.toFixed(4)}  tx=${e.tx}`,
      );
    }
    if (match) {
      console.log(
        `   ✓ MATCH: tx=${match.txHash} block=${match.blockNumber} ts=${match.ts} paid=$${match.paid.toFixed(4)}`,
      );
    } else {
      console.log(
        `   ✗ NO MATCH — DB says repaid but no on-chain event with matching amount in window`,
      );
    }

    results.push({
      id: L.id,
      db_status: L.status,
      db_paid: dbPaid,
      db_closedAt: L.closedAt.toISOString(),
      wallet: L.wallet,
      openBlock,
      currentChain,
      events_in_window: annotated,
      match,
    });
  }

  await c.end();

  const matched = results.filter((r) => r.match);
  const noMatch = results.filter((r) => !r.match && !r.scan_error);
  const scanErrors = results.filter((r) => r.scan_error);
  const activeOnChain = results.filter((r) => r.currentChain?.active === true);

  console.log('\n=== SUMMARY ===');
  console.log(`  Matched on chain:            ${matched.length}`);
  console.log(`  NO match:                    ${noMatch.length}`);
  console.log(`  Scan errors (loud failure):  ${scanErrors.length}`);
  console.log(
    `  Currently active on chain:   ${activeOnChain.length}`,
  );

  fs.writeFileSync(
    OUTPUT_PATH,
    JSON.stringify(
      {
        runTs: new Date().toISOString(),
        script: 'backend/scripts/audit-sync/06-verify-null-txhash.js',
        rpc: CELO_RPC_URL,
        total: results.length,
        matched: matched.length,
        no_match: noMatch.length,
        scan_errors: scanErrors.length,
        active_on_chain: activeOnChain.length,
        results,
      },
      null,
      2,
    ),
  );
  console.log(`\n✓ Wrote ${OUTPUT_PATH}`);

  if (scanErrors.length > 0) {
    console.error(
      `\nEXIT 2: ${scanErrors.length} loans hit scan errors — results are incomplete. Do NOT proceed to Phase 1 without re-running successfully.`,
    );
    process.exit(2);
  }
})().catch((e) => {
  console.error('FATAL:', e.message);
  console.error(e.stack);
  process.exit(1);
});
