import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ChainSyncService } from './chain-sync.service';
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
        await this.chainSync.syncLoansWithChain();
        break;
      case 'renew-offers':
        await this.chainSync.renewExpiredOffers();
        break;
      default:
        this.logger.warn(`Unknown job: ${job.name}`);
    }
  }
}
