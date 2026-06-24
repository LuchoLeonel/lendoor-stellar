// src/infrastructure/queue/blockchain.processor.ts
//
// Processes blockchain write jobs with concurrency: 1, which provides a
// second serialization layer on top of the module-level txQueue in
// contractConfig.ts. This is the BullMQ equivalent of the promise-chain:
// each job waits for the previous one to finish before starting, so no two
// transactions race for the same nonce even across concurrent HTTP requests.
//
// sendContractTx is NOT exported from contractConfig, so we call the public
// API functions directly (giveCreditScoreAndLimit, createLoanOfferBackend,
// setPremiumConfig). Those are the only three write paths in the system.

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';

import {
  giveCreditScoreAndLimit,
  createLoanOfferBackend,
  setPremiumConfig,
} from 'src/config/contractConfig';

// ─── Job name constants (shared with BlockchainQueueService) ─────────────────

export const BLOCKCHAIN_JOB = {
  SET_USER_RISK: 'set-user-risk',
  SET_LOAN_OFFER: 'set-loan-offer',
  SET_PREMIUM_CONFIG: 'set-premium-config',
} as const;

export type BlockchainJobName =
  (typeof BLOCKCHAIN_JOB)[keyof typeof BLOCKCHAIN_JOB];

// ─── Per-job payload shapes ───────────────────────────────────────────────────

export interface SetUserRiskPayload {
  borrower: string;
  score: number;
  /** credit limit in USDC base units (6 decimals), serialised as string */
  limitUnitsStr: string;
  /** optional: unix timestamp; defaults to +30 days if omitted */
  validUntil?: number;
}

export interface SetLoanOfferPayload {
  amountHuman: string;
  borrower: string;
  tenorDays: number;
  feeBps: number;
}

export interface SetPremiumConfigPayload {
  borrower: string;
  /** WAD per second rate, serialised as string because bigint is not JSON-safe */
  lateRatePerSecWadStr: string;
}

export type BlockchainJobData =
  | SetUserRiskPayload
  | SetLoanOfferPayload
  | SetPremiumConfigPayload;

// ─── Result shapes ────────────────────────────────────────────────────────────

export interface SetUserRiskResult {
  ok: true;
}

export interface SetLoanOfferResult {
  ok: true;
  feeBps: number;
  tenorDays: number;
  maxAmountBase: string;
  minedBlock: number;
}

export interface SetPremiumConfigResult {
  ok: true;
}

export type BlockchainJobResult =
  | SetUserRiskResult
  | SetLoanOfferResult
  | SetPremiumConfigResult;

// ─── Processor ───────────────────────────────────────────────────────────────

@Processor('blockchain', { concurrency: 1 })
export class BlockchainProcessor extends WorkerHost {
  private readonly logger = new Logger(BlockchainProcessor.name);

  async process(
    job: Job<BlockchainJobData, BlockchainJobResult, BlockchainJobName>,
  ): Promise<BlockchainJobResult> {
    this.logger.log(`Processing blockchain job id=${job.id} name=${job.name}`);

    switch (job.name) {
      case BLOCKCHAIN_JOB.SET_USER_RISK: {
        const data = job.data as SetUserRiskPayload;
        await giveCreditScoreAndLimit(
          data.borrower,
          data.score,
          BigInt(data.limitUnitsStr),
          true,
          data.validUntil,
        );
        this.logger.log(
          `[blockchain] set-user-risk done for borrower=${data.borrower}`,
        );
        return { ok: true };
      }

      case BLOCKCHAIN_JOB.SET_LOAN_OFFER: {
        const data = job.data as SetLoanOfferPayload;
        const result = await createLoanOfferBackend(
          data.amountHuman,
          data.borrower,
          data.tenorDays,
          data.feeBps,
        );
        this.logger.log(
          `[blockchain] set-loan-offer done for borrower=${data.borrower} block=${result.minedBlock}`,
        );
        return {
          ok: true,
          feeBps: result.feeBps,
          tenorDays: result.tenorDays,
          maxAmountBase: result.maxAmountBase,
          minedBlock: result.minedBlock,
        };
      }

      case BLOCKCHAIN_JOB.SET_PREMIUM_CONFIG: {
        const data = job.data as SetPremiumConfigPayload;
        await setPremiumConfig(
          data.borrower,
          BigInt(data.lateRatePerSecWadStr),
        );
        this.logger.log(
          `[blockchain] set-premium-config done for borrower=${data.borrower}`,
        );
        return { ok: true };
      }

      default: {
        // TypeScript exhaustiveness guard; BullMQ workers must not throw on
        // unknown jobs (they would retry forever), so we log and return.
        const exhaustive: never = job.name;
        this.logger.warn(`Unknown blockchain job name: ${String(exhaustive)}`);
        return { ok: true } as BlockchainJobResult;
      }
    }
  }
}
