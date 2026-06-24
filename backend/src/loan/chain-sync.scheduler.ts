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

    this.logger.log('Chain-sync repeatable jobs registered');
  }
}
