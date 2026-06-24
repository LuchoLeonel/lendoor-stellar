/**
 * Phase 0 — Step 1: Export ALL data from the subgraph
 *
 * Usage: npx ts-node backend/src/scripts/reconciliation/export-subgraph.ts
 *
 * Outputs:
 *   - backend/src/scripts/reconciliation/output/subgraph-loans.json
 *   - backend/src/scripts/reconciliation/output/subgraph-borrowers.json
 *   - backend/src/scripts/reconciliation/output/subgraph-protocol-stats.json
 *   - backend/src/scripts/reconciliation/output/subgraph-daily-stats.json
 *   - backend/src/scripts/reconciliation/output/subgraph-loan-activities.json
 */

import * as fs from "fs";
import * as path from "path";

// Spec 065 — read from env. NO hardcoded API keys in source.
// In prod the value comes from /opt/docker/lendoor/.env.
// For local CLI runs: set SUBGRAPH_URL before invoking, e.g.
//   SUBGRAPH_URL='https://gateway.thegraph.com/api/<KEY>/subgraphs/id/<ID>' \
//     npx ts-node export-subgraph.ts
if (!process.env.SUBGRAPH_URL) {
  console.error(
    "SUBGRAPH_URL env var not set. Required — no default fallback to avoid leaking keys.",
  );
  process.exit(1);
}
const SUBGRAPH_URL: string = process.env.SUBGRAPH_URL;

const OUTPUT_DIR = path.join(__dirname, "output");

// ── helpers ──────────────────────────────────────────────────────

async function query<T>(q: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(SUBGRAPH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: q, variables }),
  });

  if (!res.ok) throw new Error(`Subgraph HTTP ${res.status}: ${await res.text()}`);

  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(json.errors.map((e: { message: string }) => e.message).join("\n"));
  }
  return json.data as T;
}

/** Paginate using id_gt cursor (avoids The Graph's 5000 skip limit) */
async function paginateAll<T extends { id: string }>(
  entityName: string,
  fields: string,
  orderBy = "id",
  extraWhere = "",
): Promise<T[]> {
  const all: T[] = [];
  let lastId = "";

  while (true) {
    const whereClause = lastId
      ? `where: { id_gt: "${lastId}" ${extraWhere ? ", " + extraWhere : ""} }`
      : extraWhere
        ? `where: { ${extraWhere} }`
        : "";

    const q = `{
      ${entityName}(
        first: 1000
        orderBy: ${orderBy}
        orderDirection: asc
        ${whereClause}
      ) { ${fields} }
    }`;

    const data = await query<Record<string, T[]>>(q);
    const batch = data[entityName];
    if (!batch || batch.length === 0) break;

    all.push(...batch);
    lastId = batch[batch.length - 1].id;

    console.log(`  ${entityName}: fetched ${all.length} total (last id: ${lastId.slice(0, 20)}...)`);

    if (batch.length < 1000) break;
  }

  return all;
}

// ── exporters ────────────────────────────────────────────────────

async function exportProtocolStats() {
  console.log("\n📊 Exporting protocol stats...");
  const data = await query<{
    protocolStats: Array<{
      id: string;
      loansOriginated: string;
      uniqueBorrowers: string;
      principalOriginated: string;
      principalRepaid: string;
      interestRepaid: string;
      lastUpdated: string;
    }>;
  }>(`{
    protocolStats(first: 1) {
      id loansOriginated uniqueBorrowers principalOriginated
      principalRepaid interestRepaid lastUpdated
    }
  }`);

  return data.protocolStats[0] ?? null;
}

async function exportLoans() {
  console.log("\n📦 Exporting all loans...");
  return paginateAll(
    "loans",
    "id borrower principal amountDue openedAt due gracePeriod graceEndsAt eligibleForDefaultAt status closedAt defaultedAt paid interest tenorDays tenorBucket daysToClose daysPastDueAtClose daysPastDueAtDefault sequenceNumber",
  );
}

async function exportBorrowerProfiles() {
  console.log("\n👥 Exporting borrower profiles...");
  return paginateAll(
    "borrowerProfiles",
    "id loansCount firstSeen lastSeen currentLoanId",
  );
}

async function exportLoanActivities() {
  console.log("\n🔄 Exporting loan activities...");
  return paginateAll(
    "loanActivities",
    "id type borrower principal amountDue paid interest txHash blockNumber blockTimestamp",
    "id",
  );
}

async function exportDailyStats() {
  console.log("\n📅 Exporting daily protocol stats...");
  return paginateAll(
    "dailyProtocolStats",
    "id dayStart loansOriginated uniqueBorrowers principalOriginated principalRepaid interestRepaid",
    "dayStart",
  );
}

// ── main ─────────────────────────────────────────────────────────

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  console.log(`🚀 Subgraph export started at ${timestamp}`);

  const [protocolStats, loans, borrowers, activities, dailyStats] = await Promise.all([
    exportProtocolStats(),
    exportLoans(),
    exportBorrowerProfiles(),
    exportLoanActivities(),
    exportDailyStats(),
  ]);

  // Write outputs
  const write = (name: string, data: unknown) => {
    const filePath = path.join(OUTPUT_DIR, `${name}.json`);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    console.log(`  ✅ ${filePath}`);
  };

  write("subgraph-protocol-stats", protocolStats);
  write("subgraph-loans", loans);
  write("subgraph-borrowers", borrowers);
  write("subgraph-loan-activities", activities);
  write("subgraph-daily-stats", dailyStats);

  // Summary
  console.log("\n═══ SUBGRAPH EXPORT SUMMARY ═══");
  console.log(`Protocol stats: loansOriginated=${protocolStats?.loansOriginated}, uniqueBorrowers=${protocolStats?.uniqueBorrowers}`);
  console.log(`Loans exported: ${loans.length}`);
  console.log(`Borrower profiles: ${borrowers.length}`);
  console.log(`Loan activities: ${activities.length}`);
  console.log(`Daily stats: ${dailyStats.length}`);

  // Quick status breakdown
  const statusCounts: Record<string, number> = {};
  for (const l of loans) {
    const s = (l as unknown as { status: string }).status;
    statusCounts[s] = (statusCounts[s] || 0) + 1;
  }
  console.log("Loan status breakdown:", statusCounts);

  console.log(`\n✅ Export complete. Files in ${OUTPUT_DIR}/`);
}

main().catch((e) => {
  console.error("❌ Export failed:", e);
  process.exit(1);
});
