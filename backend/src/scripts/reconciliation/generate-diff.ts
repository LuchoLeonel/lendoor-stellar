/**
 * Phase 0 — Step 3: Generate comprehensive diff between subgraph and DB
 *
 * Prerequisites: run export-subgraph.ts and export-db.ts first
 *
 * Usage: npx ts-node backend/src/scripts/reconciliation/generate-diff.ts
 *
 * Outputs:
 *   - output/diff-missing-wallets.json       (on-chain wallets not in DB)
 *   - output/diff-loan-count-mismatches.json  (wallets with more loans on-chain than DB)
 *   - output/diff-status-mismatches.json      (loans with DB vs on-chain status mismatch)
 *   - output/diff-testing-wallets.json        (classified as testing)
 *   - output/diff-real-missing.json           (real loans missing from DB, ready for backfill)
 *   - output/diff-summary.json                (full reconciliation report)
 */

import * as fs from "fs";
import * as path from "path";

const OUTPUT_DIR = path.join(__dirname, "output");
const LAUNCH_DATE = new Date("2025-12-04T00:00:00Z");
const LAUNCH_TS = Math.floor(LAUNCH_DATE.getTime() / 1000);

// ── Types ────────────────────────────────────────────────────

interface SubgraphLoan {
  id: string;
  borrower: string;
  principal: string;
  amountDue: string;
  due: string;
  gracePeriod: string;
  status: "OPEN" | "CLOSED" | "DEFAULTED";
  tenorDays: number;
  openedAt: string;
  closedAt: string | null;
  daysPastDueAtClose: number | null;
  sequenceNumber: number;
}

interface SubgraphBorrower {
  id: string;
  loansCount: string;
  firstSeen: string;
  lastSeen: string;
  currentLoanId: string | null;
}

interface SubgraphActivity {
  id: string;
  type: "OPEN" | "CLOSE";
  borrower: string;
  principal: string;
  amountDue: string;
  paid: string | null;
  blockTimestamp: string;
  txHash: string;
}

interface DbLoan {
  id: number;
  userId: number;
  borrowerAddress: string;
  principal: number;
  amountDueAtOpen: number;
  amountPaid: number;
  tenorDays: number;
  feeBps: number;
  startAt: string;
  dueAt: string;
  closedAt: string | null;
  status: "open" | "repaid_on_time" | "repaid_late" | "defaulted";
  repaidOnTime: boolean;
  openTxHash: string | null;
  closeTxHash: string | null;
  syncedByChain: boolean;
}

interface DbBorrowerSummary {
  address: string;
  loan_count: number;
  total_principal: number;
  open_count: number;
  on_time_count: number;
  late_count: number;
  default_count: number;
  first_loan: string;
  last_loan: string;
}

interface DbUser {
  id: number;
  walletAddress: string;
  platform: string;
  email: string | null;
  score: number | null;
  riskPDefault: number | null;
  createdAt: string;
}

// ── Load data ────────────────────────────────────────────────

function load<T>(filename: string): T {
  const filePath = path.join(OUTPUT_DIR, filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing file: ${filePath}. Run export scripts first.`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

// ── Analysis functions ───────────────────────────────────────

function classifyTestingWallet(
  borrower: string,
  loans: SubgraphLoan[],
  hasDbUser: boolean,
): { isTest: boolean; reasons: string[] } {
  const reasons: string[] = [];

  // If wallet has a registered user in DB, it's a real user — not testing
  if (hasDbUser) {
    reasons.push("has_db_user");
    return { isTest: false, reasons };
  }

  // All loans before launch date
  const allPreLaunch = loans.every((l) => Number(l.openedAt) < LAUNCH_TS);
  if (allPreLaunch) reasons.push("all_loans_pre_launch");

  // All loans in first week after launch (testing period)
  const firstWeekEnd = LAUNCH_TS + 7 * 86400;
  const allFirstWeek = loans.every((l) => Number(l.openedAt) < firstWeekEnd);
  if (allFirstWeek && !allPreLaunch) reasons.push("all_loans_first_week");

  // All principals $3 or less
  const allSmall = loans.every((l) => Number(l.principal) / 1e6 <= 3);
  if (allSmall) reasons.push("all_principals_lte_3usd");

  // Has OPEN loans older than 90 days (abandoned test loans)
  const now = Math.floor(Date.now() / 1000);
  const oldOpen = loans.filter(
    (l) => l.status === "OPEN" && now - Number(l.openedAt) > 90 * 86400,
  );
  if (oldOpen.length > 0) reasons.push(`${oldOpen.length}_open_loans_gt_90d`);

  // Classification: test only if NO db user AND (pre-launch OR first week small)
  const isTest =
    allPreLaunch ||
    (allFirstWeek && allSmall) ||
    (allSmall && oldOpen.length > 0 && loans.length <= 5);

  return { isTest, reasons };
}

function matchLoansByTxHash(
  subgraphActivities: SubgraphActivity[],
  dbLoans: DbLoan[],
  borrower: string,
): { matched: Map<string, string>; unmatchedSubgraph: SubgraphActivity[] } {
  const matched = new Map<string, string>(); // subgraph activity id → db openTxHash
  const borrowerActivities = subgraphActivities.filter(
    (a) => a.borrower.toLowerCase() === borrower && a.type === "OPEN",
  );
  const borrowerDbLoans = dbLoans.filter((l) => l.borrowerAddress === borrower);

  // Match by txHash
  const dbTxHashes = new Set(borrowerDbLoans.map((l) => l.openTxHash?.toLowerCase()).filter(Boolean));

  const unmatched: SubgraphActivity[] = [];
  for (const activity of borrowerActivities) {
    if (activity.txHash && dbTxHashes.has(activity.txHash.toLowerCase())) {
      matched.set(activity.id, activity.txHash);
    } else {
      unmatched.push(activity);
    }
  }

  return { matched, unmatchedSubgraph: unmatched };
}

function matchLoansByTimestamp(
  unmatchedActivities: SubgraphActivity[],
  dbLoans: DbLoan[],
  borrower: string,
  toleranceSecs = 120,
): { matched: SubgraphActivity[]; stillUnmatched: SubgraphActivity[] } {
  const borrowerDbLoans = dbLoans
    .filter((l) => l.borrowerAddress === borrower)
    .map((l) => ({
      ...l,
      startTs: Math.floor(new Date(l.startAt).getTime() / 1000),
    }));

  const usedDbIds = new Set<number>();
  const matched: SubgraphActivity[] = [];
  const stillUnmatched: SubgraphActivity[] = [];

  for (const activity of unmatchedActivities) {
    const actTs = Number(activity.blockTimestamp);
    const principalOnChain = Number(activity.principal);

    const match = borrowerDbLoans.find(
      (db) =>
        !usedDbIds.has(db.id) &&
        Math.abs(db.startTs - actTs) <= toleranceSecs &&
        Math.abs(db.principal * 1e6 - principalOnChain) < 1000, // within rounding
    );

    if (match) {
      usedDbIds.add(match.id);
      matched.push(activity);
    } else {
      stillUnmatched.push(activity);
    }
  }

  return { matched, stillUnmatched };
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  console.log("🔍 Loading exported data...");

  const subgraphLoans = load<SubgraphLoan[]>("subgraph-loans.json");
  const subgraphBorrowers = load<SubgraphBorrower[]>("subgraph-borrowers.json");
  const subgraphActivities = load<SubgraphActivity[]>("subgraph-loan-activities.json");
  const protocolStats = load<{ loansOriginated: string; uniqueBorrowers: string }>("subgraph-protocol-stats.json");

  const dbLoans = load<DbLoan[]>("db-loans.json");
  const dbBorrowers = load<DbBorrowerSummary[]>("db-borrowers-summary.json");
  const dbUsers = load<DbUser[]>("db-users.json");
  const dbSummary = load<{ loans: { total_loans: number } }>("db-summary.json");

  // Index data
  const dbUsersByWallet = new Map<string, DbUser>();
  for (const u of dbUsers) dbUsersByWallet.set(u.walletAddress.toLowerCase(), u);

  const dbBorrowersByAddr = new Map<string, DbBorrowerSummary>();
  for (const b of dbBorrowers) dbBorrowersByAddr.set(b.address.toLowerCase(), b);

  const subgraphLoansByBorrower = new Map<string, SubgraphLoan[]>();
  for (const l of subgraphLoans) {
    const addr = l.borrower.toLowerCase();
    if (!subgraphLoansByBorrower.has(addr)) subgraphLoansByBorrower.set(addr, []);
    subgraphLoansByBorrower.get(addr)!.push(l);
  }

  console.log("\n═══ TOTALS ═══");
  console.log(`Subgraph: ${subgraphLoans.length} loans (protocolStat says ${protocolStats.loansOriginated})`);
  console.log(`DB: ${dbLoans.length} loans (summary says ${dbSummary.loans.total_loans})`);
  console.log(`Delta: ${Number(protocolStats.loansOriginated) - dbLoans.length} loans missing from DB`);
  console.log(`Subgraph borrowers: ${subgraphBorrowers.length}, DB borrowers: ${dbBorrowers.length}`);

  // ─── 1. Missing wallets (on-chain but not in DB) ──────────
  console.log("\n═══ ANALYSIS 1: Missing Wallets ═══");

  const missingWallets: Array<{
    address: string;
    loansCount: number;
    totalPrincipal: number;
    firstSeen: string;
    loans: SubgraphLoan[];
    classification: { isTest: boolean; reasons: string[] };
    hasDbUser: boolean;
  }> = [];

  for (const [addr, loans] of subgraphLoansByBorrower) {
    if (!dbBorrowersByAddr.has(addr)) {
      const totalPrincipal = loans.reduce((s, l) => s + Number(l.principal) / 1e6, 0);
      const firstSeen = new Date(
        Math.min(...loans.map((l) => Number(l.openedAt))) * 1000,
      ).toISOString();

      missingWallets.push({
        address: addr,
        loansCount: loans.length,
        totalPrincipal: Math.round(totalPrincipal * 100) / 100,
        firstSeen,
        loans,
        hasDbUser: dbUsersByWallet.has(addr),
        classification: classifyTestingWallet(addr, loans, dbUsersByWallet.has(addr)),
      });
    }
  }

  const testWallets = missingWallets.filter((w) => w.classification.isTest);
  const realMissingWallets = missingWallets.filter((w) => !w.classification.isTest);

  console.log(`Total missing wallets: ${missingWallets.length}`);
  console.log(`  Testing: ${testWallets.length} (${testWallets.reduce((s, w) => s + w.loansCount, 0)} loans)`);
  console.log(`  Real/Review: ${realMissingWallets.length} (${realMissingWallets.reduce((s, w) => s + w.loansCount, 0)} loans)`);

  // ─── 2. Loan count mismatches ─────────────────────────────
  console.log("\n═══ ANALYSIS 2: Loan Count Mismatches ═══");

  const loanCountMismatches: Array<{
    address: string;
    onChainCount: number;
    dbCount: number;
    diff: number;
    onChainPrincipal: number;
    dbPrincipal: number;
    missingLoans: SubgraphActivity[];
  }> = [];

  let totalMissingFromMismatches = 0;

  for (const [addr, onChainLoans] of subgraphLoansByBorrower) {
    const dbBorrower = dbBorrowersByAddr.get(addr);
    if (!dbBorrower) continue; // handled in missing wallets

    if (onChainLoans.length > dbBorrower.loan_count) {
      const diff = onChainLoans.length - dbBorrower.loan_count;

      // Try to identify exactly which loans are missing
      const { unmatchedSubgraph } = matchLoansByTxHash(subgraphActivities, dbLoans, addr);
      const { stillUnmatched } = matchLoansByTimestamp(unmatchedSubgraph, dbLoans, addr);

      loanCountMismatches.push({
        address: addr,
        onChainCount: onChainLoans.length,
        dbCount: dbBorrower.loan_count,
        diff,
        onChainPrincipal: Math.round(onChainLoans.reduce((s, l) => s + Number(l.principal) / 1e6, 0) * 100) / 100,
        dbPrincipal: dbBorrower.total_principal,
        missingLoans: stillUnmatched,
      });

      totalMissingFromMismatches += diff;
    }
  }

  loanCountMismatches.sort((a, b) => b.diff - a.diff);

  console.log(`Wallets with more loans on-chain than DB: ${loanCountMismatches.length}`);
  console.log(`Total extra loans on-chain: ${totalMissingFromMismatches}`);

  // By month
  const missingByMonth: Record<string, number> = {};
  for (const m of loanCountMismatches) {
    for (const loan of m.missingLoans) {
      const d = new Date(Number(loan.blockTimestamp) * 1000);
      const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      missingByMonth[month] = (missingByMonth[month] || 0) + 1;
    }
  }
  console.log("Missing loans by month:", missingByMonth);

  // ─── 3. Status mismatches ─────────────────────────────────
  console.log("\n═══ ANALYSIS 3: Status Mismatches ═══");

  const statusMismatches: Array<{
    dbLoanId: number;
    borrowerAddress: string;
    dbStatus: string;
    onChainStatus: string;
    dbStartAt: string;
    principal: number;
    daysSinceStart: number;
  }> = [];

  // Map subgraph loans by borrower+openedAt for matching
  for (const dbLoan of dbLoans) {
    const onChainLoans = subgraphLoansByBorrower.get(dbLoan.borrowerAddress) ?? [];

    // Find best matching on-chain loan by timestamp
    const dbStartTs = Math.floor(new Date(dbLoan.startAt).getTime() / 1000);
    const match = onChainLoans.find(
      (l) =>
        Math.abs(Number(l.openedAt) - dbStartTs) < 120 &&
        Math.abs(Number(l.principal) / 1e6 - dbLoan.principal) < 0.1,
    );

    if (match) {
      const dbStatusNorm = dbLoan.status.toUpperCase().replace("REPAID_ON_TIME", "CLOSED").replace("REPAID_LATE", "CLOSED");
      const onChainStatus = match.status;

      // DB says DEFAULTED but on-chain says OPEN or CLOSED
      if (dbLoan.status === "defaulted" && onChainStatus !== "DEFAULTED") {
        statusMismatches.push({
          dbLoanId: dbLoan.id,
          borrowerAddress: dbLoan.borrowerAddress,
          dbStatus: dbLoan.status,
          onChainStatus: match.status,
          dbStartAt: dbLoan.startAt,
          principal: dbLoan.principal,
          daysSinceStart: Math.floor((Date.now() / 1000 - dbStartTs) / 86400),
        });
      }

      // DB says OPEN but on-chain says CLOSED
      if (dbLoan.status === "open" && onChainStatus === "CLOSED") {
        statusMismatches.push({
          dbLoanId: dbLoan.id,
          borrowerAddress: dbLoan.borrowerAddress,
          dbStatus: dbLoan.status,
          onChainStatus: match.status,
          dbStartAt: dbLoan.startAt,
          principal: dbLoan.principal,
          daysSinceStart: Math.floor((Date.now() / 1000 - dbStartTs) / 86400),
        });
      }
    }
  }

  // Bucket the status mismatches
  const defaultedButOpen = statusMismatches.filter((m) => m.dbStatus === "defaulted" && m.onChainStatus === "OPEN");
  const defaultedButClosed = statusMismatches.filter((m) => m.dbStatus === "defaulted" && m.onChainStatus === "CLOSED");
  const openButClosed = statusMismatches.filter((m) => m.dbStatus === "open" && m.onChainStatus === "CLOSED");

  console.log(`Status mismatches found: ${statusMismatches.length}`);
  console.log(`  DB=defaulted, on-chain=OPEN: ${defaultedButOpen.length} (Bucket A — truly defaulted, need markDefault)`);
  console.log(`  DB=defaulted, on-chain=CLOSED: ${defaultedButClosed.length} (Bucket B — already repaid, DB needs update)`);
  console.log(`  DB=open, on-chain=CLOSED: ${openButClosed.length} (chain-sync missed these)`);

  // ─── 4. Build backfill candidates ─────────────────────────
  console.log("\n═══ ANALYSIS 4: Backfill Candidates ═══");

  const backfillCandidates: Array<{
    borrower: string;
    activity: SubgraphActivity;
    subgraphLoan: SubgraphLoan | undefined;
    hasDbUser: boolean;
    userId: number | null;
    isTest: boolean;
  }> = [];

  // From missing wallets (real only)
  for (const w of realMissingWallets) {
    const activities = subgraphActivities.filter(
      (a) => a.borrower.toLowerCase() === w.address && a.type === "OPEN",
    );
    for (const a of activities) {
      const matchingLoan = subgraphLoans.find(
        (l) =>
          l.borrower.toLowerCase() === w.address &&
          Math.abs(Number(l.openedAt) - Number(a.blockTimestamp)) < 60,
      );
      backfillCandidates.push({
        borrower: w.address,
        activity: a,
        subgraphLoan: matchingLoan,
        hasDbUser: w.hasDbUser,
        userId: dbUsersByWallet.get(w.address)?.id ?? null,
        isTest: false,
      });
    }
  }

  // From count mismatches
  for (const m of loanCountMismatches) {
    for (const a of m.missingLoans) {
      const matchingLoan = subgraphLoans.find(
        (l) =>
          l.borrower.toLowerCase() === m.address &&
          Math.abs(Number(l.openedAt) - Number(a.blockTimestamp)) < 60,
      );
      backfillCandidates.push({
        borrower: m.address,
        activity: a,
        subgraphLoan: matchingLoan,
        hasDbUser: dbUsersByWallet.has(m.address),
        userId: dbUsersByWallet.get(m.address)?.id ?? null,
        isTest: false,
      });
    }
  }

  const backfillable = backfillCandidates.filter((c) => c.hasDbUser && c.userId);
  const noUser = backfillCandidates.filter((c) => !c.hasDbUser);

  console.log(`Total backfill candidates: ${backfillCandidates.length}`);
  console.log(`  With DB user (can backfill): ${backfillable.length}`);
  console.log(`  Without DB user (need review): ${noUser.length}`);

  // ─── Write outputs ─────────────────────────────────────────
  const write = (name: string, data: unknown) => {
    const filePath = path.join(OUTPUT_DIR, `${name}.json`);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    console.log(`  📁 ${name}.json`);
  };

  console.log("\n📝 Writing output files...");
  write("diff-missing-wallets", missingWallets);
  write("diff-testing-wallets", testWallets);
  write("diff-loan-count-mismatches", loanCountMismatches.map(({ missingLoans, ...rest }) => ({
    ...rest,
    missingLoansCount: missingLoans.length,
    missingLoansTxHashes: missingLoans.map((l) => l.txHash),
  })));
  write("diff-status-mismatches", {
    bucketA_defaulted_still_open: defaultedButOpen,
    bucketB_defaulted_but_repaid: defaultedButClosed,
    bucketC_open_but_closed: openButClosed,
  });
  write("diff-real-missing", backfillable.map((c) => ({
    borrower: c.borrower,
    userId: c.userId,
    txHash: c.activity.txHash,
    principal: Number(c.activity.principal) / 1e6,
    amountDue: Number(c.activity.amountDue) / 1e6,
    timestamp: c.activity.blockTimestamp,
    date: new Date(Number(c.activity.blockTimestamp) * 1000).toISOString(),
    onChainStatus: c.subgraphLoan?.status ?? "UNKNOWN",
    tenorDays: c.subgraphLoan?.tenorDays ?? null,
    closedAt: c.subgraphLoan?.closedAt ?? null,
  })));

  // ─── Final summary ────────────────────────────────────────
  const summary = {
    exportedAt: new Date().toISOString(),
    totals: {
      subgraph: {
        loans: subgraphLoans.length,
        loansOriginated: Number(protocolStats.loansOriginated),
        borrowers: subgraphBorrowers.length,
      },
      db: {
        loans: dbLoans.length,
        borrowers: dbBorrowers.length,
        users: dbUsers.length,
      },
      delta: {
        loans: Number(protocolStats.loansOriginated) - dbLoans.length,
        borrowers: subgraphBorrowers.length - dbBorrowers.length,
      },
    },
    missingWallets: {
      total: missingWallets.length,
      testing: testWallets.length,
      testingLoans: testWallets.reduce((s, w) => s + w.loansCount, 0),
      real: realMissingWallets.length,
      realLoans: realMissingWallets.reduce((s, w) => s + w.loansCount, 0),
    },
    loanCountMismatches: {
      walletsAffected: loanCountMismatches.length,
      totalExtraOnChain: totalMissingFromMismatches,
      byMonth: missingByMonth,
    },
    statusMismatches: {
      total: statusMismatches.length,
      bucketA_defaulted_still_open: defaultedButOpen.length,
      bucketB_defaulted_but_repaid: defaultedButClosed.length,
      bucketC_open_but_closed: openButClosed.length,
    },
    backfill: {
      totalCandidates: backfillCandidates.length,
      canBackfill: backfillable.length,
      needReview: noUser.length,
    },
  };

  write("diff-summary", summary);

  console.log("\n═══ RECONCILIATION SUMMARY ═══");
  console.log(JSON.stringify(summary, null, 2));
  console.log("\n✅ Diff generation complete.");
}

main().catch((e) => {
  console.error("❌ Diff generation failed:", e);
  process.exit(1);
});
