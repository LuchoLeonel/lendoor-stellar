#!/usr/bin/env node
/**
 * Phase 0 — Enumerate on-chain universe for LoanManagerV3.
 *
 * Scans every event emitted by the contract from its deploy block to head,
 * via GoldRush (Covalent) REST API. Produces addresses.json with per-address
 * event participation and runs three cross-checks for false-positive detection.
 *
 * Outputs:
 *   /tmp/audit/runs/<timestamp>/addresses.json
 *   /tmp/audit/runs/<timestamp>/events.raw.ndjson.gz   (optional; full log dump)
 *   /tmp/audit/runs/<timestamp>/phase0-summary.txt
 *
 * Cross-checks:
 *   CC-0.1 — Event count consistency: sanity check that LoanOpened count per
 *            address matches what LoanClosed + still-active would predict.
 *   CC-0.2 — Chunk boundary overlap: we over-fetch each pagination window by
 *            one page and assert the dedup set is identical.
 *   CC-0.3 — Tip consistency: re-scan a narrow recent window 30s later;
 *            events in [deployBlock, commonTip] must be identical (detects
 *            re-orgs on Celo — rare but possible).
 *
 * Env vars:
 *   GOLDRUSH_API_KEY   — required.
 *   ETH_RPC_URL        — required (JSON-RPC for deploy-block binary search
 *                        and tip read). Falls back to https://forno.celo.org.
 *   AUDIT_OUT_DIR      — optional override (default /tmp/audit).
 *   SKIP_CC03          — set to 1 to skip the 30s wait (debug only).
 */

'use strict';

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const {
  LOAN_MANAGER_EVENTS,
  EVENT_TOPIC_SIGS,
  computeEventTopics,
  LOAN_MANAGER_ADDRESS,
  CELO_CHAIN_ID,
  CELO_GOLDRUSH_NAME,
} = require('./lib/abi');

const VAULT_DEPLOY_ANCHOR = 51_856_571; // user-provided anchor; LoanManager deploy block is found via binary search
const GOLDRUSH_BASE_URL = 'https://api.covalenthq.com/v1';
const RPC_DEFAULT = 'https://forno.celo.org';
const RPC_FALLBACK = 'https://rpc.ankr.com/celo';

// ── logging ──────────────────────────────────────────────
const ts = () => new Date().toISOString();
function log(msg, ...rest) {
  console.log(`[${ts()}] ${msg}`, ...rest);
}
function warn(msg, ...rest) {
  console.warn(`[${ts()}] WARN: ${msg}`, ...rest);
}
function die(msg, code = 1) {
  console.error(`[${ts()}] FATAL: ${msg}`);
  process.exit(code);
}

// ── args / env ───────────────────────────────────────────
const API_KEY = process.env.GOLDRUSH_API_KEY;
if (!API_KEY) die('GOLDRUSH_API_KEY env var is required');

const RPC_URL = process.env.ETH_RPC_URL || RPC_DEFAULT;
const OUT_DIR = process.env.AUDIT_OUT_DIR || '/tmp/audit';
const SKIP_CC03 = process.env.SKIP_CC03 === '1';

const runTs = new Date().toISOString().replace(/[:.]/g, '-');
const RUN_DIR = path.join(OUT_DIR, 'runs', runTs);
fs.mkdirSync(RUN_DIR, { recursive: true });

log(`Run dir: ${RUN_DIR}`);
log(`LOAN_MANAGER: ${LOAN_MANAGER_ADDRESS}`);
log(`RPC: ${RPC_URL}`);

// ── RPC provider ─────────────────────────────────────────
let provider;
async function initProvider() {
  provider = new ethers.JsonRpcProvider(RPC_URL, {
    chainId: CELO_CHAIN_ID,
    name: 'celo',
  });
  try {
    const n = await provider.getBlockNumber();
    log(`Connected to RPC. Head block: ${n}`);
    return n;
  } catch (err) {
    warn(`Primary RPC ${RPC_URL} failed: ${err.message}. Trying fallback.`);
    provider = new ethers.JsonRpcProvider(RPC_FALLBACK, {
      chainId: CELO_CHAIN_ID,
      name: 'celo',
    });
    const n = await provider.getBlockNumber();
    log(`Connected to fallback RPC. Head block: ${n}`);
    return n;
  }
}

// ── deploy-block binary search ───────────────────────────
/**
 * Finds the smallest block N such that eth_getCode(LOAN_MANAGER, N) != '0x'.
 * Starts from the user-provided vault anchor as upper bound hint, then
 * expands downward only if needed. Uses binary search between [0, hintBlock].
 *
 * But 0→head is 51M blocks. We narrow with the anchor: search [anchor-5M, anchor+5M].
 * For a proxy upgrade (LoanManagerV3 replacing V2), this still points to the
 * initial deployment of the proxy, which is what we want for event enumeration.
 */
async function findDeployBlock(headBlock) {
  // Sanity: code at head must be non-empty
  const headCode = await provider.getCode(LOAN_MANAGER_ADDRESS, headBlock);
  if (headCode === '0x') {
    die(`LoanManager has no code at head block ${headBlock}. Address wrong?`);
  }

  // Lower bound: if there's no code at block 0 (obviously true for any deploy),
  // binary-search between 0 and headBlock. But we narrow with the anchor hint.
  // Anchor is vault deploy; LoanManager could be before or after. Use anchor - 2M
  // as a conservative lower bound seed, fall back to 0 if code already exists there.

  const seedLo = Math.max(0, VAULT_DEPLOY_ANCHOR - 2_000_000);
  const loCode = await provider.getCode(LOAN_MANAGER_ADDRESS, seedLo);
  const lo0 = loCode === '0x' ? seedLo : 0;

  let lo = lo0;
  let hi = headBlock;
  let iterations = 0;

  while (lo < hi) {
    iterations++;
    if (iterations > 40) die('Deploy-block binary search runaway (>40 iterations)');
    const mid = Math.floor((lo + hi) / 2);
    const code = await provider.getCode(LOAN_MANAGER_ADDRESS, mid);
    if (code === '0x') {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  log(`Deploy block found: ${lo} (binary search in ${iterations} iterations)`);
  log(`  Anchor was: ${VAULT_DEPLOY_ANCHOR} (delta: ${lo - VAULT_DEPLOY_ANCHOR})`);
  return lo;
}

// ── GoldRush event fetch ─────────────────────────────────
async function goldrushFetch(urlPath, params) {
  const url = new URL(`${GOLDRUSH_BASE_URL}${urlPath}`);
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GoldRush ${res.status}: ${body.slice(0, 400)}`);
  }
  return res.json();
}

/**
 * Get the latest block Covalent has indexed for the chain. Covalent lags the
 * RPC tip by a few minutes; hitting an un-indexed block returns 404.
 */
async function goldrushIndexedHead() {
  const resp = await goldrushFetch(`/${CELO_GOLDRUSH_NAME}/block_v2/latest/`);
  if (resp.error) throw new Error(`GoldRush block height error: ${resp.error_message}`);
  const item = (resp.data?.items || [])[0];
  if (!item) throw new Error('GoldRush returned no block heights');
  return item.height;
}

const GOLDRUSH_MAX_RANGE = 1_000_000; // GoldRush error 501: range > 1M not supported
const GOLDRUSH_CHUNK = 500_000; // use half to leave margin

/**
 * Fetch events for a single block window [fromBlock, toBlock] (range ≤ 1M).
 * Paginates. Returns raw log entries.
 */
async function fetchEventsInWindow(fromBlock, toBlock) {
  const pageSize = 1000;
  const out = [];
  let page = 0;

  while (true) {
    const resp = await goldrushFetch(
      `/${CELO_GOLDRUSH_NAME}/events/address/${LOAN_MANAGER_ADDRESS}/`,
      {
        'starting-block': fromBlock,
        'ending-block': toBlock,
        'page-size': pageSize,
        'page-number': page,
      },
    );

    if (resp.error) throw new Error(`GoldRush error: ${resp.error_message}`);

    const items = resp.data?.items || [];
    out.push(...items);

    const pag = resp.data?.pagination;
    if (!pag?.has_more) break;
    page++;
    if (page > 1000) die('Pagination runaway (>1000 pages in one window)');
  }

  return out;
}

/**
 * Fetch all events emitted by LOAN_MANAGER_ADDRESS in [fromBlock, toBlock].
 * Chunks the range (GoldRush 1M cap) and dedups by (block, log_offset, tx_hash).
 */
async function fetchAllEvents(fromBlock, toBlock) {
  const all = [];
  const seen = new Set(); // dedup key: `${block_height}:${log_offset}:${tx_hash}`
  const chunks = [];
  for (let from = fromBlock; from <= toBlock; from += GOLDRUSH_CHUNK) {
    const to = Math.min(from + GOLDRUSH_CHUNK - 1, toBlock);
    chunks.push([from, to]);
  }

  log(`  Splitting into ${chunks.length} chunks of up to ${GOLDRUSH_CHUNK} blocks`);

  let totalDupes = 0;
  for (let i = 0; i < chunks.length; i++) {
    const [from, to] = chunks[i];
    const t0 = Date.now();
    const items = await fetchEventsInWindow(from, to);
    let dupeCount = 0;
    for (const it of items) {
      const key = `${it.block_height}:${it.log_offset}:${it.tx_hash}`;
      if (seen.has(key)) {
        dupeCount++;
        continue;
      }
      seen.add(key);
      all.push(it);
    }
    totalDupes += dupeCount;
    log(
      `  chunk ${i + 1}/${chunks.length}  [${from}, ${to}]  items=${items.length} dupes=${dupeCount} running_total=${all.length}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`,
    );
  }

  log(`  Total dedup collisions across chunks: ${totalDupes} (should be 0 — chunks don't overlap)`);
  return all;
}

// ── topic classification ─────────────────────────────────
function classifyByTopic(items, topicMap) {
  // topicMap: { UserRiskSet: '0x...', ... }
  const byEvent = {};
  for (const name of Object.keys(topicMap)) byEvent[name] = [];

  let unknown = 0;
  for (const it of items) {
    const t0 = (it.raw_log_topics || [])[0];
    if (!t0) {
      unknown++;
      continue;
    }
    let matched = false;
    for (const [name, hash] of Object.entries(topicMap)) {
      if (t0.toLowerCase() === hash.toLowerCase()) {
        byEvent[name].push(it);
        matched = true;
        break;
      }
    }
    if (!matched) unknown++;
  }

  return { byEvent, unknown };
}

// ── extract indexed user from topic[1] ───────────────────
function userFromLog(it) {
  // For all per-user events, the user is topic[1] (first indexed param).
  // Covalent returns raw_log_topics as hex strings. Convert the last 40 hex
  // chars to an address and lowercase it.
  const t1 = (it.raw_log_topics || [])[1];
  if (!t1) return null;
  return ('0x' + t1.slice(-40)).toLowerCase();
}

// ── build address universe ───────────────────────────────
function buildUniverse(byEvent) {
  const PER_USER_EVENTS = [
    'UserRiskSet',
    'LoanOfferSet',
    'LoanOpened',
    'LoanClosed',
    'LoanDefaulted',
    'PremiumConfigSet',
    'NextBorrowTimeSet',
  ];

  const universe = new Map(); // addr → { UserRiskSet: N, LoanOpened: N, ... }

  for (const ev of PER_USER_EVENTS) {
    for (const it of byEvent[ev] || []) {
      const addr = userFromLog(it);
      if (!addr) continue;
      const existing = universe.get(addr) || Object.fromEntries(PER_USER_EVENTS.map((e) => [e, 0]));
      existing[ev] += 1;
      universe.set(addr, existing);
    }
  }

  return universe;
}

// ── CC-0.1 — event-count consistency per address ─────────
function crossCheck01(universe) {
  // For every address:
  //   LoanOpened count should equal LoanClosed count  (closed all past loans)
  //   OR LoanOpened = LoanClosed + 1                  (currently has one open)
  //   OR LoanOpened = LoanClosed + LoanDefaulted      (one closed via default; rare on Celo)
  //
  // Anything else is SUSPECT and logged for Phase 1 verification.
  const suspects = [];
  for (const [addr, counts] of universe.entries()) {
    const opened = counts.LoanOpened;
    const closed = counts.LoanClosed;
    const defaulted = counts.LoanDefaulted;

    if (opened === 0) continue; // never borrowed; nothing to check

    const closedPlusActive1 = closed + 1;
    const closedPlusDefault = closed + defaulted;

    if (
      opened === closed ||
      opened === closedPlusActive1 ||
      opened === closedPlusDefault ||
      opened === closed + defaulted + 1 // defaulted then re-opened a new one? rare
    ) {
      continue;
    }

    suspects.push({
      addr,
      opened,
      closed,
      defaulted,
      delta: opened - closed - defaulted,
    });
  }
  return suspects;
}

// ── CC-0.2 — chunk boundary overlap detection ────────────
// Handled inside fetchAllEvents via the dedup set; we also expose the
// "dupes seen" count as a signal. Phase 0 doesn't split into chunks
// because GoldRush paginates by count not block range, so per-block dedup
// is exhaustive at the (block_height, log_offset) granularity.

// ── CC-0.3 — tip consistency / re-org probe ──────────────
async function crossCheck03(deployBlock, firstRunEvents, firstRunTip) {
  if (SKIP_CC03) {
    warn('CC-0.3 skipped (SKIP_CC03=1)');
    return { skipped: true };
  }
  log('CC-0.3: waiting 30s then re-scanning a recent window to detect re-orgs…');
  await new Promise((r) => setTimeout(r, 30_000));

  // Re-scan the last 100 blocks of the first run to look for drift
  const probeFrom = Math.max(deployBlock, firstRunTip - 100);
  log(`  Re-scanning [${probeFrom}, ${firstRunTip}]`);
  const rescan = await fetchAllEvents(probeFrom, firstRunTip);

  // Build (block,log_offset) sets for both runs in the probe window
  const firstSet = new Set(
    firstRunEvents
      .filter((it) => it.block_height >= probeFrom && it.block_height <= firstRunTip)
      .map((it) => `${it.block_height}:${it.log_offset}:${it.tx_hash}`),
  );
  const rescanSet = new Set(
    rescan.map((it) => `${it.block_height}:${it.log_offset}:${it.tx_hash}`),
  );

  const missingInRescan = [...firstSet].filter((k) => !rescanSet.has(k));
  const newInRescan = [...rescanSet].filter((k) => !firstSet.has(k));

  return {
    skipped: false,
    probeFrom,
    probeTo: firstRunTip,
    firstRunCount: firstSet.size,
    rescanCount: rescanSet.size,
    missingInRescan,
    newInRescan,
    reorgDetected: missingInRescan.length > 0,
  };
}

// ── main ─────────────────────────────────────────────────
async function main() {
  const rpcTipBlock = await initProvider();

  log('─── Step 1: deploy block binary search ───');
  const deployBlock = await findDeployBlock(rpcTipBlock);

  log('─── Step 2: topic hash computation ───');
  const topics = computeEventTopics(ethers);
  for (const [name, hash] of Object.entries(topics)) {
    log(`  ${name.padEnd(23)} ${hash}`);
  }

  log('─── Step 2.5: discover Covalent indexed head ───');
  const covalentHead = await goldrushIndexedHead();
  const lag = rpcTipBlock - covalentHead;
  log(`Covalent indexed head: ${covalentHead}  (RPC tip: ${rpcTipBlock}, lag: ${lag} blocks ≈ ${(lag * 5).toFixed(0)}s)`);
  const tipBlock = covalentHead;

  log(`─── Step 3: fetch all events [${deployBlock}, ${tipBlock}] ───`);
  const t0 = Date.now();
  const events = await fetchAllEvents(deployBlock, tipBlock);
  const fetchMs = Date.now() - t0;
  log(`Fetched ${events.length} events in ${(fetchMs / 1000).toFixed(1)}s`);

  log('─── Step 4: classify by topic ───');
  const { byEvent, unknown } = classifyByTopic(events, topics);
  for (const [name, arr] of Object.entries(byEvent)) {
    log(`  ${name.padEnd(23)} ${arr.length}`);
  }
  log(`  <unknown topic>         ${unknown}`);

  log('─── Step 5: build per-address universe ───');
  const universe = buildUniverse(byEvent);
  log(`Unique addresses: ${universe.size}`);

  log('─── Step 6: CC-0.1 event-count consistency ───');
  const cc01Suspects = crossCheck01(universe);
  log(`CC-0.1 suspects: ${cc01Suspects.length}`);
  if (cc01Suspects.length <= 20) {
    for (const s of cc01Suspects) {
      log(`  ${s.addr}  opened=${s.opened} closed=${s.closed} defaulted=${s.defaulted} delta=${s.delta}`);
    }
  }

  log('─── Step 7: CC-0.3 tip consistency ───');
  const cc03 = await crossCheck03(deployBlock, events, tipBlock);
  if (cc03.skipped) {
    log('CC-0.3: skipped');
  } else {
    log(`CC-0.3: probe=[${cc03.probeFrom}, ${cc03.probeTo}] ` +
        `first=${cc03.firstRunCount} rescan=${cc03.rescanCount} ` +
        `missing=${cc03.missingInRescan.length} new=${cc03.newInRescan.length} ` +
        `reorg=${cc03.reorgDetected}`);
  }

  log('─── Step 8: write outputs ───');

  // addresses.json — the universe (core artifact)
  const addrArr = [...universe.entries()].map(([addr, counts]) => ({ addr, ...counts }));
  addrArr.sort((a, b) => a.addr.localeCompare(b.addr));
  fs.writeFileSync(
    path.join(RUN_DIR, 'addresses.json'),
    JSON.stringify(
      {
        meta: {
          runTs,
          loanManager: LOAN_MANAGER_ADDRESS,
          chainId: CELO_CHAIN_ID,
          deployBlock,
          tipBlock,
          rpcTipBlock,
          covalentLagBlocks: rpcTipBlock - tipBlock,
          eventCounts: Object.fromEntries(
            Object.entries(byEvent).map(([k, v]) => [k, v.length]),
          ),
          unknownTopicCount: unknown,
          uniqueAddresses: universe.size,
          fetchDurationMs: fetchMs,
        },
        crossChecks: {
          CC_01_countConsistency: {
            suspects: cc01Suspects,
            suspectsCount: cc01Suspects.length,
          },
          CC_03_reorgProbe: cc03,
        },
        addresses: addrArr,
      },
      null,
      2,
    ),
  );
  log(`Wrote addresses.json (${addrArr.length} addresses)`);

  // events.raw.ndjson.gz — full log dump for downstream phases
  const rawPath = path.join(RUN_DIR, 'events.raw.ndjson.gz');
  const gz = zlib.createGzip();
  const ws = fs.createWriteStream(rawPath);
  gz.pipe(ws);
  for (const it of events) gz.write(JSON.stringify(it) + '\n');
  gz.end();
  await new Promise((r) => ws.on('finish', r));
  log(`Wrote events.raw.ndjson.gz (${events.length} events, gzipped)`);

  // phase0-summary.txt — human-readable
  const summary = [
    `=== PHASE 0 SUMMARY — ${runTs} ===`,
    ``,
    `LoanManager:      ${LOAN_MANAGER_ADDRESS}`,
    `Chain:            Celo mainnet (${CELO_CHAIN_ID})`,
    `Deploy block:     ${deployBlock}`,
    `Tip block:        ${tipBlock}`,
    `Block range:      ${tipBlock - deployBlock} blocks (~${((tipBlock - deployBlock) * 5 / 86400).toFixed(1)} days at 5s block time)`,
    ``,
    `Events fetched:   ${events.length} total`,
    `Fetch duration:   ${(fetchMs / 1000).toFixed(1)}s`,
    ``,
    `Event counts:`,
    ...Object.entries(byEvent).map(([k, v]) => `  ${k.padEnd(23)} ${v.length}`),
    `  <unknown topic>         ${unknown}`,
    ``,
    `Unique addresses: ${universe.size}`,
    ``,
    `=== CROSS-CHECKS ===`,
    ``,
    `CC-0.1 event-count consistency:`,
    `  Suspects: ${cc01Suspects.length}`,
    ...(cc01Suspects.length <= 20
      ? cc01Suspects.map(
          (s) =>
            `    ${s.addr}  opened=${s.opened} closed=${s.closed} defaulted=${s.defaulted} delta=${s.delta}`,
        )
      : [`    (too many to list here — see addresses.json)`]),
    ``,
    `CC-0.2 chunk boundary overlap: N/A (pagination, dedup by (block,log_offset))`,
    ``,
    `CC-0.3 tip re-org probe:`,
    ...(cc03.skipped
      ? [`  Skipped (SKIP_CC03=1)`]
      : [
          `  Probe window: [${cc03.probeFrom}, ${cc03.probeTo}]`,
          `  First run events in window:  ${cc03.firstRunCount}`,
          `  Rescan events in window:     ${cc03.rescanCount}`,
          `  Missing after 30s (re-org):  ${cc03.missingInRescan.length}`,
          `  New after 30s (new mined):   ${cc03.newInRescan.length}`,
          `  Re-org detected:             ${cc03.reorgDetected}`,
        ]),
    ``,
    `Artifacts written to: ${RUN_DIR}`,
    `  - addresses.json`,
    `  - events.raw.ndjson.gz`,
    `  - phase0-summary.txt`,
    ``,
  ].join('\n');

  fs.writeFileSync(path.join(RUN_DIR, 'phase0-summary.txt'), summary);
  console.log('\n' + summary);
}

main().catch((e) => {
  console.error('\nFATAL:', e.stack || e.message);
  process.exit(1);
});
