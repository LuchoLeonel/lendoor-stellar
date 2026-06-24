#!/usr/bin/env node
/**
 * Spec 021 §Phase 3 — General-purpose CLI to resync a user set
 * (score + credit limit) from DB ladder-derived targets to chain,
 * SERIALLY.
 *
 * Use this after any bulk SQL UPDATE that changes `loans.repaidOnTime`
 * or `loans.status` (which would change a user's `onTimeLoans` count
 * and therefore their ladder step). Running this right after the data
 * migration closes the drift window before the next chain-sync tick.
 *
 * This is a generalisation of the one-shot cleanup done 2026-04-23 for
 * 8 wallets stuck after the ladder-recalc nonce race. That run was 8/8
 * OK with 0 nonce errors because each call awaited the previous tx
 * receipt before starting — the pattern codified here.
 *
 * Inputs (choose ONE of):
 *   WALLETS="0xaaa,0xbbb,0xccc"           comma-separated wallet list
 *   USER_IDS="123,456,789"                 comma-separated numeric user IDs
 *   WALLETS_FILE=/path/to/wallets.json     JSON array of wallet strings
 *
 * Mode flags:
 *   DRY_RUN=1              print planned writes, do not touch chain / DB
 *   APPLY=1                actually execute (default is dry-run)
 *
 * Output:
 *   /tmp/resync-YYYY-MM-DD-HHMMSS.json     per-wallet execution log
 *
 * Exit codes:
 *   0   success (all wallets ok, or dry-run all-green)
 *   1   at least one chain write failed
 *   2   unexpected error (bad input, RPC outage, etc.)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { Client } = require('/app/node_modules/pg');
const {
  giveCreditScoreAndLimit,
  toUnits,
} = require('/app/dist/src/config/contractConfig.js');
const {
  CreditPolicyService,
} = require('/app/dist/src/domain/services/credit-policy.service.js');

const APPLY = process.env.APPLY === '1';
// DRY_RUN is the default; APPLY=1 flips it.

function parseWallets() {
  if (process.env.WALLETS_FILE) {
    const raw = JSON.parse(fs.readFileSync(process.env.WALLETS_FILE, 'utf8'));
    if (!Array.isArray(raw)) {
      throw new Error(`WALLETS_FILE must be a JSON array of wallet strings`);
    }
    return { kind: 'wallets', values: raw.map((w) => w.toLowerCase()) };
  }
  if (process.env.WALLETS) {
    return {
      kind: 'wallets',
      values: process.env.WALLETS.split(',')
        .map((w) => w.trim().toLowerCase())
        .filter(Boolean),
    };
  }
  if (process.env.USER_IDS) {
    return {
      kind: 'user_ids',
      values: process.env.USER_IDS.split(',')
        .map((x) => parseInt(x.trim(), 10))
        .filter((n) => Number.isFinite(n) && n > 0),
    };
  }
  throw new Error(
    'Specify WALLETS, USER_IDS, or WALLETS_FILE env var. See header for usage.',
  );
}

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

(async () => {
  const input = parseWallets();
  const cp = new CreditPolicyService();
  const c = new Client({ connectionString: buildConnString() });
  await c.connect();

  console.log(
    `[${ts()}] Resync ${input.values.length} ${input.kind} — mode=${APPLY ? 'APPLY (serial)' : 'DRY-RUN'}\n`,
  );

  // Resolve input → rows with {userId, wallet, dbScore, dbLimitUnits, onTime}
  let dbQuery;
  if (input.kind === 'wallets') {
    dbQuery = await c.query(
      `SELECT u.id AS user_id,
              LOWER(u."walletAddress") AS wallet,
              u.score AS db_score,
              u."creditLimit" AS db_limit,
              (SELECT COUNT(*)::int FROM loans
                 WHERE "userId" = u.id AND "repaidOnTime" = true) AS on_time_loans
         FROM users u
        WHERE LOWER(u."walletAddress") = ANY($1::text[])
        ORDER BY u.id;`,
      [input.values],
    );
  } else {
    dbQuery = await c.query(
      `SELECT u.id AS user_id,
              LOWER(u."walletAddress") AS wallet,
              u.score AS db_score,
              u."creditLimit" AS db_limit,
              (SELECT COUNT(*)::int FROM loans
                 WHERE "userId" = u.id AND "repaidOnTime" = true) AS on_time_loans
         FROM users u
        WHERE u.id = ANY($1::int[])
        ORDER BY u.id;`,
      [input.values],
    );
  }

  const rows = dbQuery.rows;
  console.log(`Resolved ${rows.length}/${input.values.length} users from DB.\n`);
  if (rows.length === 0) {
    console.log('Nothing to do. Exit 0.');
    await c.end();
    return;
  }

  const results = [];
  for (const r of rows) {
    if (!r.wallet) {
      console.log(`  userId=${r.user_id}  no walletAddress — skip`);
      results.push({ userId: r.user_id, status: 'no_wallet' });
      continue;
    }
    const dbScore = Number(r.db_score);
    const dbLimitUnits = Number(r.db_limit);
    const onTime = r.on_time_loans;
    const step = cp.getStepForOnTimeLoans(onTime);
    const targetLimitUnits = Number(toUnits(step.limitUsdc, 6));
    const targetScore = step.score;

    const needsDbUpdate =
      dbScore !== targetScore || dbLimitUnits !== targetLimitUnits;

    console.log(
      `  ${r.wallet}  userId=${r.user_id}  onTime=${onTime}`,
    );
    console.log(`    DB now:  score=${dbScore}  limit=${dbLimitUnits}`);
    console.log(`    Target:  score=${targetScore}  limit=${targetLimitUnits}`);

    if (!APPLY) {
      console.log(`    → would write chain: score=${targetScore} limit=${targetLimitUnits}`);
      if (needsDbUpdate) console.log(`    → would update DB`);
      results.push({
        userId: r.user_id,
        wallet: r.wallet,
        onTime,
        target: { score: targetScore, limitUnits: targetLimitUnits },
        dbBefore: { score: dbScore, limitUnits: dbLimitUnits },
        needsDbUpdate,
        status: 'dry',
      });
      continue;
    }

    // ── APPLY path — chain first, then DB if chain succeeded
    let chainOk = false;
    let chainErr = null;
    try {
      const start = Date.now();
      const code = await giveCreditScoreAndLimit(
        r.wallet,
        targetScore,
        BigInt(targetLimitUnits),
      );
      const dur = Date.now() - start;
      console.log(`    ✓ chain OK code=${code}  dur=${dur}ms`);
      chainOk = code === 200;
    } catch (e) {
      chainErr = e?.message || String(e);
      console.log(`    ✗ chain FAIL: ${chainErr.slice(0, 120)}`);
    }

    if (!chainOk) {
      results.push({
        userId: r.user_id,
        wallet: r.wallet,
        onTime,
        target: { score: targetScore, limitUnits: targetLimitUnits },
        dbBefore: { score: dbScore, limitUnits: dbLimitUnits },
        status: 'chain_fail',
        error: chainErr,
      });
      continue;
    }

    if (needsDbUpdate) {
      await c.query(
        `UPDATE users SET score = $1, "creditLimit" = $2 WHERE id = $3;`,
        [targetScore, targetLimitUnits, r.user_id],
      );
      console.log(`    ✓ DB updated`);
    }
    results.push({
      userId: r.user_id,
      wallet: r.wallet,
      onTime,
      target: { score: targetScore, limitUnits: targetLimitUnits },
      dbBefore: { score: dbScore, limitUnits: dbLimitUnits },
      dbAfter: { score: targetScore, limitUnits: targetLimitUnits },
      status: 'ok',
    });
  }

  await c.end();

  const ok = results.filter((x) => x.status === 'ok').length;
  const chainFail = results.filter((x) => x.status === 'chain_fail').length;
  const dry = results.filter((x) => x.status === 'dry').length;
  const noWallet = results.filter((x) => x.status === 'no_wallet').length;

  console.log('\n=== SUMMARY ===');
  console.log(`  ok:          ${ok}`);
  console.log(`  chain_fail:  ${chainFail}`);
  console.log(`  dry-run:     ${dry}`);
  console.log(`  no_wallet:   ${noWallet}`);

  const outDir = process.env.OUTPUT_DIR || '/tmp';
  const outPath = path.join(outDir, `resync-${dayStamp()}.json`);
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        runTs: new Date().toISOString(),
        mode: APPLY ? 'APPLY' : 'DRY-RUN',
        input_kind: input.kind,
        input_count: input.values.length,
        resolved_count: rows.length,
        summary: { ok, chainFail, dry, noWallet },
        results,
      },
      null,
      2,
    ),
  );
  console.log(`\nLog: ${outPath}`);

  if (chainFail > 0) process.exit(1);
})().catch((e) => {
  console.error('FATAL:', e.message);
  console.error(e.stack);
  process.exit(2);
});
