// src/infrastructure/queue/chain-sync.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ChainSyncService } from 'src/loan/chain-sync.service';
import { Logger } from '@nestjs/common';

@Processor('chain-sync', { concurrency: 1 })
export class ChainSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(ChainSyncProcessor.name);

  constructor(private readonly chainSync: ChainSyncService) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case 'sync-loans':
        // Spec 065 Layer 3 — ordering. Scan LoanOpened events FIRST so any
        // newly discovered DB-missing loans are present before
        // syncLoansWithChain reconciles closures. Without this ordering
        // the reconciler can assign a LoanClosed event to the wrong DB
        // row (Type B cross-contamination — the symmetric guard in spec
        // 043 catches most cases, but the ordering removes the
        // opportunity for the race entirely).
        await this.chainSync.scanLoanOpenedEvents();
        await this.chainSync.syncLoansWithChain();
        // Spec 065 Layer 5 — parity metric. After both ends of the loop
        // have run, persist the residual diff (steady-state should be 0).
        // Errors here don't fail the job; the next cycle re-tries.
        try {
          await this.chainSync.computeDbChainDiff();
        } catch (err) {
          this.logger.error(`[ChainSync] parity-metric failed: ${err}`);
        }
        break;
      case 'renew-offers':
        await this.chainSync.renewExpiredOffers();
        break;
      case 'recalculate-limits':
        await this.chainSync.recalculateAllLimits();
        break;
      case 'sync-late-fees':
        await this.chainSync.syncLateFeesSnapshot();
        break;
      default:
        this.logger.warn(`Unknown job: ${job.name}`);
    }
  }
}
