// src/loan/loan-repayment.service.ts
import {
  Injectable,
  BadRequestException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Repository, In, IsNull } from 'typeorm';
import Decimal from 'decimal.js';

import { User } from 'src/domain/entities/user.entity';
import { Loan, LoanStatus } from 'src/domain/entities/loan.entity';
import { InformRepaymentDto } from './dto/inform-repayment.dto';
import { toUnits } from 'src/config/contractConfig';
import { BlockchainGatewayPort } from 'src/domain/ports/outbound/blockchain-gateway.port';
import { CreditPolicyService } from 'src/domain/services/credit-policy.service';
import { normalizeWallet } from 'src/common/normalize-wallet';
import { reputationScore } from '@shared/reputationScore';
import { getGroupLabelForScore } from '@shared/tierHelpers';
import type { ReputationGainPayload } from '@shared/types/api';

const DEFAULT_SCORE = 1;
const DEFAULT_CREDIT_LIMIT_USDC = toUnits(1, 6);
// Grace period: align with LoanManagerV3.defaultGracePeriod (= 1 days).
const REPAID_ON_TIME_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * Spec 024 A.3 — payload returned by `preflightRepayment(wallet)`.
 */
export interface PreflightPayload {
  wallet: string;
  principal: bigint;
  storedAmountDueBefore: bigint;
  accruedAmountDue: bigint;
  lastAccruedTs: number;
  ratePerSecWad: bigint;
  baseFeeBps: number;
  dueAt: number;
  gracePeriod: number;
  lateStart: number;
  serverNowUnix: number;
  chainNowUnix: number;
  perDayDelta: number;
  daysLate: number;
  daysToDefault: number;
  isDefaulted: boolean;
  accrueLateCalled: boolean;
  accrueLateSkippedReason: string | null;
}

@Injectable()
export class LoanRepaymentService {
  private readonly logger = new Logger(LoanRepaymentService.name);

  constructor(
    private readonly userRepo: Repository<User>,
    private readonly loanRepo: Repository<Loan>,
    private readonly creditPolicy: CreditPolicyService,
    private readonly blockchain: BlockchainGatewayPort,
  ) {}

  private toNum(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  private parseAmountHuman(amount: string): Decimal {
    const cleaned = amount.replace(/,/g, '').trim();
    if (!cleaned) {
      throw new BadRequestException('Amount is required');
    }

    let dec: Decimal;
    try {
      dec = new Decimal(cleaned);
    } catch {
      throw new BadRequestException('Invalid amount');
    }

    if (dec.lte(0)) {
      throw new BadRequestException('Amount must be greater than 0');
    }

    return dec;
  }

  private formatAmount(d: Decimal): string {
    return d.toFixed(2);
  }

  async preflightRepayment(
    walletAddress: string,
    opts: { force?: boolean } = {},
  ): Promise<PreflightPayload> {
    const wallet = normalizeWallet(walletAddress);
    const force = opts.force === true;

    const [loan, premium, previewLate, isDefaulted, nowChain] = await Promise.all([
      this.blockchain.readLoanFull(wallet),
      this.blockchain.readPremium(wallet),
      this.blockchain.previewLoanWithLate(wallet),
      this.blockchain.readIsDefaulted(wallet),
      this.blockchain.getChainBlockTimestamp(),
    ]);

    if (!loan) {
      throw new ServiceUnavailableException(
        'Could not read loan state from chain — RPC failure',
      );
    }
    if (!loan.active) {
      throw new NotFoundException(`No active loan for ${wallet}`);
    }
    if (nowChain == null) {
      throw new ServiceUnavailableException(
        'Could not read chain block timestamp',
      );
    }

    const dueAt = Number(loan.due);
    const gracePeriod = loan.gracePeriod;
    const lateStart = dueAt + gracePeriod;
    const isPastGrace = nowChain > lateStart;

    const ratePerSecWad = premium?.lateRatePerSecWad ?? 0n;

    let accrueLateCalled = false;
    let accrueLateSkippedReason: string | null = null;
    const storedAmountDueBefore = loan.amountDue;

    if (!force) {
      accrueLateSkippedReason = 'lazy_skip';
    } else if (!isPastGrace) {
      accrueLateSkippedReason = 'pre_grace';
    } else if (ratePerSecWad === 0n) {
      accrueLateSkippedReason = 'rate_zero';
    } else {
      try {
        await this.blockchain.accrueLate(wallet, 'high');
        accrueLateCalled = true;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.warn(
          `[Preflight] accrueLate failed for ${wallet} (force=true): ${msg}`,
        );
        throw new ServiceUnavailableException(`accrueLate failed: ${msg}`);
      }
    }

    const loanAfter = accrueLateCalled
      ? await this.blockchain.readLoanFull(wallet)
      : loan;
    const accruedAmountDue = loanAfter?.amountDue ?? loan.amountDue;

    let lastAccruedTs: number;
    if (accrueLateCalled) {
      lastAccruedTs = nowChain;
    } else if (
      ratePerSecWad === 0n ||
      previewLate == null ||
      accruedAmountDue === 0n ||
      !isPastGrace
    ) {
      lastAccruedTs = nowChain;
    } else {
      const delta = previewLate - accruedAmountDue;
      if (delta <= 0n) {
        lastAccruedTs = nowChain;
      } else {
        const tLateImpliedSec = Number(
          (delta * 10n ** 18n) / (ratePerSecWad * accruedAmountDue),
        );
        const derived = nowChain - tLateImpliedSec;
        lastAccruedTs = Math.max(derived, lateStart);
      }
    }

    const amtDueNum = Number(accruedAmountDue) / 1e6;
    const ratePerSecNum = Number(ratePerSecWad) / 1e18;
    const perDayDelta = isPastGrace ? amtDueNum * ratePerSecNum * 86400 : 0;

    const DEFAULT_LATE_PERIOD_SEC = 15 * 86400;
    const daysLate = isPastGrace ? (nowChain - lateStart) / 86400 : 0;
    const defaultEligibleAt = lateStart + DEFAULT_LATE_PERIOD_SEC;
    const daysToDefault = Math.max(0, (defaultEligibleAt - nowChain) / 86400);

    return {
      wallet,
      principal: loan.principal,
      storedAmountDueBefore,
      accruedAmountDue,
      lastAccruedTs,
      ratePerSecWad,
      baseFeeBps: loan.feeBps,
      dueAt,
      gracePeriod,
      lateStart,
      serverNowUnix: Math.floor(Date.now() / 1000),
      chainNowUnix: nowChain,
      perDayDelta,
      daysLate,
      daysToDefault,
      isDefaulted: isDefaulted ?? false,
      accrueLateCalled,
      accrueLateSkippedReason,
    };
  }

  async processRepayment(dto: InformRepaymentDto) {
    const wallet = normalizeWallet(dto.walletAddress);

    const user = await this.userRepo.findOne({
      where: { walletAddress: wallet },
    });

    if (!user) {
      this.logger.warn(
        `[LoanRepaymentService] informRepayment: user not found for wallet=${wallet}`,
      );
      throw new NotFoundException('User not found');
    }

    const initialScoreForRepGain = this.toNum(user.score) ?? DEFAULT_SCORE;

    let verifiedByTxHash = false;
    let chainPaidUnits: bigint | null = null;
    if (dto.txHash) {
      const r = await this.blockchain.verifyRepayByTxHash(dto.txHash, wallet);
      if (r.verified) {
        verifiedByTxHash = true;
        if (r.paidUnits !== undefined) chainPaidUnits = r.paidUnits;
        this.logger.log(
          `[LoanRepaymentService] informRepayment: verified via txHash=${dto.txHash} block=${r.blockNumber} chainPaidUnits=${chainPaidUnits} wallet=${wallet}`,
        );
      } else if (r.reason === 'reverted' || r.reason === 'no_match') {
        throw new BadRequestException(
          r.reason === 'reverted'
            ? 'Repay transaction reverted on-chain.'
            : 'txHash does not match a repay for this wallet.',
        );
      }
    }

    if (!verifiedByTxHash) {
      let loanStillActive: boolean;
      try {
        const onChainLoan = await this.blockchain.readLoanOnChain(wallet);
        loanStillActive = onChainLoan?.active ?? true;
      } catch {
        throw new ServiceUnavailableException(
          'Could not verify on-chain loan state. Please try again.',
        );
      }

      if (loanStillActive) {
        this.logger.warn(
          `[LoanRepaymentService] informRepayment: on-chain loan still ACTIVE for wallet=${wallet}.`,
        );
        throw new ServiceUnavailableException(
          'Your repayment transaction has not been confirmed on-chain yet. Please wait a moment and try again.',
        );
      }
    }

    let onChainDueUnits: bigint | null;
    try {
      onChainDueUnits = await this.blockchain.previewLoanWithLate(wallet);
    } catch {
      onChainDueUnits = 0n;
    }

    if (dto.txHash) {
      const existing = await this.loanRepo.findOne({
        where: { closeTxHash: dto.txHash },
        relations: ['user'],
      });
      if (existing) {
        this.logger.log(
          `[LoanRepaymentService] Spec 043 — informRepayment: txHash=${dto.txHash} ` +
            `already processed (loanId=${existing.id}, status=${existing.status}). Returning idempotent response.`,
        );
        return {
          loan: existing,
          repaidOnTime: existing.repaidOnTime,
          amountPaidNum: Number(existing.amountPaid ?? 0),
          isPostDefault: false,
        };
      }
    }

    const { loan, repaidOnTime, amountPaidNum, isPostDefault } =
      await this.loanRepo.manager.transaction(async (manager) => {
        const loan = await manager.findOne(Loan, {
          where: {
            userId: user.id,
            status: In([
              LoanStatus.OPEN,
              LoanStatus.DEFAULTED,
              LoanStatus.DEFAULTED_IN_GRACE,
            ]),
            closeTxHash: IsNull(),
          },
          order: { startAt: 'DESC' },
          lock: { mode: 'pessimistic_write' },
        });

        if (!loan) {
          this.logger.warn(
            `[LoanRepaymentService] informRepayment: no ACTIVE loan found for wallet=${wallet} userId=${user.id}`,
          );
          throw new NotFoundException('No active loan found to repay');
        }

        const amountPaidNumFromChain =
          chainPaidUnits !== null
            ? Number(
                new Decimal(chainPaidUnits.toString()).div(1_000_000).toFixed(6),
              )
            : null;
        const amountPaidDec = this.parseAmountHuman(dto.amountPaidHuman);
        const amountPaidNumFromDto = Number(this.formatAmount(amountPaidDec));
        const amountPaidNum =
          amountPaidNumFromChain !== null
            ? amountPaidNumFromChain
            : amountPaidNumFromDto;
        if (
          amountPaidNumFromChain !== null &&
          Math.abs(amountPaidNumFromChain - amountPaidNumFromDto) > 0.005
        ) {
          this.logger.warn(
            `[LoanRepaymentService] spec074: chain.paid=${amountPaidNumFromChain} differs from dto=${amountPaidNumFromDto} for wallet=${wallet} loanId=${loan.id} — using chain value`,
          );
        }

        const effectiveAmountDue =
          onChainDueUnits !== null &&
          typeof onChainDueUnits === 'bigint' &&
          onChainDueUnits > 0n
            ? Number(
                new Decimal(onChainDueUnits.toString()).div(1_000_000).toFixed(2),
              )
            : loan.amountDueAtOpen ?? amountPaidNum;

        this.logger.log(
          `[LoanRepaymentService] informRepayment: effectiveAmountDue=${effectiveAmountDue} for wallet=${wallet} (on-chain closed, verified)`,
        );

        const now = new Date();
        loan.amountPaid = amountPaidNum;
        loan.closedAt = now;

        const millisPastDue = now.getTime() - loan.dueAt.getTime();
        const repaidOnTime = millisPastDue <= REPAID_ON_TIME_GRACE_MS;
        const DEFAULT_LATE_PERIOD_MS =
          REPAID_ON_TIME_GRACE_MS + 15 * 24 * 60 * 60 * 1000;
        const isPostDefault = millisPastDue > DEFAULT_LATE_PERIOD_MS;

        loan.status = repaidOnTime
          ? LoanStatus.REPAID_ON_TIME
          : LoanStatus.REPAID_LATE;
        loan.repaidOnTime = repaidOnTime;
        loan.closeTxHash = dto.txHash ?? null;

        await manager.save(Loan, loan);

        if (isPostDefault && !user.hadDefaultEver) {
          user.hadDefaultEver = true;
          await manager.save(User, user);
        }

        return { loan, repaidOnTime, amountPaidNum, isPostDefault };
      });

    this.logger.log(
      `[LoanRepaymentService] informRepayment: loanId=${loan.id} wallet=${wallet} status=${loan.status} paid=${amountPaidNum} repaidOnTime=${repaidOnTime} isPostDefault=${isPostDefault}`,
    );

    // Score and limit logic
    let newScore = this.toNum(user.score) ?? DEFAULT_SCORE;
    let newLimitUnitsNum =
      this.toNum(user.creditLimit) ?? Number(DEFAULT_CREDIT_LIMIT_USDC);

    const onTimeLoanCount = await this.loanRepo.count({
      where: { userId: user.id, repaidOnTime: true },
    });

    if (repaidOnTime) {
      const ladderStep = this.creditPolicy.getStepForOnTimeLoans(onTimeLoanCount);
      newScore = ladderStep.score;

      const currentScore = this.toNum(user.score) ?? 1;
      if (newScore > currentScore + 1) {
        this.logger.warn(
          `[LoanRepaymentService] Score anomaly detected for wallet=${wallet}: ` +
            `current=${currentScore} computed=${newScore} onTimeLoans=${onTimeLoanCount}. ` +
            `Capping to ${currentScore + 1}.`,
        );
        newScore = currentScore + 1;
      }

      const ladderLimitUsdc = this.creditPolicy.getStepForScore(newScore).limitUsdc;
      const ladderLimitUnitsNum = Number(toUnits(ladderLimitUsdc, 6));
      newLimitUnitsNum = Math.max(newLimitUnitsNum, ladderLimitUnitsNum);

      const currentXp = user.xp ?? 1;
      if (ladderStep.xpBase > currentXp) {
        user.xp = ladderStep.xpBase;
      }

      this.logger.log(
        `[LoanRepaymentService] informRepayment: onTimeLoans=${onTimeLoanCount} -> score=${newScore} ladderLimitUsdc=${ladderLimitUsdc} (units=${newLimitUnitsNum}) xp=${user.xp}`,
      );

      try {
        const result = await this.blockchain.giveCreditScoreAndLimit(
          wallet,
          newScore,
          BigInt(newLimitUnitsNum),
          undefined,
          undefined,
          'high',
        );

        if (result === 200) {
          user.score = newScore;
          user.creditLimit = newLimitUnitsNum;
          await this.userRepo.save(user);
        } else {
          this.logger.error(
            `[LoanRepaymentService] giveCreditScoreAndLimit returned ${result} for ${wallet}. Loan closed, score NOT updated.`,
          );
        }
      } catch (e) {
        this.logger.error(
          `[LoanRepaymentService] giveCreditScoreAndLimit threw for ${wallet}. Loan closed, score NOT updated.`,
          e,
        );
      }
    } else if (isPostDefault) {
      const currentScore = this.toNum(user.score) ?? DEFAULT_SCORE;
      newScore = Math.max(1, currentScore - 2);
      const newLadderLimitUsdc = this.creditPolicy.getStepForScore(newScore).limitUsdc;
      newLimitUnitsNum = Number(toUnits(newLadderLimitUsdc, 6));

      this.logger.log(
        `[LoanRepaymentService] post-default penalty: wallet=${wallet} ` +
          `score ${currentScore}→${newScore} limit→$${newLadderLimitUsdc}`,
      );

      try {
        const result = await this.blockchain.giveCreditScoreAndLimit(
          wallet,
          newScore,
          BigInt(newLimitUnitsNum),
          undefined,
          undefined,
          'high',
        );
        if (result === 200) {
          user.score = newScore;
          user.creditLimit = newLimitUnitsNum;
          await this.userRepo.save(user);
        } else {
          this.logger.error(
            `[LoanRepaymentService] post-default giveCreditScoreAndLimit returned ${result} for ${wallet}`,
          );
        }
      } catch (e) {
        this.logger.error(
          `[LoanRepaymentService] post-default giveCreditScoreAndLimit threw for ${wallet}`,
          e,
        );
      }
    } else {
      const ladderLimitUsdc = this.creditPolicy.getStepForScore(newScore).limitUsdc;
      const ladderLimitUnitsNum = Number(toUnits(ladderLimitUsdc, 6));
      const renewLimitUnitsNum = Math.max(newLimitUnitsNum, ladderLimitUnitsNum);

      try {
        await this.blockchain.giveCreditScoreAndLimit(
          wallet,
          newScore,
          BigInt(renewLimitUnitsNum),
          undefined,
          undefined,
          'high',
        );
        this.logger.log(
          `[LoanRepaymentService] informRepayment: validUntil renewed for late payer ${wallet}`,
        );
      } catch (e) {
        this.logger.error(
          `[LoanRepaymentService] validUntil renewal failed for late payer ${wallet}`,
          e,
        );
      }
    }

    // Refresh user for final XP / score
    const freshUser = await this.userRepo.findOne({ where: { id: user.id } });

    const creditNum = this.toNum(freshUser?.creditLimit ?? user.creditLimit);
    const xp = freshUser?.xp ?? user.xp ?? 0;

    // Spec 023 — reputation-points celebration for on-time repayments.
    let reputationGain: ReputationGainPayload | null = null;
    if (repaidOnTime && onTimeLoanCount > 0) {
      const onTimeAfter = onTimeLoanCount;
      const onTimeBefore = Math.max(0, onTimeAfter - 1);
      const repAfter = reputationScore(onTimeAfter);
      const repBefore = reputationScore(onTimeBefore);
      const delta = Math.max(0, repAfter - repBefore);

      if (delta > 0) {
        const finalScore = this.toNum(freshUser?.score) ?? initialScoreForRepGain;
        const oldGroup = getGroupLabelForScore(initialScoreForRepGain);
        const newGroup = getGroupLabelForScore(finalScore);

        reputationGain = {
          delta,
          scoreChanged: finalScore !== initialScoreForRepGain,
          groupChanged: newGroup !== oldGroup,
          newGroupLabel: newGroup !== oldGroup ? newGroup : null,
          newScore: finalScore,
        };
      }
    }

    return {
      ok: true,
      walletAddress: wallet,
      loanId: loan.id,
      score: freshUser?.score ?? user.score,
      creditLimit: creditNum,
      xp,
      repaidOnTime,
      newAchievements: [],
      reputationGain,
    };
  }
}
