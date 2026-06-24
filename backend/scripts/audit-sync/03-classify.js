#!/usr/bin/env node
/**
 * Phase 1c — Classify every invariant with redundant cross-checks.
 *
 * Inputs:
 *   ${AUDIT_RUN_DIR}/addresses.json    — Phase 0 event enumeration
 *   ${AUDIT_RUN_DIR}/events.raw.ndjson.gz — Phase 0 raw event dump
 *   ${AUDIT_RUN_DIR}/chain.json        — Phase 1a per-address chain snapshot
 *   ${AUDIT_DB_SNAPSHOT}               — Phase 1b DB dump (from 01-snapshot.sql)
 *
 * Outputs:
 *   ${AUDIT_RUN_DIR}/report.json       — per-address classification, all categories
 *   ${AUDIT_RUN_DIR}/plan.sql          — reconciliation SQL by category, commented
 *   ${AUDIT_RUN_DIR}/work-orders.json  — chain write operations to delegate
 *   ${AUDIT_RUN_DIR}/phase1c-summary.txt
 *
 * The script computes, for every address and every invariant, the *primary*
 * detection signal plus at least one independent cross-check before labelling
 * something a real finding. Findings with insufficient cross-check agreement
 * are marked "needs-manual-review" rather than auto-reconciled.
 */

'use strict';
const fs = require('fs');
const zlib = require('zlib');
const readline = require('readline');
const path = require('path');
const { ethers } = require('ethers');

const { EVENT_TOPIC_SIGS } = require('./lib/abi');

const RUN_DIR = process.env.AUDIT_RUN_DIR;
const DB_SNAPSHOT = process.env.AUDIT_DB_SNAPSHOT;

if (!RUN_DIR) { console.error('FATAL: AUDIT_RUN_DIR required'); process.exit(1); }
if (!DB_SNAPSHOT) { console.error('FATAL: AUDIT_DB_SNAPSHOT required (path to 01-snapshot.sql output)'); process.exit(1); }
if (!fs.existsSync(DB_SNAPSHOT)) { console.error(`FATAL: ${DB_SNAPSHOT} not found`); process.exit(1); }

const ts = () => new Date().toISOString();
function log(msg, ...rest) { console.log(`[${ts()}] ${msg}`, ...rest); }
function warn(msg, ...rest) { console.warn(`[${ts()}] WARN: ${msg}`, ...rest); }

const USDC_DECIMALS = 6;
const USDC_UNIT = 10n ** BigInt(USDC_DECIMALS);

// Tolerances
const LOAN_START_TOLERANCE_SEC = 60;
const AMOUNT_TOLERANCE_USDC_UNITS = 10_000n; // 0.01 USDC
const LIMIT_TOLERANCE_USDC_UNITS = 1_000_000n; // 1 USDC

// Testing-wallet exclusions (for Category U-F)
let testingWallets = new Set();
try {
  const tw = JSON.parse(fs.readFileSync(path.join(__dirname, 'testing-wallets.json'), 'utf8'));
  testingWallets = new Set((tw.wallets || []).map((w) => w.addr.toLowerCase()));
  log(`Loaded ${testingWallets.size} testing wallets from testing-wallets.json`);
} catch (e) {
  warn(`No testing-wallets.json (or parse failed): ${e.message}`);
}

// ── parse DB snapshot ────────────────────────────────────
function parseDbSnapshot(filepath) {
  const raw = fs.readFileSync(filepath, 'utf8');
  const lines = raw.split('\n');
  const sections = {
    META: [],
    USERS: [],
    LOANS: [],
    MIGRATIONS: [],
    INDEXES_LOANS: [],
    ENUM_LOAN_STATUS: [],
  };
  let cur = null;
  for (const line of lines) {
    const trim = line.trim();
    if (!trim) continue;
    const m = trim.match(/^===(\w+)===$/);
    if (m) {
      cur = m[1];
      continue;
    }
    if (cur === 'END') break;
    if (cur && sections[cur] !== undefined) {
      try {
        sections[cur].push(JSON.parse(trim));
      } catch (e) {
        // tolerate ragged lines (psql sometimes emits extra blank lines / multi-line JSON)
      }
    }
  }
  return {
    meta: sections.META[0] || null,
    users: sections.USERS,
    loans: sections.LOANS,
    migrations: sections.MIGRATIONS,
    indexes: sections.INDEXES_LOANS,
    enumStatus: sections.ENUM_LOAN_STATUS,
  };
}

// ── parse event dump (streaming) ─────────────────────────
async function loadEvents(gzPath) {
  const byAddr = new Map(); // addr → { opened: [], closed: [], offerSet: [], defaulted: [], userRiskSet: [], premiumSet: [], nextBorrow: [] }
  const topics = {};
  for (const [name, sig] of Object.entries(EVENT_TOPIC_SIGS)) {
    topics[ethers.id(sig).toLowerCase()] = name;
  }

  const rs = fs.createReadStream(gzPath).pipe(zlib.createGunzip());
  const rl = readline.createInterface({ input: rs });

  for await (const line of rl) {
    if (!line.trim()) continue;
    const it = JSON.parse(line);
    const t0 = (it.raw_log_topics || [])[0]?.toLowerCase();
    const name = topics[t0];
    if (!name) continue;
    const user = '0x' + ((it.raw_log_topics || [])[1] || '').slice(-40);
    const addr = user.toLowerCase();
    if (addr === '0x') continue;

    const rec = {
      block: it.block_height,
      logIndex: it.log_offset,
      tx: it.tx_hash,
      when: it.block_signed_at,
      data: it.raw_log_data,
      topics: it.raw_log_topics,
    };
    if (!byAddr.has(addr)) {
      byAddr.set(addr, {
        UserRiskSet: [],
        LoanOfferSet: [],
        LoanOpened: [],
        LoanClosed: [],
        LoanDefaulted: [],
        PremiumConfigSet: [],
        NextBorrowTimeSet: [],
      });
    }
    const bucket = byAddr.get(addr);
    if (bucket[name]) bucket[name].push(rec);
  }

  // Sort every bucket by (block, logIndex)
  for (const buckets of byAddr.values()) {
    for (const arr of Object.values(buckets)) {
      arr.sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);
    }
  }
  return byAddr;
}

// ── parse LoanOpened log data ────────────────────────────
// event LoanOpened(address indexed user, uint256 principal, uint256 amountDue, uint64 due, uint16 feeBps, uint32 gracePeriod)
function parseLoanOpened(ev) {
  const data = ev.data || '';
  const hex = data.startsWith('0x') ? data.slice(2) : data;
  // Non-indexed params: principal(32) + amountDue(32) + due(32) + feeBps(32) + gracePeriod(32) = 160 bytes = 320 hex
  if (hex.length < 320) return null;
  const principal = BigInt('0x' + hex.slice(0, 64));
  const amountDue = BigInt('0x' + hex.slice(64, 128));
  const due = Number(BigInt('0x' + hex.slice(128, 192)));
  const feeBps = Number(BigInt('0x' + hex.slice(192, 256)));
  const gracePeriod = Number(BigInt('0x' + hex.slice(256, 320)));
  return { principal, amountDue, due, feeBps, gracePeriod };
}

// event LoanClosed(address indexed user, uint256 paid)
function parseLoanClosed(ev) {
  const hex = (ev.data || '').replace(/^0x/, '');
  if (hex.length < 64) return null;
  return { paid: BigInt('0x' + hex.slice(0, 64)) };
}

// ── invariant checks ────────────────────────────────────

function toBigInt(v) {
  if (v == null) return null;
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(Math.round(v));
  if (typeof v === 'string') return BigInt(v);
  return null;
}

/**
 * Classify a single address across all invariants.
 * Returns { addr, findings: [{ category, severity, primary, crossChecks, ... }] }.
 */
function classifyAddress(addr, chainRec, dbUser, dbLoans, events, nowSec) {
  const findings = [];
  const add = (category, severity, detail) =>
    findings.push({ category, severity, ...detail });

  // Sort DB loans by id
  const sortedLoans = [...dbLoans].sort((a, b) => a.id - b.id);
  const latestLoan = sortedLoans[sortedLoans.length - 1] || null;
  const openLoans = sortedLoans.filter(
    (l) => l.status === 'open' && l.closedAt == null,
  );
  const openLoan = openLoans[0] || null;

  // ── L-A / L-B / L-C / L-E / L-H on the latest loan ──
  const chainActive = !!chainRec?.loan.active;
  const chainStart = Number(chainRec?.loan.start || 0);

  if (chainActive && openLoan) {
    // Both think there's an active loan. Check fields (L-A vs L-I).
    const dbStartSec = Math.floor(new Date(openLoan.startAt).getTime() / 1000);
    const startDelta = Math.abs(chainStart - dbStartSec);

    const principalDelta = absDiff(
      toBigInt(chainRec.loan.principal),
      toUsdcUnits(openLoan.principal),
    );
    const amountDueDelta = absDiff(
      toBigInt(chainRec.loan.amountDue),
      toUsdcUnits(openLoan.amountDueAtOpen),
    );

    if (startDelta > LOAN_START_TOLERANCE_SEC) {
      add('L-I', 'high', {
        primary: `startAt drift: chain=${chainStart} db=${dbStartSec} delta=${startDelta}s`,
        crossChecks: [
          `openLoans count in DB: ${openLoans.length}`,
          `latest DB loan id: ${openLoan.id}`,
        ],
        loanId: openLoan.id,
      });
    }
    if (principalDelta > AMOUNT_TOLERANCE_USDC_UNITS) {
      add('L-I', 'medium', {
        primary: `principal drift: chain=${chainRec.loan.principal} db=${toUsdcUnits(openLoan.principal)} delta=${principalDelta}`,
        crossChecks: [`loanId=${openLoan.id}`],
        loanId: openLoan.id,
      });
    }
    // amountDue skew is OK if late fees accrued — only flag if >10 USDC delta
    if (amountDueDelta > 10n * USDC_UNIT) {
      const lastAccruedFromPreview = chainRec?.preview?.amountDueWithLate
        ? toBigInt(chainRec.preview.amountDueWithLate)
        : null;
      add('L-I', 'low', {
        primary: `amountDue drift: chain=${chainRec.loan.amountDue} db_atOpen=${toUsdcUnits(openLoan.amountDueAtOpen)} delta=${amountDueDelta}`,
        crossChecks: [
          `preview.amountDueWithLate=${lastAccruedFromPreview}  (if >chain.amountDue, late fees have accrued — expected drift)`,
        ],
        loanId: openLoan.id,
      });
    }
    if (openLoan.tenorDays) {
      const chainTenor = Math.round((Number(chainRec.loan.due) - chainStart) / 86400);
      if (openLoan.tenorDays !== chainTenor) {
        add('L-I', 'medium', {
          primary: `tenor drift: chain=${chainTenor} db=${openLoan.tenorDays}`,
          crossChecks: [`chain due=${chainRec.loan.due} chain start=${chainStart}`],
          loanId: openLoan.id,
        });
      }
    }
    if (Number(chainRec.loan.feeBps) !== openLoan.feeBps) {
      add('L-I', 'medium', {
        primary: `feeBps drift: chain=${chainRec.loan.feeBps} db=${openLoan.feeBps}`,
        crossChecks: [`loanId=${openLoan.id}`],
        loanId: openLoan.id,
      });
    }
  }

  if (chainActive && !openLoan) {
    // Chain has an active loan but DB has no open row.
    // Could be L-C (latest DB loan is repaid for same loan) or L-E (new loan after DB close).
    if (latestLoan && ['repaid_on_time', 'repaid_late'].includes(latestLoan.status)) {
      const dbStart = Math.floor(new Date(latestLoan.startAt).getTime() / 1000);
      const startDelta = Math.abs(chainStart - dbStart);
      if (startDelta <= LOAN_START_TOLERANCE_SEC) {
        // L-C: same loan, DB says repaid but chain says active.
        // Cross-checks:
        //   1. chain-event LoanClosed for this loan MUST NOT exist (or it mined AFTER chain read)
        //   2. chain-event LoanOpened for latest DB loan must match startAt
        const closedAfterStart = (events?.LoanClosed || []).filter(
          (e) => e.block > (events?.LoanOpened || []).slice(-1)[0]?.block,
        );
        add('L-C', 'high', {
          primary: `DB status=${latestLoan.status} but chain loan.active=true with matching startAt (delta=${startDelta}s)`,
          crossChecks: [
            `DB closeTxHash=${latestLoan.closeTxHash}`,
            `chain-events LoanClosed after latest LoanOpened: ${closedAfterStart.length} (should be 0 for L-C)`,
            `DB closedAt=${latestLoan.closedAt}`,
          ],
          loanId: latestLoan.id,
          heuristicAvoided: 'chainStart <= closedAt (poisoned by M1/M4 batch updates)',
        });
      } else if (chainStart > dbStart + 10) {
        // L-E: new loan after DB close — chain start is later than latest DB close
        const openedAfterLatestClose = (events?.LoanOpened || []).filter(
          (e) => Number(e.data && parseLoanOpened(e)?.due) > dbStart,
        );
        add('L-E', 'high', {
          primary: `Chain loan started ${chainStart - dbStart}s after DB latest close — new loan was opened but inform-open never recorded it`,
          crossChecks: [
            `DB latest loanId=${latestLoan.id} closedAt=${latestLoan.closedAt}`,
            `chain loan.start=${chainStart}`,
            `chain LoanOpened events after latestDbStart: ${openedAfterLatestClose.length}`,
          ],
          chainLoanOpened: (events?.LoanOpened || []).slice(-1)[0] || null,
        });
      }
    }
  }

  if (!chainActive && openLoan) {
    // DB says open but chain says not active.
    // L-B1: LoanClosed event exists → DB missed the repayment
    // L-B2: no LoanOpened matching DB's openTxHash → ghost open
    const openedForThisTx = (events?.LoanOpened || []).find(
      (e) => e.tx === openLoan.openTxHash,
    );
    const closedAfterDbOpen = (events?.LoanClosed || []).filter((e) => {
      const opened = (events?.LoanOpened || []).find((o) => o.block <= e.block);
      return opened && opened.tx === openLoan.openTxHash;
    });
    if (closedAfterDbOpen.length > 0) {
      add('L-B1', 'high', {
        primary: `DB status=open but chain active=false AND LoanClosed event exists`,
        crossChecks: [
          `DB openTxHash=${openLoan.openTxHash}`,
          `chain LoanClosed events matched to this loan: ${closedAfterDbOpen.length}`,
          `closeTx=${closedAfterDbOpen[0]?.tx}`,
        ],
        loanId: openLoan.id,
        closeEvent: closedAfterDbOpen[0] || null,
      });
    } else if (!openedForThisTx) {
      add('L-B2', 'high', {
        primary: `DB status=open but chain active=false AND no matching LoanOpened event for openTxHash`,
        crossChecks: [
          `DB openTxHash=${openLoan.openTxHash}`,
          `chain LoanOpened events for addr: ${(events?.LoanOpened || []).length}`,
        ],
        loanId: openLoan.id,
      });
    } else {
      // Has matching open event but chain says inactive and no close event — this is weird
      add('L-B-other', 'medium', {
        primary: `DB open, chain inactive, open event present but no close event`,
        crossChecks: [
          `DB openTxHash=${openLoan.openTxHash} matched chain event`,
          `chain LoanClosed events: ${(events?.LoanClosed || []).length}`,
        ],
        loanId: openLoan.id,
      });
    }
  }

  // ── L-D zombie reverts ──
  for (const l of sortedLoans) {
    if (l.status === 'open' && l.closeTxHash) {
      add('L-D', 'high', {
        primary: `zombie: status=open with closeTxHash=${l.closeTxHash}`,
        crossChecks: [`chain active=${chainActive}`, `DB closedAt=${l.closedAt}`],
        loanId: l.id,
      });
    }
  }

  // ── L-F multi-open per user ──
  if (openLoans.length > 1) {
    add('L-F', 'high', {
      primary: `${openLoans.length} rows with status=open for this user`,
      crossChecks: [`ids=${openLoans.map((l) => l.id).join(',')}`],
    });
  }

  // ── L-H defaulted mismatch ──
  const defaultedLoans = sortedLoans.filter((l) => l.status === 'defaulted');
  for (const l of defaultedLoans) {
    if (!chainRec?.isDefaulted) {
      add('L-H', 'medium', {
        primary: `DB status=defaulted but chain isDefaulted=false (markDefault never called)`,
        crossChecks: [
          `chain active=${chainActive}`,
          `loanId=${l.id}`,
          `LoanDefaulted events: ${(events?.LoanDefaulted || []).length}`,
        ],
        loanId: l.id,
      });
    }
  }

  // ── U-A creditLimit drift ──
  // All checks below require both a DB user AND a chain record. DB-only users
  // (signed up but never verified on-chain) have no chainRec — U-G handles
  // "DB verified but no chain event" at the global level.
  if (dbUser && chainRec) {
    const chainLimitUnits = toBigInt(chainRec.userRisk.limit);
    const dbLimitUnits = userLimitToUnits(dbUser.creditLimit);
    if (chainLimitUnits != null && dbLimitUnits != null) {
      const delta = absDiff(chainLimitUnits, dbLimitUnits);
      if (delta > LIMIT_TOLERANCE_USDC_UNITS) {
        const cat = chainLimitUnits > dbLimitUnits ? 'U-A1' : 'U-A2';
        add(cat, cat === 'U-A2' ? 'high' : 'medium', {
          primary: `${cat}: chain.limit=${chainLimitUnits} db.creditLimit=${dbLimitUnits} delta=${delta}`,
          crossChecks: [
            `userId=${dbUser.id}`,
            `chain kycOk=${chainRec.userRisk.kycOk}`,
            `chain validUntil=${chainRec.userRisk.validUntil} expired=${chainRec.userRisk.validUntil !== 0 && chainRec.userRisk.validUntil < nowSec}`,
          ],
          userId: dbUser.id,
        });
      }
    }

    // ── U-B score drift ──
    if (dbUser.score != null && Number(chainRec.userRisk.score) !== dbUser.score) {
      add('U-B', 'medium', {
        primary: `score drift: chain=${chainRec.userRisk.score} db=${dbUser.score}`,
        crossChecks: [`userId=${dbUser.id}`, `UserRiskSet events: ${(events?.UserRiskSet || []).length}`],
        userId: dbUser.id,
      });
    }

    // ── U-C kycOk drift ──
    if (dbUser.score != null && !chainRec.userRisk.kycOk) {
      add('U-C', 'high', {
        primary: `DB has score=${dbUser.score} (verified) but chain kycOk=false → creditLimit returns 0`,
        crossChecks: [`userId=${dbUser.id}`],
        userId: dbUser.id,
      });
    }

    // ── U-D validUntil expired for a verified user ──
    if (dbUser.score != null && chainRec.userRisk.validUntil !== 0 && chainRec.userRisk.validUntil < nowSec) {
      add('U-D', 'medium', {
        primary: `chain validUntil=${chainRec.userRisk.validUntil} expired (now=${nowSec}) but DB treats user as verified`,
        crossChecks: [
          `userId=${dbUser.id}`,
          `chain creditLimit=${chainRec.creditLimit} (should be 0 due to expiry)`,
          `chain kycOk=${chainRec.userRisk.kycOk}`,
        ],
        userId: dbUser.id,
      });
    }

    // ── U-E walletQuality ──
    if (dbUser.riskScoredAt && new Date(dbUser.riskScoredAt) >= new Date('2026-04-11') && dbUser.walletQuality == null) {
      add('U-E', 'info', {
        primary: `walletQuality null for user scored after 2026-04-11`,
        crossChecks: [`riskScoredAt=${dbUser.riskScoredAt}`],
        userId: dbUser.id,
      });
    }
  } else if (!dbUser && chainRec) {
    // ── U-F on-chain user not in DB ──
    if (!testingWallets.has(addr)) {
      add('U-F', 'high', {
        primary: `Address present in chain events but NOT in DB users table`,
        crossChecks: [
          `UserRiskSet events: ${(events?.UserRiskSet || []).length}`,
          `LoanOpened events: ${(events?.LoanOpened || []).length}`,
        ],
      });
    }
  }
  // else: dbUser && !chainRec → handled by global U-G check
  // else: !dbUser && !chainRec → this address shouldn't be in the universe (skip)

  // ── O-A offer+active mutex (CC-1.3) ──
  if (chainRec?.loan.active && chainRec?.offer.exists) {
    add('O-A', 'info', {
      primary: `offer.exists=true while loan.active=true (impossible per contract; historical race bug)`,
      crossChecks: [
        `chain tenor=${chainRec.offer.tenorDays} fee=${chainRec.offer.feeBps}`,
        `chain validUntil=${chainRec.offer.validUntil}`,
      ],
      resolution: 'self-healing on next borrow',
    });
  }

  return { addr, findings };
}

/**
 * Convert a LOANS.* amount (principal / amountDueAtOpen / amountPaid) from DB
 * to raw USDC 6-decimal units. Loans store HUMAN dollars (e.g. 10.00 = $10).
 */
function loanAmtToUnits(dbAmount) {
  if (dbAmount == null) return null;
  const n = Number(dbAmount);
  return BigInt(Math.round(n * Number(USDC_UNIT)));
}

/**
 * Convert a USERS.creditLimit value from DB to raw USDC 6-decimal units.
 * Users store RAW 6-decimal units (e.g. 12000000.00 = 12 USDC) — backend
 * calls `toUnits(ladderStep.limitUsdc, 6)` before writing.
 */
function userLimitToUnits(dbLimit) {
  if (dbLimit == null) return null;
  const n = Number(dbLimit);
  return BigInt(Math.round(n));
}

// Backwards-compat alias — all current callers are loan amounts except the one
// block that wants user limits, which we route to userLimitToUnits directly.
function toUsdcUnits(dbAmount) {
  return loanAmtToUnits(dbAmount);
}

function absDiff(a, b) {
  if (a == null || b == null) return null;
  return a > b ? a - b : b - a;
}

// ── main ─────────────────────────────────────────────────
async function main() {
  log(`Run dir:      ${RUN_DIR}`);
  log(`DB snapshot:  ${DB_SNAPSHOT}`);

  log('Loading chain.json...');
  const chain = JSON.parse(fs.readFileSync(path.join(RUN_DIR, 'chain.json'), 'utf8'));
  const chainByAddr = new Map();
  for (const r of chain.records) chainByAddr.set(r.addr.toLowerCase(), r);
  log(`  chain records: ${chain.records.length}`);

  log('Loading addresses.json...');
  const addrs = JSON.parse(fs.readFileSync(path.join(RUN_DIR, 'addresses.json'), 'utf8'));
  log(`  addresses: ${addrs.addresses.length}`);

  log('Parsing DB snapshot...');
  const db = parseDbSnapshot(DB_SNAPSHOT);
  if (!db.meta) die('DB snapshot has no ===META=== section');
  log(`  meta: users=${db.meta.usersCount} loans=${db.meta.loansCount} open=${db.meta.openLoansCount} zombies=${db.meta.zombieOpenLoans} dupOpenTx=${db.meta.duplicateOpenTxHash}`);
  log(`  parsed: users=${db.users.length} loans=${db.loans.length} migrations=${db.migrations.length} indexes=${db.indexes.length} enum=${db.enumStatus.length}`);

  const dbUserByAddr = new Map();
  for (const u of db.users) {
    if (u.walletAddress) dbUserByAddr.set(u.walletAddress.toLowerCase(), u);
  }
  const dbLoansByAddr = new Map();
  for (const l of db.loans) {
    const addr = (l.borrowerAddress || '').toLowerCase();
    if (!addr) continue;
    if (!dbLoansByAddr.has(addr)) dbLoansByAddr.set(addr, []);
    dbLoansByAddr.get(addr).push(l);
  }

  log('Loading event dump (streaming)...');
  const events = await loadEvents(path.join(RUN_DIR, 'events.raw.ndjson.gz'));
  log(`  addresses with events: ${events.size}`);

  // Universe: union of chain addresses AND DB user wallets
  const universeSet = new Set([
    ...chainByAddr.keys(),
    ...dbUserByAddr.keys(),
    ...dbLoansByAddr.keys(),
  ]);
  const universe = [...universeSet].sort();
  log(`Universe size: ${universe.length}`);

  const nowSec = Math.floor(Date.now() / 1000);
  const addrReports = [];
  const categoryCounts = {};

  for (const addr of universe) {
    const chainRec = chainByAddr.get(addr);
    const dbUser = dbUserByAddr.get(addr);
    const dbLoans = dbLoansByAddr.get(addr) || [];
    const evs = events.get(addr);
    if (!chainRec && !dbUser && dbLoans.length === 0) continue;

    const rep = classifyAddress(addr, chainRec, dbUser, dbLoans, evs, nowSec);
    if (rep.findings.length > 0) {
      addrReports.push(rep);
      for (const f of rep.findings) {
        categoryCounts[f.category] = (categoryCounts[f.category] || 0) + 1;
      }
    }
  }

  // ── global checks (L-G, schema, invariants X1–X3) ──
  const globalFindings = [];

  // L-G dup openTxHash
  const openTxHashCounts = new Map();
  for (const l of db.loans) {
    if (l.openTxHash) {
      const c = openTxHashCounts.get(l.openTxHash) || [];
      c.push(l.id);
      openTxHashCounts.set(l.openTxHash, c);
    }
  }
  for (const [tx, ids] of openTxHashCounts) {
    if (ids.length > 1) {
      globalFindings.push({ category: 'L-G', severity: 'high', primary: `duplicate openTxHash=${tx} on loan ids ${ids.join(',')}` });
    }
  }

  // X1: verified users never UserRiskSet on-chain
  for (const u of db.users) {
    if (u.score != null && u.walletAddress) {
      const addr = u.walletAddress.toLowerCase();
      const evs = events.get(addr);
      if (!evs || evs.UserRiskSet.length === 0) {
        globalFindings.push({ category: 'U-G', severity: 'high', primary: `userId=${u.id} score=${u.score} has no UserRiskSet event on-chain`, userId: u.id });
      }
    }
  }

  // Schema checks
  const schemaFindings = [];
  const EXPECTED_MIGRATIONS_MIN = 23;
  if (db.migrations.length < EXPECTED_MIGRATIONS_MIN) {
    schemaFindings.push({ category: 'S1', severity: 'high', primary: `migrations count=${db.migrations.length} < expected ${EXPECTED_MIGRATIONS_MIN}` });
  }
  const tip = db.migrations.slice(-1)[0];
  if (!tip || !tip.name?.includes('AddGeoToBorrowAttempts')) {
    schemaFindings.push({ category: 'S1', severity: 'medium', primary: `migrations tip is ${tip?.name} (expected to contain AddGeoToBorrowAttempts)` });
  }
  const hasOpenTxIdx = db.indexes.some((i) => i.indexname === 'idx_loans_open_tx_hash_unique');
  if (!hasOpenTxIdx) {
    schemaFindings.push({ category: 'S2', severity: 'high', primary: `index idx_loans_open_tx_hash_unique is MISSING` });
  }
  const enumLabels = db.enumStatus.map((e) => e.enumlabel).sort();
  const expectedEnum = ['defaulted', 'open', 'repaid_late', 'repaid_on_time'];
  if (JSON.stringify(enumLabels) !== JSON.stringify(expectedEnum)) {
    schemaFindings.push({ category: 'S3', severity: 'medium', primary: `loan status enum labels = ${JSON.stringify(enumLabels)} (expected ${JSON.stringify(expectedEnum)})` });
  }

  for (const f of [...globalFindings, ...schemaFindings]) {
    categoryCounts[f.category] = (categoryCounts[f.category] || 0) + 1;
  }

  // ── emit report.json ──
  const report = {
    meta: {
      runTs: new Date().toISOString(),
      runDir: RUN_DIR,
      dbSnapshot: DB_SNAPSHOT,
      nowSec,
      chainRecords: chain.records.length,
      dbUsers: db.users.length,
      dbLoans: db.loans.length,
      universeSize: universe.length,
    },
    dbMeta: db.meta,
    categoryCounts,
    globalFindings,
    schemaFindings,
    addrReports,
  };
  fs.writeFileSync(path.join(RUN_DIR, 'report.json'), JSON.stringify(report, null, 2));
  log(`Wrote report.json`);

  // ── emit phase1c-summary.txt ──
  const lines = [
    `=== PHASE 1c CLASSIFICATION — ${report.meta.runTs} ===`,
    ``,
    `DB meta:`,
    `  users total:         ${db.meta.usersCount}`,
    `  loans total:         ${db.meta.loansCount}`,
    `  open loans:          ${db.meta.openLoansCount}  (chain says ${chain.summary?.aggregates?.activeLoans ?? 'n/a'})`,
    `  zombie opens:        ${db.meta.zombieOpenLoans}`,
    `  duplicate openTxHash:${db.meta.duplicateOpenTxHash}`,
    ``,
    `Universe size: ${universe.length}`,
    `Addresses with findings: ${addrReports.length}`,
    ``,
    `Category counts:`,
    ...Object.entries(categoryCounts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `  ${k.padEnd(8)} ${v}`),
    ``,
    `Schema checks:`,
    ...(schemaFindings.length === 0
      ? ['  ALL PASS ✅']
      : schemaFindings.map((f) => `  [${f.category}] ${f.primary}`)),
    ``,
    `Global findings (count):  ${globalFindings.length}`,
    ``,
    `Artifacts:`,
    `  ${RUN_DIR}/report.json        — per-address classification`,
    `  ${RUN_DIR}/phase1c-summary.txt — this file`,
    ``,
  ];
  const summary = lines.join('\n');
  fs.writeFileSync(path.join(RUN_DIR, 'phase1c-summary.txt'), summary);
  console.log('\n' + summary);
}

function die(msg) { console.error('FATAL:', msg); process.exit(1); }

main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
