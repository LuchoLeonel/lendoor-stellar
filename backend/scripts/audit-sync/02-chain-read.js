#!/usr/bin/env node
/**
 * Phase 1a — Per-address chain state snapshot.
 *
 * For every address in addresses.json, issue 8 RPC reads against LoanManagerV3:
 *   1. users(addr)                → UserRisk { score, kycOk, validUntil, lastUpdate, limit }
 *   2. offers(addr)               → LoanOffer { tenorDays, feeBps, validUntil, maxAmount, exists }
 *   3. loans(addr)                → Loan { principal, amountDue, start, due, feeBps, gracePeriod, active }
 *   4. isDefaulted(addr)          → bool
 *   5. premiums(addr)             → PremiumConfig { premiumRatePerSecWad, lateRatePerSecWad }
 *   6. nextBorrowTime(addr)       → uint64 cooldown
 *   7. creditLimit(addr)          → derived effective limit (0 if !kycOk or validUntil expired)
 *   8. previewLoanWithLate(addr)  → (principal, amountDueWithLate)  — only if loans(addr).active
 *
 * Also reads global config once:
 *   vault(), defaultGracePeriod(), defaultLatePeriod(),
 *   minHoldDaysByTenor(3/7/14/21/30), owner()
 *
 * Cross-checks:
 *   CC-1.1 — derived creditLimit consistency: if !kycOk OR validUntil expired,
 *            creditLimit(addr) must equal 0. Else it must equal users(addr).limit.
 *   CC-1.2 — active-loan consistency: if loans(addr).active == true, then
 *            previewLoanWithLate(addr).principal must equal loans(addr).principal.
 *   CC-1.3 — offers-active mutex: contract deletes offer on openLoan, so
 *            (loans.active == true AND offers.exists == true) is impossible —
 *            flag any such occurrence.
 *   CC-1.4 — two-pass tip consistency: block tip is captured before and after
 *            the scan. If tip diverged by > MAX_TIP_DRIFT blocks, warn.
 *
 * Env vars:
 *   ETH_RPC_URL        — JSON-RPC endpoint (default https://forno.celo.org).
 *   AUDIT_RUN_DIR      — required; the Phase 0 run dir containing addresses.json.
 *   PARALLEL           — concurrent requests in flight (default 15).
 *   INTER_BATCH_MS     — delay between batches (default 50ms).
 */

'use strict';

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const {
  LOAN_MANAGER_READS,
  LOAN_MANAGER_ADDRESS,
  CELO_CHAIN_ID,
} = require('./lib/abi');

const RPC_DEFAULT = 'https://forno.celo.org';
const RPC_FALLBACK = 'https://rpc.ankr.com/celo';

const RUN_DIR = process.env.AUDIT_RUN_DIR;
if (!RUN_DIR) {
  console.error('FATAL: AUDIT_RUN_DIR env var is required');
  process.exit(1);
}
const ADDRESSES_PATH = path.join(RUN_DIR, 'addresses.json');
if (!fs.existsSync(ADDRESSES_PATH)) {
  console.error(`FATAL: ${ADDRESSES_PATH} not found`);
  process.exit(1);
}

const RPC_URL = process.env.ETH_RPC_URL || RPC_DEFAULT;
const PARALLEL = Number(process.env.PARALLEL || '15');
const INTER_BATCH_MS = Number(process.env.INTER_BATCH_MS || '50');
const MAX_TIP_DRIFT = 100; // CC-1.4: warn if block tip drifts by > this

const ts = () => new Date().toISOString();
function log(msg, ...rest) {
  console.log(`[${ts()}] ${msg}`, ...rest);
}
function warn(msg, ...rest) {
  console.warn(`[${ts()}] WARN: ${msg}`, ...rest);
}

async function initProvider() {
  let provider = new ethers.JsonRpcProvider(RPC_URL, {
    chainId: CELO_CHAIN_ID,
    name: 'celo',
  });
  try {
    await provider.getBlockNumber();
    return provider;
  } catch (err) {
    warn(`Primary RPC failed: ${err.message}. Using fallback.`);
    provider = new ethers.JsonRpcProvider(RPC_FALLBACK, {
      chainId: CELO_CHAIN_ID,
      name: 'celo',
    });
    await provider.getBlockNumber();
    return provider;
  }
}

function toSerialisable(v) {
  if (typeof v === 'bigint') return v.toString();
  if (Array.isArray(v)) return v.map(toSerialisable);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, vv] of Object.entries(v)) out[k] = toSerialisable(vv);
    return out;
  }
  return v;
}

// ── per-address read ─────────────────────────────────────
async function readAddress(contract, addr) {
  // Fire 7 guaranteed calls in parallel. previewLoanWithLate is only called
  // if the loan is active (we resolve it after the first batch).
  const [userRisk, offer, loan, isDef, prem, nbt, credLim] = await Promise.all([
    contract.users(addr),
    contract.offers(addr),
    contract.loans(addr),
    contract.isDefaulted(addr),
    contract.premiums(addr),
    contract.nextBorrowTime(addr),
    contract.creditLimit(addr),
  ]);

  let preview = null;
  if (loan[6] /* active */) {
    try {
      preview = await contract.previewLoanWithLate(addr);
    } catch (err) {
      preview = { error: err.message };
    }
  }

  const rec = {
    addr,
    userRisk: {
      score: Number(userRisk[0]),
      kycOk: Boolean(userRisk[1]),
      validUntil: Number(userRisk[2]),
      lastUpdate: Number(userRisk[3]),
      limit: userRisk[4].toString(),
    },
    offer: {
      tenorDays: Number(offer[0]),
      feeBps: Number(offer[1]),
      validUntil: Number(offer[2]),
      maxAmount: offer[3].toString(),
      exists: Boolean(offer[4]),
    },
    loan: {
      principal: loan[0].toString(),
      amountDue: loan[1].toString(),
      start: Number(loan[2]),
      due: Number(loan[3]),
      feeBps: Number(loan[4]),
      gracePeriod: Number(loan[5]),
      active: Boolean(loan[6]),
    },
    isDefaulted: Boolean(isDef),
    premium: {
      premiumRatePerSecWad: prem[0].toString(),
      lateRatePerSecWad: prem[1].toString(),
    },
    nextBorrowTime: Number(nbt),
    creditLimit: credLim.toString(),
    preview: preview
      ? Array.isArray(preview) || preview.length !== undefined
        ? {
            principal: preview[0].toString(),
            amountDueWithLate: preview[1].toString(),
          }
        : preview
      : null,
  };

  return rec;
}

// ── cross-checks on a record ─────────────────────────────
function crossCheckRecord(rec, nowSec) {
  const issues = [];

  // CC-1.1 — derived creditLimit consistency
  const expectZero =
    !rec.userRisk.kycOk ||
    (rec.userRisk.validUntil !== 0 && nowSec > rec.userRisk.validUntil);
  if (expectZero && rec.creditLimit !== '0') {
    issues.push({
      check: 'CC-1.1',
      detail: `creditLimit=${rec.creditLimit} but kycOk=${rec.userRisk.kycOk} validUntil=${rec.userRisk.validUntil} (expected 0)`,
    });
  }
  if (!expectZero && rec.creditLimit !== rec.userRisk.limit) {
    issues.push({
      check: 'CC-1.1',
      detail: `creditLimit=${rec.creditLimit} users.limit=${rec.userRisk.limit} (should match)`,
    });
  }

  // CC-1.2 — active-loan preview consistency
  if (rec.loan.active && rec.preview && !rec.preview.error) {
    if (rec.preview.principal !== rec.loan.principal) {
      issues.push({
        check: 'CC-1.2',
        detail: `preview.principal=${rec.preview.principal} loan.principal=${rec.loan.principal}`,
      });
    }
  }

  // CC-1.3 — offers-active mutex
  if (rec.loan.active && rec.offer.exists) {
    issues.push({
      check: 'CC-1.3',
      detail: `offer.exists=true while loan.active=true (contract should have deleted offer on openLoan)`,
    });
  }

  return issues;
}

// ── main ─────────────────────────────────────────────────
async function main() {
  log(`Run dir: ${RUN_DIR}`);
  log(`RPC: ${RPC_URL}`);

  const data = JSON.parse(fs.readFileSync(ADDRESSES_PATH, 'utf8'));
  const addrs = data.addresses.map((a) => a.addr);
  log(`Addresses to read: ${addrs.length}`);

  const provider = await initProvider();
  const contract = new ethers.Contract(LOAN_MANAGER_ADDRESS, LOAN_MANAGER_READS, provider);

  // Tip before the scan (CC-1.4)
  const tipBefore = await provider.getBlockNumber();
  log(`Block tip before scan: ${tipBefore}`);

  // Global config (read once)
  log('Reading global config...');
  const [vault, dgp, dlp, owner, mh3, mh7, mh14, mh21, mh30] = await Promise.all([
    contract.vault(),
    contract.defaultGracePeriod(),
    contract.defaultLatePeriod(),
    contract.owner(),
    contract.minHoldDaysByTenor(3),
    contract.minHoldDaysByTenor(7),
    contract.minHoldDaysByTenor(14),
    contract.minHoldDaysByTenor(21),
    contract.minHoldDaysByTenor(30),
  ]);
  const globalConfig = {
    vault,
    owner,
    defaultGracePeriod: Number(dgp),
    defaultLatePeriod: Number(dlp),
    minHoldDaysByTenor: {
      3: Number(mh3),
      7: Number(mh7),
      14: Number(mh14),
      21: Number(mh21),
      30: Number(mh30),
    },
  };
  log(`Global config: vault=${vault} owner=${owner} grace=${globalConfig.defaultGracePeriod}s late=${globalConfig.defaultLatePeriod}s`);
  log(`minHoldDaysByTenor: ${JSON.stringify(globalConfig.minHoldDaysByTenor)}`);

  // Per-address reads
  log(`Starting per-address reads (PARALLEL=${PARALLEL}, INTER_BATCH_MS=${INTER_BATCH_MS})`);
  const t0 = Date.now();
  const nowSec = Math.floor(Date.now() / 1000);
  const records = [];
  const issues = [];
  const errors = [];

  for (let i = 0; i < addrs.length; i += PARALLEL) {
    const batch = addrs.slice(i, i + PARALLEL);
    const results = await Promise.allSettled(batch.map((a) => readAddress(contract, a)));
    for (let j = 0; j < batch.length; j++) {
      const r = results[j];
      if (r.status === 'fulfilled') {
        records.push(r.value);
        const recIssues = crossCheckRecord(r.value, nowSec);
        for (const iss of recIssues) issues.push({ addr: batch[j], ...iss });
      } else {
        errors.push({ addr: batch[j], error: String(r.reason).slice(0, 400) });
      }
    }
    if ((i / PARALLEL) % 10 === 0) {
      const elapsed = (Date.now() - t0) / 1000;
      const rate = (i + batch.length) / elapsed;
      const remaining = (addrs.length - i - batch.length) / rate;
      log(
        `  progress: ${i + batch.length}/${addrs.length} (${((i + batch.length) / addrs.length * 100).toFixed(1)}%) ` +
          `elapsed=${elapsed.toFixed(0)}s rate=${rate.toFixed(1)}addr/s eta=${remaining.toFixed(0)}s`,
      );
    }
    if (INTER_BATCH_MS > 0 && i + PARALLEL < addrs.length) {
      await new Promise((r) => setTimeout(r, INTER_BATCH_MS));
    }
  }

  const duration = (Date.now() - t0) / 1000;
  log(`Reads complete. records=${records.length} errors=${errors.length} duration=${duration.toFixed(1)}s`);

  // Tip after the scan (CC-1.4)
  const tipAfter = await provider.getBlockNumber();
  const drift = tipAfter - tipBefore;
  log(`Block tip after scan: ${tipAfter} (drift: ${drift} blocks during scan, ~${drift * 5}s real-time)`);
  if (drift > MAX_TIP_DRIFT) {
    warn(`CC-1.4: tip drifted ${drift} blocks — scan took longer than expected; possible rate limiting`);
  }

  // Summaries for quick signal
  const activeLoans = records.filter((r) => r.loan.active).length;
  const defaulted = records.filter((r) => r.isDefaulted).length;
  const offersExist = records.filter((r) => r.offer.exists).length;
  const creditLimitZero = records.filter((r) => r.creditLimit === '0').length;
  const validUntilExpired = records.filter(
    (r) => r.userRisk.validUntil !== 0 && r.userRisk.validUntil < nowSec,
  ).length;
  const premiumsSet = records.filter(
    (r) => r.premium.premiumRatePerSecWad !== '0' || r.premium.lateRatePerSecWad !== '0',
  ).length;

  const summary = {
    runTs: new Date().toISOString(),
    tipBefore,
    tipAfter,
    drift,
    durationSec: Number(duration.toFixed(1)),
    addrCount: addrs.length,
    recordCount: records.length,
    errorCount: errors.length,
    globalConfig: toSerialisable(globalConfig),
    aggregates: {
      activeLoans,
      defaultedFlagOnChain: defaulted,
      offersExist,
      creditLimitZero,
      validUntilExpired,
      premiumsSet,
    },
    crossChecks: {
      CC_1_1_creditLimit: issues.filter((i) => i.check === 'CC-1.1').length,
      CC_1_2_previewPrincipal: issues.filter((i) => i.check === 'CC-1.2').length,
      CC_1_3_offerActiveMutex: issues.filter((i) => i.check === 'CC-1.3').length,
      CC_1_4_tipDrift: drift,
    },
    issueCount: issues.length,
  };

  fs.writeFileSync(path.join(RUN_DIR, 'chain.json'), JSON.stringify({
    summary,
    records,
    issues,
    errors,
  }, null, 2));
  log(`Wrote chain.json (${(fs.statSync(path.join(RUN_DIR, 'chain.json')).size / 1024 / 1024).toFixed(1)} MB)`);

  const lines = [
    `=== PHASE 1a SUMMARY — ${summary.runTs} ===`,
    ``,
    `Addresses read:     ${records.length} / ${addrs.length}`,
    `Errors:             ${errors.length}`,
    `Duration:           ${duration.toFixed(1)}s`,
    `Block tip drift:    ${drift} blocks (~${drift * 5}s real-time)`,
    ``,
    `=== GLOBAL CONFIG ===`,
    `vault:              ${globalConfig.vault}`,
    `owner:              ${globalConfig.owner}`,
    `defaultGracePeriod: ${globalConfig.defaultGracePeriod}s (${(globalConfig.defaultGracePeriod / 86400).toFixed(1)} days)`,
    `defaultLatePeriod:  ${globalConfig.defaultLatePeriod}s (${(globalConfig.defaultLatePeriod / 86400).toFixed(1)} days)`,
    `minHoldDaysByTenor: ${JSON.stringify(globalConfig.minHoldDaysByTenor)}`,
    ``,
    `=== AGGREGATES ===`,
    `Active loans on-chain:       ${activeLoans}`,
    `Defaulted flag on-chain:     ${defaulted}  (should match LoanDefaulted event count = 0)`,
    `Offers existing:             ${offersExist}`,
    `creditLimit == 0:            ${creditLimitZero}`,
    `validUntil expired:          ${validUntilExpired}`,
    `Premiums set (any non-zero): ${premiumsSet}`,
    ``,
    `=== CROSS-CHECKS ===`,
    `CC-1.1 creditLimit mismatch:    ${summary.crossChecks.CC_1_1_creditLimit}`,
    `CC-1.2 preview.principal drift: ${summary.crossChecks.CC_1_2_previewPrincipal}`,
    `CC-1.3 offer+active mutex viol: ${summary.crossChecks.CC_1_3_offerActiveMutex}   ← must be 0`,
    `CC-1.4 tip drift (blocks):      ${summary.crossChecks.CC_1_4_tipDrift}`,
    ``,
    `Issues total: ${issues.length}`,
    ``,
  ];
  if (issues.length > 0 && issues.length <= 50) {
    lines.push('Issue detail:');
    for (const iss of issues) lines.push(`  ${iss.addr}  [${iss.check}] ${iss.detail}`);
    lines.push('');
  } else if (issues.length > 50) {
    lines.push(`(${issues.length} issues — see chain.json for full list)`);
    lines.push('');
  }
  if (errors.length > 0 && errors.length <= 20) {
    lines.push('Errors:');
    for (const e of errors) lines.push(`  ${e.addr}  ${e.error}`);
  }

  const summaryText = lines.join('\n');
  fs.writeFileSync(path.join(RUN_DIR, 'phase1a-summary.txt'), summaryText);
  console.log('\n' + summaryText);
}

main().catch((e) => {
  console.error('\nFATAL:', e.stack || e.message);
  process.exit(1);
});
