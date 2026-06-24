// src/infrastructure/queue/chain-sync.scheduler.ts
import { Injectable, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class ChainSyncScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(ChainSyncScheduler.name);

  constructor(@InjectQueue('chain-sync') private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    // Remove stale repeatable jobs from previous deploys
    const existing = await this.queue.getRepeatableJobs();
    for (const job of existing) {
      await this.queue.removeRepeatableByKey(job.key);
    }

    // Sync loans every 10 minutes
    await this.queue.add(
      'sync-loans',
      {},
      {
        repeat: { every: 10 * 60 * 1000 },
        jobId: 'chain-sync-loans',
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    );

    // Renew expired offers every 6 hours
    await this.queue.add(
      'renew-offers',
      {},
      {
        repeat: { every: 6 * 60 * 60 * 1000 },
        jobId: 'chain-renew-offers',
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    );

    // Spec 064 — Voice collections.
    // Refresh late-fees snapshot (premium rate, gracePeriod, lateFeesCurrentUsd)
    // for every overdue loan every 10 minutes. Most loans take the fast path
    // (no RPC, just recompute with cached rate). New / stale loans hit Forno
    // with 2 RPCs (~24h rate refresh interval).
    await this.queue.add(
      'sync-late-fees',
      {},
      {
        repeat: { every: 10 * 60 * 1000 },
        jobId: 'chain-sync-late-fees',
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    );

    // One-time startup job: renew expired offers after 10 seconds
    await this.queue.add(
      'renew-offers',
      {},
      {
        delay: 10_000,
        jobId: `renew-offers-startup-${Date.now()}`,
        removeOnComplete: true,
      },
    );

    // Spec 021 §Phase 4: the one-time startup `recalculate-limits` job
    // was deliberately removed. It used to fire unconditionally 30s after
    // every backend restart, producing a burst of chain writes that
    // scaled with accumulated drift from the prior deploy window
    // (2026-04-23: 79 writes + 8 nonce-race failures). The recalc itself
    // is still available via the `recalculate-limits` job name — to
    // trigger manually after a known drift event (bulk SQL migration,
    // ladder change), run the CLI at
    // `backend/scripts/audit-sync/10-trigger-ladder-recalc.js`.
    //
    // Drift prevention is now the responsibility of the per-call path
    // (inform-repayment + chain-sync §4.1 auto-reconcile). When those
    // paths work, nothing accumulates between deploys.

    this.logger.log('Chain-sync repeatable jobs registered (startup recalc disabled — see spec 021)');
  }
}
