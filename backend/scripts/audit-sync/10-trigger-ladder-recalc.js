#!/usr/bin/env node
/**
 * Spec 021 §Phase 4 — manual trigger for the ladder recalc job.
 *
 * Since the startup-triggered recalc was removed (chain-sync.scheduler.ts),
 * the operator runs this script explicitly after any known drift event:
 *
 *   - After a ladder-config change in credit-policy.service.ts
 *   - After a bulk SQL UPDATE on `loans.repaidOnTime` or `loans.status`
 *     that changes a user's onTimeLoans count (example: spec 018 Paso 3,
 *     spec 019 Phase 2 amount recomputation).
 *   - Ad-hoc when DB↔chain drift is suspected.
 *
 * The job is enqueued on the `chain-sync` BullMQ queue with job name
 * `recalculate-limits`. The existing processor
 * (`chain-sync.processor.ts`) picks it up and delegates to
 * `ChainSyncService.recalculateAllLimits()`.
 *
 * Runs in-process against the same Redis the backend uses.
 *
 * Environment:
 *   REDIS_HOST      default 'redis' (backend container sees it there)
 *   REDIS_PORT      default 6379
 *   DRY_RUN=1       skip enqueue; print what would happen
 */
'use strict';

const { Queue } = require('/app/node_modules/bullmq');

const REDIS_HOST = process.env.REDIS_HOST || 'redis';
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);
const DRY_RUN = process.env.DRY_RUN === '1';

(async () => {
  const connection = { host: REDIS_HOST, port: REDIS_PORT };
  const queue = new Queue('chain-sync', { connection });

  const jobId = `recalculate-limits-manual-${Date.now()}`;
  console.log(
    `Enqueue recalculate-limits on queue 'chain-sync' (jobId=${jobId}, mode=${DRY_RUN ? 'DRY-RUN' : 'APPLY'})`,
  );
  if (DRY_RUN) {
    console.log('DRY-RUN: not enqueuing. Exit.');
    await queue.close();
    return;
  }

  const job = await queue.add(
    'recalculate-limits',
    {},
    {
      jobId,
      removeOnComplete: true,
      removeOnFail: false,
    },
  );
  console.log(`Enqueued job id=${job.id}. Worker will process next tick.`);
  console.log(
    'Watch progress with: docker logs -f backend 2>&1 | grep LadderRecalc',
  );
  await queue.close();
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
