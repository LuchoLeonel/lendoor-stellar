// src/loan/public-stats.controller.ts
//
// Spec 081 — Subgraph fallback endpoint.
//
// Returns loan open/close activities from the `loans` table in the SAME shape
// the TheGraph subgraph returns LoanActivity entities. Used by the frontend
// useLoanActivities hook as a fallback when the subgraph indexer is stuck.
//
// Strategy (see spec 081):
//   1. Frontend queries subgraph first.
//   2. If subgraph._meta.block.timestamp lags > 1h, frontend calls this endpoint
//      with `?after=<subgraph_last_ts>` to fetch ONLY activities after that.
//   3. Frontend merges + dedupes by txHash, sorts DESC.
//   4. When subgraph recovers, it returns everything → this endpoint returns
//      0 new rows → behavior identical to subgraph-only.
//
// Source of truth: chain-sync.service runs every 10 min and writes to `loans`,
// validated against chain by /health/db-chain-parity (drift threshold 40).
import { Controller, Get, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { Loan } from 'src/domain/entities/loan.entity';

type LoanActivityDto = {
  id: string;
  type: 'OPEN' | 'CLOSE';
  borrower: string;
  principal: string | null;
  amountDue: string | null;
  paid: string | null;
  blockTimestamp: string;
  txHash: string;
};

// Subgraph-compatible protocolStat. All money fields are RAW 6-decimal USDC
// (×1e6), counts are integer strings — identical shape/units to the subgraph so
// the frontend can swap sources transparently. Definitions validated against the
// live subgraph (2026-06-10) to ~0.1% on money, ~0.7% on counts (timing/boundary).
type ProtocolStatDto = {
  loansOriginated: string;
  uniqueBorrowers: string;
  principalOriginated: string;
  principalRepaid: string;
  interestRepaid: string;
  lastUpdated: string;
};

type DailyProtocolStatDto = {
  id: string;
  dayStart: string;
  loansOriginated: string;
  uniqueBorrowers: string;
  principalOriginated: string;
  principalRepaid: string;
  interestRepaid: string;
  lastUpdated: string;
};

@ApiTags('public-stats')
@Controller('public-stats')
export class PublicStatsController {
  constructor(
    @InjectRepository(Loan)
    private readonly loanRepo: Repository<Loan>,
  ) {}

  @Get('recent-loan-activities')
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @ApiOperation({
    summary:
      'Fallback for TheGraph LoanActivities. Returns OPEN/CLOSE events from DB in subgraph-compatible shape.',
  })
  async getRecentLoanActivities(
    @Query('after') after?: string,
    @Query('first') first?: string,
    @Query('skip') skip?: string,
  ): Promise<{ loanActivities: LoanActivityDto[] }> {
    const afterTs = after ? Number(after) : 0;
    const limit = Math.min(Math.max(Number(first ?? 10), 1), 100);
    const offset = Math.max(Number(skip ?? 0), 0);

    // Build a UNION of OPEN and CLOSE events as separate rows so each
    // physical loan can produce up to 2 activities, matching the subgraph.
    //
    // Filters:
    //   - exclude SYNTHETIC closeTxHash (test loans, Type C ghost guard)
    //   - exclude rows with NULL tx hashes (incomplete state)
    //   - only include events whose blockTimestamp > $afterTs (sec, unix)
    //
    // amountDue uses amountDueAtOpen (principal + base fee, no mora);
    // paid uses amountPaid; both match how the subgraph populates them.
    const rows: Array<{
      type: 'OPEN' | 'CLOSE';
      tx: string;
      ts: string; // unix seconds, as text
      borrower: string;
      principal: string;
      amount_due: string;
      paid: string | null;
      idx: string; // loan.id for stable dedup key
    }> = await this.loanRepo.query(
      `
      SELECT * FROM (
        SELECT
          'OPEN'::text AS type,
          l."openTxHash" AS tx,
          EXTRACT(EPOCH FROM l."startAt")::bigint::text AS ts,
          l."borrowerAddress" AS borrower,
          -- USDC has 6 decimals. DB stores human dollars (numeric(18,2)); the
          -- subgraph (and the frontend's formatUsdcFromBigIntString = value/1e6)
          -- expect RAW 6-decimal integer units. Scale ×1e6 to match, else the UI
          -- divides "25.00" by 1e6 and shows $0.00.
          (l.principal * 1000000)::bigint::text AS principal,
          (l."amountDueAtOpen" * 1000000)::bigint::text AS amount_due,
          NULL::text AS paid,
          l.id::text AS idx
        FROM loans l
        WHERE l."openTxHash" IS NOT NULL
          AND l."openTxHash" NOT LIKE 'SYNTHETIC_%'
          AND EXTRACT(EPOCH FROM l."startAt") > $1

        UNION ALL

        SELECT
          'CLOSE'::text AS type,
          l."closeTxHash" AS tx,
          EXTRACT(EPOCH FROM l."closedAt")::bigint::text AS ts,
          l."borrowerAddress" AS borrower,
          (l.principal * 1000000)::bigint::text AS principal,
          (l."amountDueAtOpen" * 1000000)::bigint::text AS amount_due,
          (l."amountPaid" * 1000000)::bigint::text AS paid,
          l.id::text AS idx
        FROM loans l
        WHERE l."closeTxHash" IS NOT NULL
          AND l."closeTxHash" NOT LIKE 'SYNTHETIC_%'
          AND l."closedAt" IS NOT NULL
          AND EXTRACT(EPOCH FROM l."closedAt") > $1
      ) events
      ORDER BY ts::bigint DESC
      OFFSET $2
      LIMIT $3
      `,
      [afterTs, offset, limit],
    );

    // Shape rows to match subgraph LoanActivity entity.
    // id format mirrors subgraph: "lm-open-<txHash>-<loanIdInBlock>" or
    // "lm-close-<txHash>-<loanIdInBlock>". We use loan.id as the suffix.
    const loanActivities: LoanActivityDto[] = rows.map((r) => ({
      id: `lm-${r.type.toLowerCase()}-${r.tx}-${r.idx}`,
      type: r.type,
      borrower: r.borrower,
      principal: r.principal,
      amountDue: r.amount_due,
      paid: r.paid,
      blockTimestamp: r.ts,
      txHash: r.tx,
    }));

    return { loanActivities };
  }

  // ── Global protocolStat fallback (COMPOSABLE) ───────────────────────────
  // Mirrors the subgraph's protocolStat(id:"global"). loansOriginated counts
  // non-synthetic opened loans; principalOriginated = SUM(principal) opened;
  // principalRepaid / interestRepaid = SUM over repaid loans (status repaid_*),
  // interest = amountPaid − principal. Money ×1e6 (raw USDC).
  //
  // ?after=<unixSec>: DELTA mode. Returns only events AFTER that timestamp
  // (opened by startAt, repaid by closedAt), so the frontend can COMPOSE
  // subgraph_total + this_delta when the subgraph is stale — instead of
  // REPLACING the subgraph value (which flip-flopped the number because the DB
  // and the subgraph disagree by the known DB↔chain drift). after=0 (default) =
  // full cumulative, for when the subgraph is completely down (no base to add to).
  @Get('protocol-stat')
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @ApiOperation({
    summary:
      'Fallback for TheGraph protocolStat(global). DB-computed, subgraph-compatible (raw USDC). ?after=ts for delta mode.',
  })
  async getProtocolStat(
    @Query('after') after?: string,
  ): Promise<{ protocolStat: ProtocolStatDto }> {
    const afterTs = Math.max(Number(after ?? 0) || 0, 0);
    const rows: Array<Record<string, string>> = await this.loanRepo.query(
      `
      SELECT
        COUNT(*) FILTER (WHERE "openTxHash" IS NOT NULL AND "openTxHash" NOT LIKE 'SYNTHETIC_%' AND EXTRACT(EPOCH FROM "startAt") > $1)::text AS loans_originated,
        -- NEW borrowers only (first loan after $1) so it composes additively with the subgraph's count.
        (SELECT COUNT(*)::text FROM (
           SELECT "borrowerAddress" FROM loans
           WHERE "openTxHash" IS NOT NULL AND "openTxHash" NOT LIKE 'SYNTHETIC_%'
           GROUP BY "borrowerAddress"
           HAVING MIN(EXTRACT(EPOCH FROM "startAt")) > $1
         ) nb) AS unique_borrowers,
        COALESCE(ROUND(SUM(principal) FILTER (WHERE "openTxHash" IS NOT NULL AND "openTxHash" NOT LIKE 'SYNTHETIC_%' AND EXTRACT(EPOCH FROM "startAt") > $1) * 1000000), 0)::bigint::text AS principal_originated,
        COALESCE(ROUND(SUM(principal) FILTER (WHERE status IN ('repaid_on_time','repaid_late') AND "closedAt" IS NOT NULL AND EXTRACT(EPOCH FROM "closedAt") > $1) * 1000000), 0)::bigint::text AS principal_repaid,
        COALESCE(ROUND(SUM("amountPaid" - principal) FILTER (WHERE status IN ('repaid_on_time','repaid_late') AND "amountPaid" >= principal AND "closedAt" IS NOT NULL AND EXTRACT(EPOCH FROM "closedAt") > $1) * 1000000), 0)::bigint::text AS interest_repaid,
        EXTRACT(EPOCH FROM NOW())::bigint::text AS last_updated
      FROM loans
      `,
      [afterTs],
    );
    const r = rows[0] ?? {};
    return {
      protocolStat: {
        loansOriginated: r.loans_originated ?? '0',
        uniqueBorrowers: r.unique_borrowers ?? '0',
        principalOriginated: r.principal_originated ?? '0',
        principalRepaid: r.principal_repaid ?? '0',
        interestRepaid: r.interest_repaid ?? '0',
        lastUpdated: r.last_updated ?? '0',
      },
    };
  }

  // ── Daily protocolStat series fallback ──────────────────────────────────
  // One row per UTC day (matches the subgraph, which buckets in UTC). Per day:
  // loansOriginated + principalOriginated keyed by OPEN day; principalRepaid +
  // interestRepaid keyed by CLOSE day; uniqueBorrowers = NEW borrowers whose
  // FIRST loan landed that day (so the frontend's running SUM yields the total).
  @Get('daily-protocol-stats')
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @ApiOperation({
    summary:
      'Fallback for TheGraph dailyProtocolStats. DB-computed per UTC day, subgraph-compatible (raw USDC).',
  })
  async getDailyProtocolStats(
    @Query('after') after?: string,
  ): Promise<{ dailyProtocolStats: DailyProtocolStatDto[] }> {
    // ?after=<unixSec>: return only day buckets at/after that day, so the
    // frontend composes subgraph days + these recent DB days (instead of
    // replacing the whole series). after=0 (default) = full history.
    const afterTs = Math.max(Number(after ?? 0) || 0, 0);
    const rows: Array<Record<string, string>> = await this.loanRepo.query(
      `
      WITH opens AS (
        SELECT EXTRACT(EPOCH FROM date_trunc('day', "startAt" AT TIME ZONE 'UTC'))::bigint AS day_start,
               COUNT(*) AS loans_orig,
               SUM(principal) AS principal_orig
        FROM loans
        WHERE "openTxHash" IS NOT NULL AND "openTxHash" NOT LIKE 'SYNTHETIC_%'
        GROUP BY 1
      ),
      new_borrowers AS (
        SELECT day_start, COUNT(*) AS uniq FROM (
          SELECT "borrowerAddress",
                 EXTRACT(EPOCH FROM date_trunc('day', MIN("startAt") AT TIME ZONE 'UTC'))::bigint AS day_start
          FROM loans
          WHERE "openTxHash" IS NOT NULL AND "openTxHash" NOT LIKE 'SYNTHETIC_%'
          GROUP BY "borrowerAddress"
        ) fb GROUP BY day_start
      ),
      closes AS (
        SELECT EXTRACT(EPOCH FROM date_trunc('day', "closedAt" AT TIME ZONE 'UTC'))::bigint AS day_start,
               SUM(principal) AS principal_repaid,
               SUM("amountPaid" - principal) FILTER (WHERE "amountPaid" >= principal) AS interest_repaid
        FROM loans
        WHERE status IN ('repaid_on_time','repaid_late') AND "closedAt" IS NOT NULL
        GROUP BY 1
      ),
      days AS (
        SELECT day_start FROM opens
        UNION SELECT day_start FROM closes
        UNION SELECT day_start FROM new_borrowers
      )
      SELECT
        d.day_start::text AS day_start,
        COALESCE(o.loans_orig, 0)::text AS loans_originated,
        COALESCE(nb.uniq, 0)::text AS unique_borrowers,
        COALESCE(ROUND(o.principal_orig * 1000000), 0)::bigint::text AS principal_originated,
        COALESCE(ROUND(c.principal_repaid * 1000000), 0)::bigint::text AS principal_repaid,
        COALESCE(ROUND(c.interest_repaid * 1000000), 0)::bigint::text AS interest_repaid
      FROM days d
      LEFT JOIN opens o ON o.day_start = d.day_start
      LEFT JOIN new_borrowers nb ON nb.day_start = d.day_start
      LEFT JOIN closes c ON c.day_start = d.day_start
      WHERE d.day_start >= $1
      ORDER BY d.day_start ASC
      `,
      [afterTs],
    );
    const now = String(Math.floor(Date.now() / 1000));
    const dailyProtocolStats: DailyProtocolStatDto[] = rows.map((r) => ({
      id: `day-${r.day_start}`,
      dayStart: r.day_start,
      loansOriginated: r.loans_originated,
      uniqueBorrowers: r.unique_borrowers,
      principalOriginated: r.principal_originated,
      principalRepaid: r.principal_repaid,
      interestRepaid: r.interest_repaid,
      lastUpdated: now,
    }));
    return { dailyProtocolStats };
  }
}
