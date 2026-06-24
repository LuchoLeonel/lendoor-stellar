#!/usr/bin/env node
/**
 * Spec 019 §3.1 — Pre-execution cross-check for Phase 1/2 UPDATEs.
 *
 * Asserts the invariant that gates any destructive bulk UPDATE on the
 * 24 NULL-closeTxHash rows:
 *
 *     ghost_wallets := subgraph borrowers − DB users.walletAddress
 *     ghost_wallets ⊆ testing-wallets.json
 *
 * If a ghost wallet is found that is NOT already classified in
 * testing-wallets.json, a NEW post-launch ghost has appeared since the
 * last audit and the UPDATE must be paused (exit 1) until the new
 * ghost is triaged. Otherwise exit 0.
 *
 * Read-only:
 *   - Subgraph: HTTPS GET GraphQL (public gateway, rate-limited)
 *   - DB:       SELECT DISTINCT LOWER("walletAddress") FROM users
 *   - Filesystem: read testing-wallets.json, write dated JSON to
 *               specs/019-null-closetxhash-backfill/
 *
 * No DB writes, no on-chain writes, no HTTP POSTs to app endpoints,
 * no notifications. Side effects are: exit code + one JSON file.
 *
 * Environment variables (required):
 *   SUBGRAPH_URL       — full HTTPS URL of the LenDoor subgraph
 *                        (includes Graph gateway API key in path).
 *   DATABASE_URL       — postgres connection string. If not set, falls
 *                        back to POSTGRES_* vars in pgbouncer style so
 *                        the script can run inside the backend container.
 *
 * Environment variables (optional):
 *   OUTPUT_DIR         — override output dir
 *                        (default: specs/019-null-closetxhash-backfill/)
 *
 * For a full audit (beyond this single invariant), see the heavier
 * pipeline at backend/src/scripts/reconciliation/ (exports + diff).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const SCRIPT_DIR = __dirname;
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..');
const TESTING_WALLETS_PATH = path.join(SCRIPT_DIR, 'testing-wallets.json');
const DEFAULT_OUTPUT_DIR = path.join(
  REPO_ROOT,
  'specs',
  '019-null-closetxhash-backfill',
);

function die(msg, code = 1) {
  console.error(`FATAL: ${msg}`);
  process.exit(code);
}

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ── 1. Configuration ────────────────────────────────────────

const SUBGRAPH_URL = process.env.SUBGRAPH_URL;
if (!SUBGRAPH_URL) {
  die(
    'SUBGRAPH_URL env var required. Format: ' +
      'https://gateway.thegraph.com/api/<KEY>/subgraphs/id/<ID>',
  );
}

const OUTPUT_DIR = process.env.OUTPUT_DIR ?? DEFAULT_OUTPUT_DIR;

function buildConnectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const user = process.env.POSTGRES_USER ?? 'lendoor';
  const pw = process.env.POSTGRES_PASSWORD;
  const host = process.env.POSTGRES_HOST ?? 'pgbouncer';
  const port = process.env.POSTGRES_PORT ?? '6432';
  const db = process.env.POSTGRES_DB ?? 'lendoor_production';
  if (!pw) {
    die(
      'Neither DATABASE_URL nor POSTGRES_PASSWORD is set. ' +
        'Cannot connect to the DB.',
    );
  }
  return `postgresql://${user}:${pw}@${host}:${port}/${db}`;
}

// ── 2. Subgraph query — distinct borrower addresses ─────────

async function fetchBorrowers() {
  const all = [];
  let lastId = '';
  const PAGE = 1000;

  while (true) {
    const whereClause = lastId ? `where: { id_gt: "${lastId}" }` : '';
    const q = `{
      borrowers(
        first: ${PAGE}
        orderBy: id
        orderDirection: asc
        ${whereClause}
      ) { id }
    }`;

    const res = await fetch(SUBGRAPH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q }),
    });

    if (!res.ok) {
      const body = await res.text();
      die(`Subgraph HTTP ${res.status}: ${body.slice(0, 200)}`);
    }

    const json = await res.json();
    if (json.errors?.length) {
      die(
        `Subgraph errors: ${json.errors.map((e) => e.message).join('; ')}`,
      );
    }

    const batch = json.data?.borrowers ?? [];
    if (batch.length === 0) break;

    for (const b of batch) all.push(b.id.toLowerCase());

    lastId = batch[batch.length - 1].id;
    if (batch.length < PAGE) break;
  }

  return all;
}

// ── 3. DB query — distinct user wallet addresses ────────────

async function fetchUserWallets() {
  const client = new Client({ connectionString: buildConnectionString() });
  await client.connect();
  try {
    const { rows } = await client.query(`
      SELECT DISTINCT LOWER("walletAddress") AS addr
        FROM users
       WHERE "walletAddress" IS NOT NULL;
    `);
    return rows.map((r) => r.addr);
  } finally {
    await client.end();
  }
}

// ── 4. Testing-wallets.json ─────────────────────────────────

function loadTestingWallets() {
  if (!fs.existsSync(TESTING_WALLETS_PATH)) {
    die(`testing-wallets.json not found at ${TESTING_WALLETS_PATH}`);
  }
  const raw = JSON.parse(fs.readFileSync(TESTING_WALLETS_PATH, 'utf8'));
  const entries = raw.wallets ?? [];
  const map = new Map();
  for (const w of entries) {
    map.set(w.addr.toLowerCase(), {
      label: w.label,
      reason: w.reason,
    });
  }
  return map;
}

// ── 5. Main ─────────────────────────────────────────────────

(async () => {
  log(`SUBGRAPH_URL = ${SUBGRAPH_URL.replace(/\/api\/[^/]+\//, '/api/<key>/')}`);
  log('Fetching subgraph borrowers…');
  const chainBorrowers = await fetchBorrowers();
  log(`  got ${chainBorrowers.length} distinct borrower addresses`);

  log('Fetching DB user wallets…');
  const userWallets = new Set(await fetchUserWallets());
  log(`  got ${userWallets.size} distinct user wallets`);

  log('Loading testing-wallets.json…');
  const testingMap = loadTestingWallets();
  log(`  got ${testingMap.size} classified testing wallets`);

  const ghostAddrs = chainBorrowers.filter((a) => !userWallets.has(a));
  log(
    `Ghost wallets (on-chain, no user row): ${ghostAddrs.length}`,
  );

  const classified = [];
  const unclassified = [];
  for (const addr of ghostAddrs) {
    const hit = testingMap.get(addr);
    if (hit) {
      classified.push({ addr, ...hit });
    } else {
      unclassified.push({ addr });
    }
  }

  log(`  classified (in testing-wallets.json):   ${classified.length}`);
  log(`  unclassified (NEW post-launch ghosts): ${unclassified.length}`);

  // ── 6. Emit dated artifact ─────────────────────────────────
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const outFile = path.join(OUTPUT_DIR, `foreign-ghost-wallets-${today}.json`);

  // Count by label for summary
  const byLabel = {};
  for (const c of classified) {
    byLabel[c.label] = (byLabel[c.label] ?? 0) + 1;
  }

  const artifact = {
    generated_at: new Date().toISOString(),
    script: 'backend/scripts/audit-sync/05-cross-check.js',
    criteria:
      'Ghost wallet = on-chain borrower (subgraph) with no row in users ' +
      '(matched on lowercased walletAddress).',
    subgraph_url_redacted: SUBGRAPH_URL.replace(
      /\/api\/[^/]+\//,
      '/api/<key>/',
    ),
    counts: {
      on_chain_borrowers_total: chainBorrowers.length,
      db_users_with_wallet: userWallets.size,
      ghost_wallets_total: ghostAddrs.length,
      ghost_wallets_classified_as_testing: classified.length,
      ghost_wallets_unclassified: unclassified.length,
      by_testing_wallets_label: byLabel,
    },
    classified_ghosts: classified,
    unclassified_ghosts: unclassified,
  };

  fs.writeFileSync(outFile, JSON.stringify(artifact, null, 2) + '\n');
  log(`Wrote ${outFile}`);

  // ── 7. Assert invariant and exit ───────────────────────────
  if (unclassified.length > 0) {
    console.error(
      `\nFAIL: ${unclassified.length} unclassified ghost wallet(s) detected. ` +
        'A new post-launch ghost has appeared since the last audit. ' +
        'Pause any Phase 1/2 UPDATE and triage the new ghosts before ' +
        'proceeding. See:',
    );
    console.error(`  ${outFile}`);
    process.exit(1);
  }

  log('OK: 0 unclassified ghosts. Invariant holds. Safe to proceed.');
  process.exit(0);
})().catch((e) => {
  console.error('UNEXPECTED ERROR:', e.message);
  console.error(e.stack);
  process.exit(2);
});
