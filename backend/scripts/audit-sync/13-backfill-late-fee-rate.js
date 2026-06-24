#!/usr/bin/env node
/**
 * Spec 025 — Backfill late-fee rate (mora 5%/mo) on existing wallets.
 *
 * For each wallet in the universe of currently-open / defaulted loans,
 * call setPremiumConfig(wallet, premiumRate=0, lateRatePerSecWad=
 * LATE_RATE_PER_SEC_WAD). This activates the contract's mora-accrual
 * path for that wallet — `previewLoanWithLate` starts returning a
 * growing value, and `accrueLate` materializes that growth into
 * storage when called (which the spec 024 A.3 preflight does at
 * user-attempted repay time).
 *
 * SERIAL via the spec 021 signer queue — never two writes in flight
 * (avoids nonce races). Pattern follows 11-resync-users-to-chain.js.
 *
 * Universe (per spec 025 §1): all wallets with `closedAt IS NULL` in
 * the loans table. ~982 wallets at audit 2026-04-28 (4 ghost +
 * 766 reales + 53 prematuros + 159 open + ...).
 *
 * Inputs (choose ONE — default = pull all from DB):
 *   WALLETS="0xaaa,0xbbb,0xccc"           comma-separated
 *   WALLETS_FILE=/path/to/wallets.json    JSON array of wallet strings
 *   (none)                                pull universe from DB
 *
 * Mode flags:
 *   DRY_RUN=1              print planned writes, do not touch chain (default)
 *   APPLY=1                actually execute
 *
 * Other knobs:
 *   PHASE=N                process only first N wallets (for staged rollout)
 *
 * Output:
 *   /tmp/backfill-late-fee-YYYY-MM-DD-HHMMSS.json    full execution log
 *
 * Exit codes:
 *   0   success
 *   1   at least one chain write failed
 *   2   unexpected error (input/RPC/etc.)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { Client } = require('/app/node_modules/pg');
const {
  setPremiumConfig,
  provider,
  CLM_ADDRESS,
} = require('/app/dist/src/config/contractConfig.js');
const { Contract } = require('/app/node_modules/ethers');
const {
  LATE_RATE_PER_SEC_WAD,
} = require('/app/dist/src/domain/services/credit-policy.service.js');

const APPLY = process.env.APPLY === '1';
const PHASE_LIMIT = process.env.PHASE
  ? parseInt(process.env.PHASE, 10)
  : null;

// Read-only contract for the pre-write idempotency check.
const ABI_READ_PREMIUMS = [
  'function premiums(address) view returns (uint128 premiumRatePerSecWad, uint128 lateRatePerSecWad)',
  'function loans(address) view returns (uint128 principal, uint128 amountDue, uint64 start, uint64 due, uint16 feeBps, uint32 gracePeriod, bool active)',
];
const clmRead = new Contract(CLM_ADDRESS, ABI_READ_PREMIUMS, provider);

function ts() {
  return new Date().toISOString();
}
function dayStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '-').slice(0, 19);
}

function buildConnString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const user = process.env.POSTGRES_USER || 'lendoor';
  const pw = process.env.POSTGRES_PASSWORD;
  const host = process.env.POSTGRES_HOST || 'pgbouncer';
  const port = process.env.POSTGRES_PORT || '6432';
  const db = process.env.POSTGRES_DB || 'lendoor_production';
  if (!pw) throw new Error('POSTGRES_PASSWORD or DATABASE_URL required');
  return `postgresql://${user}:${pw}@${host}:${port}/${db}`;
}

function parseWalletsInput() {
  if (process.env.WALLETS_FILE) {
    const raw = JSON.parse(fs.readFileSync(process.env.WALLETS_FILE, 'utf8'));
    if (!Array.isArray(raw)) {
      throw new Error('WALLETS_FILE must be a JSON array of wallet strings');
    }
    return raw.map((w) => w.toLowerCase());
  }
  if (process.env.WALLETS) {
    return process.env.WALLETS.split(',')
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean);
  }
  return null; // signal: pull from DB
}

async function loadUniverseFromDb(client) {
  const r = await client.query(
    `SELECT DISTINCT LOWER("borrowerAddress") AS wallet
       FROM loans
      WHERE "closedAt" IS NULL
      ORDER BY MIN("dueAt") ASC;`,
  );
  // Note: ORDER BY MIN("dueAt") works because we have DISTINCT only on
  // wallet — multiple loans per wallet would need the MIN. Adjust if
  // PostgreSQL complains; fallback to ORDER BY wallet.
  return r.rows.map((row) => row.wallet);
}

(async () => {
  const log = {
    started_at: ts(),
    mode: APPLY ? 'APPLY' : 'DRY_RUN',
    phase_limit: PHASE_LIMIT,
    rate_per_sec_wad: LATE_RATE_PER_SEC_WAD.toString(),
    universe_source: null,
    universe_size: 0,
    processed: 0,
    skipped_already_at_target: 0,
    skipped_inactive_loan: 0,
    succeeded: 0,
    failed: 0,
    results: [],
  };

  let wallets;
  let client = null;

  try {
    const explicit = parseWalletsInput();
    if (explicit) {
      wallets = explicit;
      log.universe_source = 'env';
    } else {
      client = new Client({ connectionString: buildConnString() });
      await client.connect();
      try {
        wallets = await loadUniverseFromDb(client);
        log.universe_source = 'db';
      } catch (e) {
        // Fallback: simpler ORDER BY in case PG complains about DISTINCT + MIN
        const r = await client.query(
          `SELECT DISTINCT LOWER("borrowerAddress") AS wallet
             FROM loans WHERE "closedAt" IS NULL
             ORDER BY 1 ASC;`,
        );
        wallets = r.rows.map((row) => row.wallet);
        log.universe_source = 'db_fallback';
      }
    }
  } catch (e) {
    console.error(`[${ts()}] ERROR loading universe:`, e.message);
    process.exit(2);
  }

  if (PHASE_LIMIT && PHASE_LIMIT > 0 && PHASE_LIMIT < wallets.length) {
    wallets = wallets.slice(0, PHASE_LIMIT);
    console.log(`[${ts()}] Phase limit applied: processing first ${PHASE_LIMIT} wallets`);
  }

  log.universe_size = wallets.length;
  console.log(
    `[${ts()}] Backfill late-fee rate to ${wallets.length} wallets — mode=${log.mode}`,
  );
  console.log(
    `[${ts()}] Target lateRatePerSecWad=${LATE_RATE_PER_SEC_WAD.toString()} (5%/mo per spec 024)\n`,
  );

  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];
    const idx = `[${i + 1}/${wallets.length}]`;
    log.processed++;

    let curRate;
    let isActive;
    try {
      const [premiums, loan] = await Promise.all([
        clmRead.premiums(wallet),
        clmRead.loans(wallet),
      ]);
      curRate = BigInt(premiums.lateRatePerSecWad.toString());
      isActive = Boolean(loan.active);
    } catch (e) {
      console.log(`  ${idx} ${wallet}  ✗ RPC read failed: ${e.message?.slice(0, 80) || e}`);
      log.failed++;
      log.results.push({ wallet, status: 'rpc_read_failed', error: String(e).slice(0, 200) });
      continue;
    }

    if (!isActive) {
      console.log(`  ${idx} ${wallet}  skip (loan.active=false on chain)`);
      log.skipped_inactive_loan++;
      log.results.push({ wallet, status: 'skipped_inactive_loan' });
      continue;
    }

    if (curRate === LATE_RATE_PER_SEC_WAD) {
      console.log(`  ${idx} ${wallet}  skip (already at target rate)`);
      log.skipped_already_at_target++;
      log.results.push({ wallet, status: 'skipped_already_at_target' });
      continue;
    }

    if (!APPLY) {
      console.log(
        `  ${idx} ${wallet}  → would set lateRatePerSecWad=${LATE_RATE_PER_SEC_WAD.toString()} (was ${curRate.toString()})`,
      );
      log.results.push({
        wallet,
        status: 'dry_run',
        prev_rate: curRate.toString(),
        target_rate: LATE_RATE_PER_SEC_WAD.toString(),
      });
      continue;
    }

    // APPLY path — serial chain write via spec 021 signer queue.
    const startTs = Date.now();
    try {
      // Use 'low' priority — this is a backfill, NOT user-facing. Lets
      // organic borrow/repay flows (priority 'high') jump the queue.
      await setPremiumConfig(wallet, LATE_RATE_PER_SEC_WAD, 'low');
      const dur = Date.now() - startTs;
      console.log(`  ${idx} ${wallet}  ✓ written in ${dur}ms`);
      log.succeeded++;
      log.results.push({ wallet, status: 'ok', duration_ms: dur });
    } catch (e) {
      const msg = String(e?.message || e).slice(0, 200);
      console.log(`  ${idx} ${wallet}  ✗ chain write failed: ${msg}`);
      log.failed++;
      log.results.push({ wallet, status: 'chain_write_failed', error: msg });
    }
  }

  log.finished_at = ts();
  const outPath = path.join('/tmp', `backfill-late-fee-${dayStamp()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(log, null, 2));

  console.log(`\n[${ts()}] Done — saved log: ${outPath}`);
  console.log(`  Total:                       ${log.universe_size}`);
  console.log(`  Skipped (already at target): ${log.skipped_already_at_target}`);
  console.log(`  Skipped (inactive loan):     ${log.skipped_inactive_loan}`);
  console.log(`  Succeeded:                   ${log.succeeded}`);
  console.log(`  Failed:                      ${log.failed}`);

  if (client) await client.end();
  process.exit(log.failed > 0 ? 1 : 0);
})().catch((e) => {
  console.error(`[${ts()}] FATAL:`, e);
  process.exit(2);
});
