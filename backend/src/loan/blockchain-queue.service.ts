// src/loan/blockchain-queue.service.ts
//
// Typed facade over the 'blockchain' BullMQ queue.
//
// Callers (LoanService, ChainSyncService) call the enqueue* helpers and
// await them — they behave like the direct contract calls they replace, but
// all writes are serialised by the BlockchainProcessor (concurrency: 1)
// before they touch the chain, giving a single ordering point across
// concurrent HTTP requests.
//
// waitUntilFinished semantics
//   The HTTP handlers currently return data that depends on the TX receipt
//   (e.g. minedBlock, feeBps).  waitUntilFinished keeps the caller's public
//   contract unchanged: add job → wait → return result.  The queue provides
//   the serial guarantee; the response is still synchronous from the caller's
//   perspective.
//
// QueueEvents
//   BullMQ v5 requires a dedicated QueueEvents instance (its own Redis
//   connection) to listen for job completion events.  We create it once in
//   onModuleInit and destroy it in onModuleDestroy.
//
// DEFAULT_JOB_OPTIONS
//   attempts: 3    — mirrors the retry loop already inside sendContractTx
//   backoff: fixed 2 s — gives the RPC a moment to settle between retries
//   removeOnComplete: 100 — keep the last 100 completed jobs for observability
//   removeOnFail: 200     — keep the last 200 failed jobs for post-mortem

import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, QueueEvents } from 'bullmq';
import { env } from 'src/config/env';

import {
  BLOCKCHAIN_JOB,
  BlockchainJobData,
  BlockchainJobResult,
  SetUserRiskPayload,
  SetUserRiskResult,
  SetLoanOfferPayload,
  SetLoanOfferResult,
  SetPremiumConfigPayload,
  SetPremiumConfigResult,
} from 'src/infrastructure/queue/blockchain.processor';

const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'fixed' as const, delay: 2_000 },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 200 },
};

// How long (ms) to wait for a job result before timing out.
// 3 attempts × 60 s TX_CONFIRM_TIMEOUT + 2 × 2 s backoff + buffer ≈ 190 s.
const WAIT_TIMEOUT_MS = 200_000;

@Injectable()
export class BlockchainQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BlockchainQueueService.name);
  private queueEvents!: QueueEvents;

  constructor(
    @InjectQueue('blockchain')
    private readonly queue: Queue<BlockchainJobData, BlockchainJobResult>,
  ) {}

  onModuleInit() {
    const e = env();
    const connection = {
      host: e.REDIS_HOST,
      port: e.REDIS_PORT,
      ...(e.REDIS_PASSWORD && { password: e.REDIS_PASSWORD }),
      maxRetriesPerRequest: null as unknown as undefined,
    };

    this.queueEvents = new QueueEvents('blockchain', { connection });
    this.logger.log('BlockchainQueueService: QueueEvents initialised');
  }

  async onModuleDestroy() {
    await this.queueEvents?.close();
  }

  // ─── giveCreditScoreAndLimit ──────────────────────────────────────────────

  async enqueueSetUserRisk(
    borrower: string,
    score: number,
    limitUnits: bigint,
    validUntil?: number,
  ): Promise<SetUserRiskResult> {
    const payload: SetUserRiskPayload = {
      borrower,
      score,
      limitUnitsStr: limitUnits.toString(),
      ...(validUntil !== undefined && { validUntil }),
    };

    this.logger.log(
      `Enqueuing set-user-risk borrower=${borrower} score=${score} limit=${limitUnits.toString()}`,
    );

    const job = await this.queue.add(
      BLOCKCHAIN_JOB.SET_USER_RISK,
      payload,
      DEFAULT_JOB_OPTIONS,
    );

    return (await job.waitUntilFinished(
      this.queueEvents,
      WAIT_TIMEOUT_MS,
    )) as SetUserRiskResult;
  }

  // ─── createLoanOfferBackend ───────────────────────────────────────────────

  async enqueueSetLoanOffer(
    amountHuman: string,
    borrower: string,
    tenorDays: number,
    feeBps: number,
  ): Promise<SetLoanOfferResult> {
    const payload: SetLoanOfferPayload = {
      amountHuman,
      borrower,
      tenorDays,
      feeBps,
    };

    this.logger.log(
      `Enqueuing set-loan-offer borrower=${borrower} amount=${amountHuman} tenor=${tenorDays} feeBps=${feeBps}`,
    );

    const job = await this.queue.add(
      BLOCKCHAIN_JOB.SET_LOAN_OFFER,
      payload,
      DEFAULT_JOB_OPTIONS,
    );

    return (await job.waitUntilFinished(
      this.queueEvents,
      WAIT_TIMEOUT_MS,
    )) as SetLoanOfferResult;
  }

  // ─── setPremiumConfig ─────────────────────────────────────────────────────

  async enqueueSetPremiumConfig(
    borrower: string,
    lateRatePerSecWad: bigint,
  ): Promise<SetPremiumConfigResult> {
    const payload: SetPremiumConfigPayload = {
      borrower,
      lateRatePerSecWadStr: lateRatePerSecWad.toString(),
    };

    this.logger.log(
      `Enqueuing set-premium-config borrower=${borrower} rate=${lateRatePerSecWad.toString()}`,
    );

    const job = await this.queue.add(
      BLOCKCHAIN_JOB.SET_PREMIUM_CONFIG,
      payload,
      DEFAULT_JOB_OPTIONS,
    );

    return (await job.waitUntilFinished(
      this.queueEvents,
      WAIT_TIMEOUT_MS,
    )) as SetPremiumConfigResult;
  }
}
