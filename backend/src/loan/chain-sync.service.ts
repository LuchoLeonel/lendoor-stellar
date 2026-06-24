// src/loan/chain-sync.service.ts
import { Injectable, Logger, Inject, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, IsNull, Not, Between } from 'typeorm';
import { Contract, EventLog, Interface } from 'ethers';

import { Loan, LoanStatus } from 'src/domain/entities/loan.entity';
import { User } from 'src/domain/entities/user.entity';
import { ChainScanCursor } from 'src/domain/entities/chain-scan-cursor.entity';
import { Metric } from 'src/domain/entities/metric.entity';
import { provider, CLM_ADDRESS, toUnits } from 'src/config/contractConfig';
import { env } from 'src/config/env';
import {
  BLOCKCHAIN_GATEWAY,
  BlockchainGatewayPort,
} from 'src/domain/ports/outbound/blockchain-gateway.port';
import { CreditPolicyService } from 'src/domain/services/credit-policy.service';
import { LoanCalculationsService } from './loan-calculations.service';
import { KNOWN_TESTING_LOANS_COUNT } from './known-testing-loans';
// Spec 070 — ABI imported from the compiled contract artifact (see
// src/abi/README.md). Eliminates the entire class of "hand-written event
// signature drifts from bytecode" bugs (incident 2026-05-20).
import LoanManagerAbi from '../abi/LoanManagerV3.abi.json';

const SYNC_ABI = LoanManagerAbi;

// Spec 070 — known-good topic-0 of `LoanOpened`, computed once from the
// 2026-05-20 audited artifact. The bootstrap assertion below refuses to
// start the service if the locally-imported ABI hashes to a different
// topic, so we catch drift before any RPC call returns silently-empty.
const EXPECTED_LOAN_OPENED_TOPIC =
  '0x3f2f4670ea97f3de37dec9dad38327fae4c9bd7b03be9237b8d8c3783cc3009c';

// Spec 065 Layer 2 — cursor key shared across runs.
const LOAN_OPENED_CURSOR_ID = 'loan_opened';

const USDC_DECIMALS = 6;
const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 200;
const MAX_BLOCK_RANGE = 10_000;
// Celo L2 runs at ~1 s/block since the 2025 migration. Empirically verified
// 1.000 s/block across 12.6M blocks (audit 2026-04-18, spec 009 §9.1).
const CELO_BLOCK_TIME_SEC = 1;
// Tolerance (seconds) when matching a DB loan's startAt to the on-chain
// loans(addr).start timestamp. The backend writes startAt = Date.now() in
// inform-open, which is typically within a few seconds of the chain block ts.
const LOAN_START_MATCH_TOLERANCE_SEC = 60;
const DEFAULT_CREDIT_LIMIT_USDC = toUnits(1, 6);
// Grace period: align with LoanManagerV3.defaultGracePeriod (= 1 days).
// A repayment is "on-time" if it lands within 24h of the due date.
// Outside this window → repaid_late. Beyond gracePeriod + defaultLatePeriod
// (15d) the contract allows markDefault. See spec 018.
const REPAID_ON_TIME_GRACE_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class ChainSyncService implements OnModuleInit {
  private readonly logger = new Logger(ChainSyncService.name);
  private readonly contract: Contract;

  /**
   * Spec 070 — fail-fast ABI drift assertion.
   *
   * Computes topic-0 of `LoanOpened` from the locally-imported ABI and
   * compares against the known-good constant. If the artifact ever
   * regenerates with a different signature (contract change without
   * coordinated deploy), this throws and Nest refuses to bootstrap —
   * which is much better than the 19h silent data-loss the previous
   * bug caused.
   *
   * Recovery: if the contract genuinely changed, regenerate the
   * artifact (`yarn sync-abi`), update EXPECTED_LOAN_OPENED_TOPIC at
   * the top of this file with the new topic-0 (visible in the error
   * message), and ship the bump together with the contract migration.
   */
  onModuleInit(): void {
    const iface = new Interface(SYNC_ABI);
    const actualTopic = iface.getEvent('LoanOpened')?.topicHash;
    if (actualTopic !== EXPECTED_LOAN_OPENED_TOPIC) {
      throw new Error(
        `[ABI DRIFT] LoanOpened topic-0 mismatch.\n` +
          `  expected: ${EXPECTED_LOAN_OPENED_TOPIC}\n` +
          `  actual:   ${actualTopic}\n` +
          `Refusing to start. If the contract genuinely changed, run ` +
          `\`yarn sync-abi\` and update EXPECTED_LOAN_OPENED_TOPIC in ` +
          `chain-sync.service.ts.`,
      );
    }
    this.logger.log(
      `[ABI guard] LoanOpened topic-0 verified: ${EXPECTED_LOAN_OPENED_TOPIC}`,
    );
  }

  constructor(
    @InjectRepository(Loan)
    private readonly loanRepo: Repository<Loan>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(ChainScanCursor)
    private readonly cursorRepo: Repository<ChainScanCursor>,
    @InjectRepository(Metric)
    private readonly metricRepo: Repository<Metric>,
    private readonly creditPolicy: CreditPolicyService,
    @Inject(BLOCKCHAIN_GATEWAY)
    private readonly blockchain: BlockchainGatewayPort,
    private readonly loanCalc: LoanCalculationsService,
  ) {
    this.contract = new Contract(CLM_ADDRESS, SYNC_ABI, provider);
  }

  async syncLoansWithChain(): Promise<void> {
    const startTime = Date.now();

    try {
      // 1. Find all unsettled loans plus any repaid rows missing their
      //    on-chain receipt. The second clause (spec 019 §4.1) catches
      //    the class of row produced by `inform-repayment` when the
      //    frontend POSTs without a txHash: the backend persists
      //    status=repaid_* + closedAt=server-time but closeTxHash=NULL.
      //    Without this, those rows never get reconciled and pile up
      //    (~1.5/day as observed in 2026-04-21→23). Chain is source of
      //    truth, so chain-sync should overwrite them with event data.
      //
      // Spec 030 fix (2026-04-28): DROP `closedAt: IsNull()` from the
      // OPEN/DEFAULTED branch. Spec 013's "defaulted backfill" cron
      // sets `closedAt = dueAt` when it flips a loan to defaulted at
      // 24h post-grace. Those loans are still on-chain unresolved
      // (closeTxHash IS NULL) and need chain-sync to reconcile them.
      // Without this fix, ~53 in-grace defaulted loans are never picked
      // up — they get stuck in DB even after the user pays on-chain.
      const unsettledLoans = await this.loanRepo.find({
        where: [
          {
            // Spec 036: include DEFAULTED_IN_GRACE (24h–16d) so chain-sync
            // can reconcile loans paid during the grace window.
            status: In([
              LoanStatus.OPEN,
              LoanStatus.DEFAULTED,
              LoanStatus.DEFAULTED_IN_GRACE,
            ]),
            closeTxHash: IsNull(),
          },
          {
            status: In([LoanStatus.REPAID_ON_TIME, LoanStatus.REPAID_LATE]),
            closeTxHash: IsNull(),
          },
        ],
        relations: ['user'],
        order: { startAt: 'DESC' },
      });

      if (!unsettledLoans.length) {
        this.logger.log('[ChainSync] No open/defaulted loans to sync.');
        return;
      }

      // 2. Group all unsettled loans by address (most recent first, preserved by
      //    the ORDER BY startAt DESC above). One RPC call per address; all loans
      //    for that address are reconciled when the on-chain slot is inactive.
      const loansByAddress = new Map<string, Loan[]>();
      for (const loan of unsettledLoans) {
        const addr = loan.borrowerAddress.toLowerCase();
        const bucket = loansByAddress.get(addr);
        if (bucket) {
          bucket.push(loan);
        } else {
          loansByAddress.set(addr, [loan]);
        }
      }

      // One representative entry per address for batching the RPC call.
      // We keep the full per-address list separately for reconciliation.
      const uniqueAddresses = Array.from(loansByAddress.keys());

      this.logger.log(
        `[ChainSync] Starting sync. Unsettled: ${unsettledLoans.length}, unique addresses: ${uniqueAddresses.length}`,
      );

      // 3. Cache current block
      const currentBlock = await provider.getBlockNumber();

      let checked = 0;
      let reconciled = 0;
      let errors = 0;

      // 4. Process in batches (one batch entry = one address = one RPC call)
      for (let i = 0; i < uniqueAddresses.length; i += BATCH_SIZE) {
        const batch = uniqueAddresses.slice(i, i + BATCH_SIZE);
        const results = await Promise.allSettled(
          batch.map(async (addr) => {
            const loansForAddr = loansByAddress.get(addr)!;
            // All loans share the same borrowerAddress; use the first for the RPC call.
            const representative = loansForAddr[0];
            checked++;

            if (!representative.user) {
              this.logger.warn(
                `[ChainSync] loanId=${representative.id} has no user relation, skipping address=${addr}.`,
              );
              return false;
            }

            const onChain = await this.getOnChainLoan(
              representative.borrowerAddress,
            );

            if (onChain.active) {
              // On-chain slot is active. We need to verify that the DB's most
              // recent unsettled loan is THE SAME loan as what's currently
              // active on-chain. Compare loans(addr).start (block.timestamp at
              // openLoan) against the DB row's startAt.
              //
              // loansForAddr is sorted by startAt DESC, so [0] = most recent.
              const latestDb = loansForAddr[0];
              const latestDbStartUnix = Math.floor(
                latestDb.startAt.getTime() / 1000,
              );
              const latestDbIsChainCurrent =
                Math.abs(onChain.start - latestDbStartUnix) <=
                LOAN_START_MATCH_TOLERANCE_SEC;

              // Case A: chain's active loan IS the DB's most recent row.
              // Older rows (if any) are ghosts — close them. Newest row stays.
              // Case B: chain's active loan is NEWER than any DB row (e.g. user
              // paid a defaulted loan off-chain and re-borrowed, but inform-open
              // never fired for the new loan). Every DB row here is a ghost.
              //
              // Audit 2026-04-18 (spec 009 §9.3) found this at scale for
              // defaulted DB rows: cron used to no-op because loansForAddr.length
              // was 1 AND chain.active was true — assumed "all good" without
              // verifying it was the SAME loan. Fixed below.
              const ghosts = latestDbIsChainCurrent
                ? loansForAddr.slice(1) // Case A: skip the real active row
                : loansForAddr; // Case B: every DB row is stale

              if (ghosts.length === 0) return false;

              if (!latestDbIsChainCurrent) {
                this.logger.warn(
                  `[ChainSync] MISMATCH: chain.active=true start=${onChain.start} ` +
                    `(${new Date(onChain.start * 1000).toISOString()}) does NOT match ` +
                    `latest DB loanId=${latestDb.id} startAt=${latestDb.startAt.toISOString()}. ` +
                    `Treating all ${loansForAddr.length} DB rows as ghosts. ` +
                    `Note: the NEW chain loan is not yet mirrored in DB — inform-open needs to fire, ` +
                    `or run the sync audit (specs/009-100-sync-audit) to backfill.`,
                );
              }

              let anyReconciled = false;
              for (const ghost of ghosts) {
                if (!ghost.user) continue;
                this.logger.log(
                  `[ChainSync] Ghost loan detected: loanId=${ghost.id} wallet=${ghost.borrowerAddress} ` +
                    `dbStatus=${ghost.status} — on-chain has a newer active loan. Reconciling.`,
                );
                try {
                  const didReconcile = await this.reconcileLoan(
                    ghost,
                    ghost.user,
                    currentBlock,
                  );
                  if (didReconcile) anyReconciled = true;
                } catch (err) {
                  this.logger.error(
                    `[ChainSync] Failed to reconcile ghost loanId=${ghost.id}: ${err}`,
                  );
                }
              }
              return anyReconciled;
            }

            // On-chain slot is NOT active: every unsettled DB loan for this
            // address is stale and must be reconciled.
            let anyReconciled = false;
            for (const loan of loansForAddr) {
              if (!loan.user) continue;

              this.logger.log(
                `[ChainSync] Mismatch: loanId=${loan.id} wallet=${loan.borrowerAddress} dbStatus=${loan.status} onChainActive=false`,
              );

              const didReconcile = await this.reconcileLoan(
                loan,
                loan.user,
                currentBlock,
              );
              if (didReconcile) anyReconciled = true;
            }
            return anyReconciled;
          }),
        );

        for (const r of results) {
          if (r.status === 'rejected') {
            errors++;
            this.logger.error(`[ChainSync] Batch error: ${r.reason}`);
          } else if (r.value === true) {
            reconciled++;
          }
        }

        // Inter-batch delay for RPC rate limiting
        if (i + BATCH_SIZE < uniqueAddresses.length) {
          await this.sleep(BATCH_DELAY_MS);
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      this.logger.log(
        `[ChainSync] Sync complete. Checked: ${checked}, reconciled: ${reconciled}, errors: ${errors}. Duration: ${duration}s`,
      );
    } catch (err) {
      this.logger.error(`[ChainSync] Fatal error in sync cycle: ${err}`);
    }
  }

  // ── Spec 065 Layer 2 — LoanOpened scanner ──────────────────────
  //
  // Reads `LoanOpened` events on the LoanManager since the persistent
  // cursor and INSERTs any loans missing from DB. This is the
  // server-side counterpart to the frontend's `/loan/inform-open` POST:
  // when the POST fails (frontend tab closed, retry queue exhausted,
  // backend 5xx, Lemon webview localStorage reset), this scanner picks
  // up the slack on the next cron cycle (≤10 min).
  //
  // Caps each run at `MAX_BLOCK_RANGE` blocks for predictable RPC load.
  // The cursor advances only after a successful walk; failures mid-range
  // are tolerated because INSERTs are idempotent via the `openTxHash`
  // unique index.

  async scanLoanOpenedEvents(): Promise<{
    scanned: number;
    inserted: number;
    skipped: number;
    errors: number;
  }> {
    const startTime = Date.now();

    try {
      const cursor = await this.cursorRepo.findOne({
        where: { id: LOAN_OPENED_CURSOR_ID },
      });
      let fromBlock = cursor ? Number(cursor.block) : 0;
      const currentBlock = await provider.getBlockNumber();

      // Spec 065 §2.2.2 (the "Better" path that wasn't done in the original
      // migration): if cursor is at genesis, jump forward to ~current. The
      // scanner exists to catch NEW Type A drift, not historical — Layer 4's
      // backfill script handles history. Bootstrapping at 0 means the
      // scanner takes ~46 days to reach present on a chain with 67M+ blocks,
      // missing every new drift case until then.
      //
      // Jump to currentBlock - 100K (~5d of Celo, ample buffer for any
      // race between deploy and first cron tick). If admin needs to backfill
      // older missed loans, run the Layer 4 script instead.
      if (fromBlock === 0) {
        const bootstrapBlock = Math.max(0, currentBlock - 100_000);
        this.logger.warn(
          `[LoanOpenedScan] cursor at genesis — jumping to currentBlock-100K=${bootstrapBlock} ` +
            `(historical backfill is Layer 4's job, not the scanner's).`,
        );
        fromBlock = bootstrapBlock;
        await this.cursorRepo.save({
          id: LOAN_OPENED_CURSOR_ID,
          block: String(bootstrapBlock),
          updatedAt: new Date(),
        });
      }

      if (fromBlock >= currentBlock) {
        return { scanned: 0, inserted: 0, skipped: 0, errors: 0 };
      }

      const toBlock = Math.min(fromBlock + MAX_BLOCK_RANGE, currentBlock);
      const filter = this.contract.filters.LoanOpened();
      const events = await this.contract.queryFilter(
        filter,
        fromBlock + 1,
        toBlock,
      );

      let inserted = 0;
      let skipped = 0;
      let errors = 0;

      for (const event of events) {
        const e = event as EventLog;
        const wallet = (e.args[0] as string).toLowerCase();
        try {
          const result = await this.insertMissingLoan(e, wallet);
          if (result === 'inserted') inserted++;
          else skipped++;
        } catch (err) {
          errors++;
          this.logger.error(
            `[LoanOpenedScan] insert failed tx=${e.transactionHash}: ${err}`,
          );
        }
      }

      // Persist cursor advance even when some individual inserts errored;
      // the conditional INSERT (openTxHash unique) makes the next run a
      // safe no-op for the rows that did succeed.
      await this.cursorRepo.save({
        id: LOAN_OPENED_CURSOR_ID,
        block: String(toBlock),
        updatedAt: new Date(),
      });

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      this.logger.log(
        `[LoanOpenedScan] from=${fromBlock + 1} to=${toBlock} events=${events.length} ` +
          `inserted=${inserted} skipped=${skipped} errors=${errors} duration=${duration}s`,
      );

      return { scanned: events.length, inserted, skipped, errors };
    } catch (err) {
      this.logger.error(`[LoanOpenedScan] Fatal error: ${err}`);
      return { scanned: 0, inserted: 0, skipped: 0, errors: 1 };
    }
  }

  /**
   * INSERT a single missing loan derived from a `LoanOpened` event.
   *
   * Idempotent: returns 'skipped' if a row with this `openTxHash` already
   * exists, or if no DB user can be found for the wallet (KYC pending).
   *
   * Status is derived as `open` — the LoanClosed reconciler runs next in
   * the same cron cycle (see chain-sync.processor.ts) and will reconcile
   * this row if it has already been closed on chain.
   */
  private async insertMissingLoan(
    event: EventLog,
    wallet: string,
  ): Promise<'inserted' | 'skipped'> {
    const existing = await this.loanRepo.findOne({
      where: { openTxHash: event.transactionHash },
    });
    if (existing) return 'skipped';

    const user = await this.userRepo.findOne({
      where: { walletAddress: wallet },
    });
    if (!user) {
      // No DB user — surface for triage but don't error the whole scan.
      this.logger.warn(
        `[LoanOpenedScan] No DB user for wallet=${wallet} tx=${event.transactionHash}. Skipping.`,
      );
      return 'skipped';
    }

    // event.args (matches LoanManagerV3.sol:229-236 — 6 args, NO start):
    //   (user, principal, amountDue, due, feeBps, gracePeriod)
    //
    // Contract sets `L.start = block.timestamp` internally but does not
    // emit it. We recover startUnix from the block timestamp of the event
    // (same value the contract used).
    const principal = Number(event.args[1]) / 10 ** USDC_DECIMALS;
    const amountDue = Number(event.args[2]) / 10 ** USDC_DECIMALS;
    const dueUnix = Number(event.args[3]);
    const feeBps = Number(event.args[4]);
    const block = await provider.getBlock(event.blockNumber);
    if (!block) {
      this.logger.warn(
        `[LoanOpenedScan] Could not fetch block ${event.blockNumber} for tx=${event.transactionHash}. Skipping.`,
      );
      return 'skipped';
    }
    const startUnix = block.timestamp;
    const tenorDays = Math.round((dueUnix - startUnix) / 86400);

    // Mirror the exact shape used by `LoanService.informLoanOpened` so the
    // two write paths produce structurally-identical rows. Any NOT NULL
    // column the normal flow sets, we set too.
    const loan = this.loanRepo.create({
      userId: user.id,
      borrowerAddress: wallet,
      principal,
      amountDueAtOpen: amountDue,
      amountPaid: 0,
      tenorDays,
      feeBps,
      startAt: new Date(startUnix * 1000),
      dueAt: new Date(dueUnix * 1000),
      status: LoanStatus.OPEN,
      repaidOnTime: false,
      openTxHash: event.transactionHash,
      syncedByChain: true,
    });

    await this.loanRepo.save(loan);

    // WARN-level so each insert is visible in logs: each one represents a
    // failure of the primary `/inform-open` path that needs investigation
    // at scale (steady-state should be ~0 inserts per run).
    this.logger.warn(
      `[LoanOpenedScan] INSERTED missing loan wallet=${wallet} loanId=${loan.id} ` +
        `principal=${principal} tx=${event.transactionHash} — inform-open never fired`,
    );

    return 'inserted';
  }

  // ── Spec 065 Layer 5 — DB ↔ chain parity metric ────────────────
  //
  // Computes `subgraph_loans_count − db_loans_count` and persists it as
  // a metric so `/health/db-chain-parity` can return it. Logs an error
  // when |diff| ≥ 3 (3 absorbs the transient case where a fresh
  // inform-open lands between this computation and the next subgraph
  // poll; not a true regression).

  async computeDbChainDiff(): Promise<number | null> {
    try {
      const res = await fetch(env().SUBGRAPH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: '{ protocolStat(id: "global") { loansOriginated } }',
        }),
      });
      if (!res.ok) {
        this.logger.warn(
          `[ParityMetric] Subgraph fetch failed: HTTP ${res.status}`,
        );
        return null;
      }

      const json = (await res.json()) as {
        data?: { protocolStat?: { loansOriginated?: string } };
      };
      const subgraphCount = Number(
        json.data?.protocolStat?.loansOriginated ?? NaN,
      );
      if (!Number.isFinite(subgraphCount)) {
        this.logger.warn(
          `[ParityMetric] Subgraph returned no protocolStat: ${JSON.stringify(json)}`,
        );
        return null;
      }

      const dbCount = await this.loanRepo.count();
      const rawDiff = subgraphCount - dbCount;
      // Spec 070 — subtract the 29 pre-launch testing loans that exist on
      // chain by design but are intentionally NOT in DB. See
      // `known-testing-loans.ts` for the txHash list + rationale.
      const effectiveDiff = rawDiff - KNOWN_TESTING_LOANS_COUNT;

      // Persist both: `db_chain_loan_diff` is the effective number used by
      // /health/db-chain-parity (post noise subtraction); `db_chain_loan_diff_raw`
      // exposes the gross gap for ops dashboards that want to see total.
      await this.metricRepo.save({
        key: 'db_chain_loan_diff',
        value: effectiveDiff,
        updatedAt: new Date(),
      });
      await this.metricRepo.save({
        key: 'db_chain_loan_diff_raw',
        value: rawDiff,
        updatedAt: new Date(),
      });

      if (Math.abs(effectiveDiff) >= 3) {
        this.logger.error(
          `[ParityMetric] 🚨 db_chain_loan_diff=${effectiveDiff} ` +
            `(subgraph=${subgraphCount} db=${dbCount} noise=${KNOWN_TESTING_LOANS_COUNT}). ` +
            `Investigate: scanner failing, /inform-open broken, or contract drift.`,
        );
      } else {
        this.logger.log(
          `[ParityMetric] db_chain_loan_diff=${effectiveDiff} ` +
            `(subgraph=${subgraphCount} db=${dbCount} noise=${KNOWN_TESTING_LOANS_COUNT})`,
        );
      }

      return effectiveDiff;
    } catch (err) {
      this.logger.error(`[ParityMetric] Fatal error: ${err}`);
      return null;
    }
  }

  // ── On-chain reads ─────────────────────────────────────────────

  private async getOnChainLoan(
    borrowerAddress: string,
  ): Promise<{ active: boolean; start: number }> {
    const result = (await this.contract.loans(borrowerAddress)) as unknown[];
    return {
      active: result[6] as boolean,
      // loans(addr).start — block.timestamp at openLoan. 0 when slot is inactive.
      start: Number(result[2]),
    };
  }

  /**
   * Search for LoanClosed event. Returns null only when genuinely not found.
   * Throws on RPC errors so the caller can skip reconciliation and retry next cycle.
   */
  private async findLoanClosedEvent(
    borrowerAddress: string,
    loanStartAt: Date,
    currentBlock: number,
  ): Promise<{
    amountPaid: bigint;
    txHash: string;
    blockNumber: number;
    timestamp: number;
  } | null> {
    // Calculate search window from loan start (all stored as UTC timestamptz)
    const loanStartUnix = Math.floor(loanStartAt.getTime() / 1000);
    const nowUnix = Math.floor(Date.now() / 1000);
    const blocksSinceStart = Math.ceil(
      (nowUnix - loanStartUnix) / CELO_BLOCK_TIME_SEC,
    );
    const fromBlock = Math.max(0, currentBlock - blocksSinceStart - 2000);

    const filter = this.contract.filters.LoanClosed(borrowerAddress);

    // Search newest-first in chunks (most recent chunk first)
    for (let to = currentBlock; to >= fromBlock; to -= MAX_BLOCK_RANGE) {
      const from = Math.max(to - MAX_BLOCK_RANGE + 1, fromBlock);
      const events = await this.contract.queryFilter(filter, from, to);

      // Spec 043 — Layer 1: walk events newest-first within the chunk and
      // return the FIRST one whose timestamp is >= loanStartUnix. Older
      // events belong to previous loans of the same wallet (a wallet can
      // borrow → close → re-borrow many times) and must NOT be assigned
      // to this loan. Without this filter, chain-sync was assigning the
      // most-recent LoanClosed of a wallet to ALL unsynced rows of that
      // wallet, generating duplicate closeTxHash entries (audit
      // 2026-05-05 found 15 hashes in 16 phantom rows, $205 inflated
      // Repaid USD in admin trends).
      if (events.length > 0) {
        for (let i = events.length - 1; i >= 0; i--) {
          const event = events[i] as EventLog;
          const block = await provider.getBlock(event.blockNumber);
          const eventTimestamp = block?.timestamp ?? nowUnix;

          if (eventTimestamp < loanStartUnix) {
            // This event happened BEFORE this loan was opened — it
            // belongs to a previous loan of the same wallet. Continue
            // walking backwards (older events are even further from
            // matching this loan, so we can stop early).
            this.logger.debug(
              `[ChainSync] Skipping LoanClosed at ${eventTimestamp} (< loanStartUnix=${loanStartUnix}) for ${borrowerAddress}`,
            );
            return null;
          }

          return {
            amountPaid: event.args[1] as bigint,
            txHash: event.transactionHash,
            blockNumber: event.blockNumber,
            timestamp: eventTimestamp,
          };
        }
      }

      // Small delay between chunk queries to avoid RPC throttling
      if (to - MAX_BLOCK_RANGE >= fromBlock) {
        await this.sleep(200);
      }
    }

    // Exhausted the search range — event genuinely not found
    return null;
  }

  // ── Reconciliation ─────────────────────────────────────────────

  /**
   * Reconcile a single loan. Returns true if the loan was actually updated,
   * false if it was already reconciled (idempotency), or throws on error.
   */
  private async reconcileLoan(
    loan: Loan,
    user: User,
    currentBlock: number,
  ): Promise<boolean> {
    const oldStatus = loan.status;

    // Search for the LoanClosed event to get amountPaid + txHash.
    // Throws on RPC error — loan stays open and will be retried next cycle.
    let eventData: Awaited<ReturnType<typeof this.findLoanClosedEvent>>;
    try {
      eventData = await this.findLoanClosedEvent(
        loan.borrowerAddress,
        loan.startAt,
        currentBlock,
      );
    } catch (err) {
      this.logger.warn(
        `[ChainSync] RPC error searching events for loanId=${loan.id} wallet=${loan.borrowerAddress}: ${err}. Will retry next cycle.`,
      );
      throw err;
    }

    // Transaction with pessimistic lock
    const result = await this.loanRepo.manager.transaction(async (manager) => {
      const freshLoan = await manager.findOne(Loan, {
        where: { id: loan.id },
        lock: { mode: 'pessimistic_write' },
      });

      if (!freshLoan) return null;

      // Idempotency: already reconciled with a chain receipt → don't touch.
      // Note: we deliberately DO NOT skip on `closedAt` alone. A row with
      // status=repaid_* and closedAt=server-time but closeTxHash=NULL is
      // exactly what spec 019 §4.1 targets — chain-sync must overwrite
      // server-time closedAt + DB amountPaid with chain truth.
      if (freshLoan.closeTxHash) return null;
      if (
        freshLoan.status !== LoanStatus.OPEN &&
        freshLoan.status !== LoanStatus.DEFAULTED &&
        freshLoan.status !== LoanStatus.DEFAULTED_IN_GRACE &&
        freshLoan.status !== LoanStatus.REPAID_ON_TIME &&
        freshLoan.status !== LoanStatus.REPAID_LATE
      ) {
        return null;
      }

      // Populate from event. If the event isn't found in the search range,
      // SKIP this loan rather than fabricate closedAt/amountPaid (audit 2026-04-18
      // spec 009 §9.7 — the previous fallback wrote `closedAt=NOW()` + null
      // closeTxHash, corrupting ~half a dozen historical records).
      if (!eventData) {
        this.logger.warn(
          `[ChainSync] LoanClosed event not found for loanId=${freshLoan.id} ` +
            `wallet=${freshLoan.borrowerAddress} startAt=${freshLoan.startAt.toISOString()}. ` +
            `Leaving row untouched; will retry next cycle.`,
        );
        return null;
      }

      // Spec 043 — Layer 2: closer-loan check. If there's another DB loan
      // for the same wallet whose startAt is BETWEEN this loan's startAt
      // and the event timestamp, that newer loan is the rightful owner of
      // the event. Skip rather than create a phantom assignment.
      const closerLoan = await manager.findOne(Loan, {
        where: {
          borrowerAddress: freshLoan.borrowerAddress.toLowerCase(),
          startAt: Between(
            new Date(freshLoan.startAt.getTime() + 1),
            new Date(eventData.timestamp * 1000),
          ),
        },
        order: { startAt: 'DESC' },
      });
      if (closerLoan && closerLoan.id !== freshLoan.id) {
        this.logger.warn(
          `[ChainSync] Spec 043 — event txHash=${eventData.txHash} at ts=${eventData.timestamp} ` +
            `is closer to loanId=${closerLoan.id} (startAt=${closerLoan.startAt.toISOString()}) ` +
            `than to loanId=${freshLoan.id} (startAt=${freshLoan.startAt.toISOString()}). ` +
            `Skipping reconciliation to avoid duplicate closeTxHash.`,
        );
        return null;
      }

      // Spec 043 — Layer 3: idempotency by closeTxHash. Reject if the
      // candidate event hash is already assigned to a different loan.
      // Defense in depth alongside the unique index migration B.
      const existingByCloseTx = await manager.findOne(Loan, {
        where: { closeTxHash: eventData.txHash },
      });
      if (existingByCloseTx && existingByCloseTx.id !== freshLoan.id) {
        this.logger.warn(
          `[ChainSync] Spec 043 — closeTxHash=${eventData.txHash} already assigned to ` +
            `loanId=${existingByCloseTx.id}. Refusing to duplicate to loanId=${freshLoan.id}.`,
        );
        return null;
      }

      freshLoan.amountPaid =
        Number(eventData.amountPaid) / 10 ** USDC_DECIMALS;
      freshLoan.closeTxHash = eventData.txHash;
      freshLoan.closedAt = new Date(eventData.timestamp * 1000);

      const repaidOnTime =
        freshLoan.closedAt.getTime() <=
        freshLoan.dueAt.getTime() + REPAID_ON_TIME_GRACE_MS;
      freshLoan.repaidOnTime = repaidOnTime;
      freshLoan.status = repaidOnTime
        ? LoanStatus.REPAID_ON_TIME
        : LoanStatus.REPAID_LATE;
      freshLoan.syncedByChain = true;

      // Mora cobrada — mirrors admin overview filter so cohort SUMs are
      // queryable in O(N) instead of FILTER-and-compute per request.
      // Definition: paid - amountDueAtOpen if late-late-late, else 0.
      const closedAfter24hGrace =
        freshLoan.closedAt.getTime() - freshLoan.dueAt.getTime() >
        24 * 60 * 60 * 1000;
      const paidExtra = freshLoan.amountPaid - freshLoan.amountDueAtOpen;
      freshLoan.lateFeesCollectedUsd =
        !repaidOnTime && closedAfter24hGrace && paidExtra > 0 ? paidExtra : 0;

      await manager.save(Loan, freshLoan);

      return { freshLoan, repaidOnTime };
    });

    // Notification cancellation removed (notification module not present in stellar base).

    if (!result) {
      this.logger.log(
        `[ChainSync] loanId=${loan.id} already reconciled, skipped.`,
      );
      return false;
    }

    const { freshLoan, repaidOnTime } = result;

    this.logger.log(
      `[ChainSync] RECONCILED loanId=${loan.id} wallet=${loan.borrowerAddress} ` +
        `${oldStatus} -> ${freshLoan.status} amountPaid=${freshLoan.amountPaid} ` +
        `closeTxHash=${freshLoan.closeTxHash ?? 'N/A'} repaidOnTime=${repaidOnTime}`,
    );

    // Post-transaction: renew on-chain validUntil for ALL repayments.
    // On-time: upgrade score/limit + renew. Late: keep current score/limit + renew.
    // Spec 030 — pass closedAt so updateCreditScore can promote the
    // setUserRisk tx to priority='high' if this reconciliation is fresh.
    await this.updateCreditScore(
      loan.borrowerAddress,
      user.id,
      repaidOnTime,
      freshLoan.closedAt,
    );

    return true;
  }

  private async updateCreditScore(
    borrowerAddress: string,
    userId: number,
    repaidOnTime: boolean = true,
    closedAt?: Date | null,
  ): Promise<void> {
    try {
      const user = await this.userRepo.findOne({ where: { id: userId } });
      if (!user) return;

      let newScore = user.score ?? 1;
      let newLimitUnitsNum = user.creditLimit
        ? Number(user.creditLimit)
        : Number(DEFAULT_CREDIT_LIMIT_USDC);

      if (repaidOnTime) {
        const onTimeLoans = await this.loanRepo.count({
          where: { userId, repaidOnTime: true },
        });

        const ladderStep = this.creditPolicy.getStepForOnTimeLoans(onTimeLoans);
        newScore = ladderStep.score;
        const targetLimitUnitsNum = Number(toUnits(ladderStep.limitUsdc, 6));
        newLimitUnitsNum = Math.max(newLimitUnitsNum, targetLimitUnitsNum);

        const currentXp = user.xp ?? 1;
        if (ladderStep.xpBase > currentXp) {
          user.xp = ladderStep.xpBase;
        }
      }

      const kind = repaidOnTime ? 'upgrade' : 'renewal';

      // Spec 030 — promote to high priority when reconciling a fresh repay
      // (loan closed within last 2 minutes). User likely just paid in-app
      // and is waiting for the slider/limit to update; piggyback on the
      // priority lane introduced by spec 029 so the catch-up is fast.
      // Older background reconciliations stay 'low'.
      const closedAtMs = closedAt?.getTime() ?? Date.now();
      const minutesSinceClose = (Date.now() - closedAtMs) / 60000;
      const priority: 'high' | 'low' =
        minutesSinceClose < 2 ? 'high' : 'low';

      this.logger.log(
        `[ChainSync] Credit ${kind}: wallet=${borrowerAddress} score=${newScore} limit=${newLimitUnitsNum} priority=${priority} (closed ${minutesSinceClose.toFixed(1)}min ago)`,
      );

      const chainResult = await this.blockchain.giveCreditScoreAndLimit(
        borrowerAddress,
        newScore,
        BigInt(newLimitUnitsNum),
        undefined,
        undefined,
        priority,
      );

      if (chainResult === 200) {
        user.score = newScore;
        user.creditLimit = newLimitUnitsNum;
        await this.userRepo.save(user);
      }
    } catch (err) {
      this.logger.error(
        `[ChainSync] Credit update failed for wallet=${borrowerAddress}: ${err}`,
      );
    }
  }

  // ── Renew expired on-chain offers ────────────────────────────

  /**
   * Every 6 hours, find verified users whose on-chain validUntil
   * has expired (creditLimit returns 0) and renew it.
   * This fixes users stuck on "Sin límite disponible" in the frontend.
   */
  async renewExpiredOffers(): Promise<void> {
    const MAX_RENEWALS = 25; // cap per run to avoid excessive gas

    try {
      // All verified users (have score set)
      const verifiedUsers = await this.userRepo.find({
        where: {
          score: Not(IsNull()),
        },
        select: ['id', 'walletAddress', 'score', 'creditLimit'],
      });

      if (!verifiedUsers.length) return;

      const nowUnix = Math.floor(Date.now() / 1000);
      // Renew if expiring within 3 days (buffer before the 30-day cliff)
      const renewThreshold = nowUnix + 3 * 24 * 60 * 60;

      let renewed = 0;
      let checked = 0;

      for (let i = 0; i < verifiedUsers.length; i += BATCH_SIZE) {
        if (renewed >= MAX_RENEWALS) break;

        const batch = verifiedUsers.slice(i, i + BATCH_SIZE);
        await Promise.allSettled(
          batch.map(async (user) => {
            if (renewed >= MAX_RENEWALS) return;
            if (!user.walletAddress) return;

            checked++;
            try {
              const onChain = (await this.contract.users(
                user.walletAddress,
              )) as unknown[];
              const validUntil = Number(onChain[2]);

              // Skip if no validUntil set (0 means no expiry) or still fresh
              if (validUntil === 0 || validUntil > renewThreshold) return;

              const score = user.score ?? 1;
              const limit = user.creditLimit
                ? Number(user.creditLimit)
                : Number(DEFAULT_CREDIT_LIMIT_USDC);

              this.logger.log(
                `[ChainSync] Renewing expired offer: wallet=${user.walletAddress} ` +
                  `validUntil=${new Date(validUntil * 1000).toISOString()} score=${score} limit=${limit}`,
              );

              await this.blockchain.giveCreditScoreAndLimit(
                user.walletAddress,
                score,
                BigInt(limit),
              );
              renewed++;
            } catch (err) {
              this.logger.error(
                `[ChainSync] Renewal failed for wallet=${user.walletAddress}: ${err}`,
              );
            }
          }),
        );

        if (i + BATCH_SIZE < verifiedUsers.length) {
          await this.sleep(BATCH_DELAY_MS);
        }
      }

      if (renewed > 0 || checked > 0) {
        this.logger.log(
          `[ChainSync] renewExpiredOffers: checked=${checked}, renewed=${renewed}`,
        );
      }
    } catch (err) {
      this.logger.error(`[ChainSync] renewExpiredOffers fatal error: ${err}`);
    }
  }

  // ── Late fees snapshot (spec 064 — voice collections) ──────────

  /**
   * Spec 064 — Voice Collections Orchestration.
   *
   * Cachear el estado on-chain de mora en cada loan OPEN para evitar que
   * el voice-agent/orchestrator haga RPC a Forno en runtime. Sin esto,
   * cada llamada outbound dispararía 2-3 RPCs por deudor.
   *
   * Estrategia para minimizar RPC load:
   *   - Si el loan TIENE rate cacheado (lateRatePerSecWad != null) y se
   *     refrescó hace <24h → SOLO recalcular lateFeesCurrentUsd offline
   *     con LoanCalculationsService (0 RPC).
   *   - Si NO TIENE rate o es stale (>24h) → readPremium + readLoanFull
   *     (2 RPC, una vez al día por loan).
   *
   * En piloto (~20 loans overdue), peor caso: 40 RPC por cycle = trivial
   * para Forno. Al escalar a 500 loans, casi todos caen en el "fast path"
   * de 0 RPC porque ya tienen rate cacheado.
   */
  async syncLateFeesSnapshot(): Promise<void> {
    const startTime = Date.now();
    const RATE_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h

    try {
      // Solo loans OPEN cuya dueAt < now (los que pueden tener late fees).
      // Si dueAt > now, ratePerSec=0 contribución por estar pre-grace.
      const now = new Date();
      const overdueLoans = await this.loanRepo
        .createQueryBuilder('loan')
        .where('loan.status = :status', { status: LoanStatus.OPEN })
        .andWhere('loan.dueAt < :now', { now })
        .getMany();

      if (!overdueLoans.length) {
        this.logger.log('[LateFeesSnapshot] No overdue loans to update.');
        return;
      }

      this.logger.log(
        `[LateFeesSnapshot] Starting. Overdue loans: ${overdueLoans.length}`,
      );

      let rateRefreshed = 0;
      let fastPath = 0;
      let errors = 0;
      const nowUnixSec = Math.floor(now.getTime() / 1000);

      for (let i = 0; i < overdueLoans.length; i += BATCH_SIZE) {
        const batch = overdueLoans.slice(i, i + BATCH_SIZE);
        await Promise.allSettled(
          batch.map(async (loan) => {
            try {
              const snapshotAt = loan.lateFeesSnapshotAt
                ? loan.lateFeesSnapshotAt.getTime()
                : 0;
              const isStale =
                !loan.lateRatePerSecWad ||
                loan.gracePeriodSec == null ||
                Date.now() - snapshotAt > RATE_REFRESH_INTERVAL_MS;

              let ratePerSecWadBig: bigint;
              let gracePeriodSec: number;

              if (isStale) {
                // Slow path: 2 RPCs to read fresh rate + grace.
                const [premium, loanFull] = await Promise.all([
                  this.blockchain.readPremium(loan.borrowerAddress),
                  this.blockchain.readLoanFull(loan.borrowerAddress),
                ]);

                if (!premium || !loanFull) {
                  this.logger.warn(
                    `[LateFeesSnapshot] Skip loanId=${loan.id} — RPC read returned null`,
                  );
                  return;
                }

                ratePerSecWadBig = premium.lateRatePerSecWad;
                gracePeriodSec = loanFull.gracePeriod;
                rateRefreshed++;
              } else {
                // Fast path: use cached rate, no RPC.
                ratePerSecWadBig = BigInt(loan.lateRatePerSecWad!);
                gracePeriodSec = loan.gracePeriodSec!;
                fastPath++;
              }

              // Offline calc — no RPC.
              const result = this.loanCalc.computeLateFees({
                amountDueAtOpenUsd: loan.amountDueAtOpen,
                dueAtUnixSec: Math.floor(loan.dueAt.getTime() / 1000),
                ratePerSecWad: ratePerSecWadBig,
                gracePeriodSec,
                nowUnixSec,
              });

              await this.loanRepo.update(loan.id, {
                lateRatePerSecWad: ratePerSecWadBig.toString(),
                gracePeriodSec,
                lateFeesCurrentUsd: result.lateFeesUsd,
                lateFeesSnapshotAt: now,
              });
            } catch (err) {
              errors++;
              this.logger.error(
                `[LateFeesSnapshot] loanId=${loan.id} failed: ${err}`,
              );
            }
          }),
        );

        if (i + BATCH_SIZE < overdueLoans.length) {
          await this.sleep(BATCH_DELAY_MS);
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      this.logger.log(
        `[LateFeesSnapshot] Done. total=${overdueLoans.length} rateRefreshed=${rateRefreshed} fastPath=${fastPath} errors=${errors} duration=${duration}s`,
      );
    } catch (err) {
      this.logger.error(`[LateFeesSnapshot] Fatal error: ${err}`);
    }
  }

  // ── Ladder recalculation ────────────────────────────────────

  /**
   * Recalculate score and credit limit for verified users, grouped by
   * current DB score (level).
   *
   * For each level:
   *  1. Pick one "canary" user → read on-chain (free view call).
   *  2. If canary matches the ladder → level is in sync on-chain.
   *     Only verify DB rows (no RPC reads/writes for the rest).
   *  3. If canary doesn't match → iterate every user in the level,
   *     read on-chain, and write only when the value differs.
   */
  async recalculateAllLimits(): Promise<void> {
    try {
      const verifiedUsers = await this.userRepo.find({
        where: { score: Not(IsNull()) },
      });

      if (!verifiedUsers.length) {
        this.logger.log('[LadderRecalc] No verified users to recalculate.');
        return;
      }

      // ── Group users by their current DB score ─────────────
      const byScore = new Map<number, User[]>();
      for (const user of verifiedUsers) {
        const s = user.score ?? 1;
        const group = byScore.get(s);
        if (group) group.push(user);
        else byScore.set(s, [user]);
      }

      let chainWrites = 0;
      let dbOnly = 0;
      let skipped = 0;
      let errors = 0;

      for (const [level, users] of byScore) {
        // ── Canary check: one RPC read per level ────────────
        const canary = users.find((u) => u.walletAddress) ?? users[0];
        let levelNeedsChainUpdate = false;

        if (canary?.walletAddress) {
          try {
            const canaryOnTime = await this.loanRepo.count({
              where: { userId: canary.id, repaidOnTime: true },
            });
            const canaryStep =
              this.creditPolicy.getStepForOnTimeLoans(canaryOnTime);
            const canaryLimitUnits = Number(
              toUnits(canaryStep.limitUsdc, 6),
            );

            const onChain = (await this.contract.users(
              canary.walletAddress,
            )) as unknown[];
            const onChainScore = Number(onChain[0]);
            const onChainLimit = Number(onChain[4]);

            levelNeedsChainUpdate =
              onChainScore !== canaryStep.score ||
              onChainLimit !== canaryLimitUnits;
          } catch {
            levelNeedsChainUpdate = true;
          }
        }

        if (!levelNeedsChainUpdate) {
          this.logger.log(
            `[LadderRecalc] Level ${level}: canary OK on-chain — DB-only check (${users.length} users)`,
          );
        } else {
          this.logger.log(
            `[LadderRecalc] Level ${level}: canary MISMATCH — full check (${users.length} users)`,
          );
        }

        // ── Process every user in this level ────────────────
        // Spec 021 §M3 fix: when chain writes are needed for this level,
        // process serially. The signer has an internal FIFO queue
        // (contractConfig.ts:`enqueue`) but parallel recalcUser() calls
        // each trigger `autoClearPendingNoncesIfNeeded`, which races the
        // signer's `latest` nonce read against in-flight txs from the
        // prior callers in the same batch. Empirically observed
        // 2026-04-23: 8 AUTO_CLEAR_FAILED errors out of 87 writes.
        // Serial avoids the race entirely — each write awaits the prior
        // receipt before the next `autoClearPendingNoncesIfNeeded` runs.
        //
        // When the level is DB-only (canary OK), we keep the batched
        // parallelism since no signer is involved.
        if (levelNeedsChainUpdate) {
          for (const user of users) {
            const r = await this.recalcUser(user, true);
            if (r === 'chain') chainWrites++;
            else if (r === 'db') dbOnly++;
            else if (r === 'skip') skipped++;
            else errors++;
          }
        } else {
          for (let i = 0; i < users.length; i += BATCH_SIZE) {
            const batch = users.slice(i, i + BATCH_SIZE);
            await Promise.allSettled(
              batch.map((user) =>
                this.recalcUser(user, false).then((r) => {
                  if (r === 'chain') chainWrites++;
                  else if (r === 'db') dbOnly++;
                  else if (r === 'skip') skipped++;
                  else errors++;
                }),
              ),
            );
          }
        }
      }

      this.logger.log(
        `[LadderRecalc] Complete. chainWrites: ${chainWrites}, dbOnly: ${dbOnly}, skipped: ${skipped}, errors: ${errors}`,
      );
    } catch (err) {
      this.logger.error(`[LadderRecalc] Fatal error: ${err}`);
    }
  }

  /** Process a single user. Returns what happened: chain write, db-only fix, skip, or error. */
  private async recalcUser(
    user: User,
    checkChain: boolean,
  ): Promise<'chain' | 'db' | 'skip' | 'error'> {
    if (!user.walletAddress) return 'skip';

    try {
      const onTimeLoans = await this.loanRepo.count({
        where: { userId: user.id, repaidOnTime: true },
      });
      const step = this.creditPolicy.getStepForOnTimeLoans(onTimeLoans);
      const correctLimitUnits = Number(
        toUnits(step.limitUsdc, 6),
      );

      const dbScore = user.score ?? 1;
      const dbLimit = user.creditLimit ? Number(user.creditLimit) : 0;
      const dbInSync = dbScore === step.score && dbLimit === correctLimitUnits;

      if (checkChain) {
        // Level canary was wrong → full on-chain verification
        const onChain = (await this.contract.users(
          user.walletAddress,
        )) as unknown[];
        const chainInSync =
          Number(onChain[0]) === step.score &&
          Number(onChain[4]) === correctLimitUnits;

        if (chainInSync && dbInSync) return 'skip';

        if (!chainInSync) {
          this.logger.log(
            `[LadderRecalc] wallet=${user.walletAddress} onTimeLoans=${onTimeLoans} ` +
              `onChain: score=${Number(onChain[0])} limit=${Number(onChain[4])} -> ` +
              `score=${step.score} limit=${correctLimitUnits}`,
          );

          const result = await this.blockchain.giveCreditScoreAndLimit(
            user.walletAddress,
            step.score,
            BigInt(correctLimitUnits),
          );
          if (result !== 200) {
            this.logger.error(
              `[LadderRecalc] Chain write failed for wallet=${user.walletAddress}: result=${result}`,
            );
            return 'error';
          }
        }

        if (!dbInSync) {
          await this.userRepo.update(user.id, {
            score: step.score,
            creditLimit: correctLimitUnits,
            ...(step.xpBase > (user.xp ?? 0) ? { xp: step.xpBase } : {}),
          });
        }

        return chainInSync ? 'db' : 'chain';
      }

      // Level canary was OK → DB-only check, no RPC
      if (dbInSync) return 'skip';

      await this.userRepo.update(user.id, {
        score: step.score,
        creditLimit: correctLimitUnits,
        ...(step.xpBase > (user.xp ?? 0) ? { xp: step.xpBase } : {}),
      });
      return 'db';
    } catch (err) {
      this.logger.error(
        `[LadderRecalc] Error for wallet=${user.walletAddress}: ${err}`,
      );
      return 'error';
    }
  }

  // ── Helpers ────────────────────────────────────────────────────

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
