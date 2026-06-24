// src/loan/loan.service.ts
import {
  Injectable,
  BadRequestException,
  Logger,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, In } from 'typeorm';
import Decimal from 'decimal.js';
import { Interface } from 'ethers';
import { provider, CLM_ADDRESS } from 'src/config/contractConfig';

import { User } from 'src/domain/entities/user.entity';
import { Loan, LoanStatus } from 'src/domain/entities/loan.entity';
import { VerifyUserDto } from './dto/verify-user.dto';
import { BorrowLoanDto } from './dto/borrow-loan.dto';
import { InformLoanDto } from './dto/inform-loan.dto';
import { InformRepaymentDto } from './dto/inform-repayment.dto';

import {
  BLOCKCHAIN_GATEWAY,
  BlockchainGatewayPort,
} from 'src/domain/ports/outbound/blockchain-gateway.port';
import {
  LATE_RATE_PER_SEC_WAD,
  CreditPolicyService,
  WalletQuality,
} from 'src/domain/services/credit-policy.service';
import { UserService } from 'src/user/user.service';
import { SelfService } from 'src/self/self.service';
import { normalizeWallet } from 'src/common/normalize-wallet';

import { LoanVerificationService } from './loan-verification.service';
import { LoanRepaymentService } from './loan-repayment.service';
import LoanManagerAbi from '../abi/LoanManagerV3.abi.json';

// Config global para Decimal
Decimal.set({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
});

const LOAN_MANAGER_IFACE = new Interface(LoanManagerAbi);
const LOAN_OPENED_TOPIC = LOAN_MANAGER_IFACE.getEvent('LoanOpened')!.topicHash;

type UserPlatform = 'lemon' | 'farcaster' | 'webapp';

@Injectable()
export class LoanService {
  private readonly logger = new Logger(LoanService.name);

  private readonly verificationService: LoanVerificationService;
  private readonly repaymentService: LoanRepaymentService;

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Loan)
    private readonly loanRepo: Repository<Loan>,
    private readonly userService: UserService,
    private readonly creditPolicy: CreditPolicyService,
    private readonly selfService: SelfService,
    @Inject(BLOCKCHAIN_GATEWAY)
    private readonly blockchain: BlockchainGatewayPort,
  ) {
    this.verificationService = new LoanVerificationService(
      userRepo,
      userService,
      creditPolicy,
      selfService,
      blockchain,
    );

    this.repaymentService = new LoanRepaymentService(
      userRepo,
      loanRepo,
      creditPolicy,
      blockchain,
    );
  }

  // ------------------ Shared helpers ------------------ //

  private normalizePlatform(p?: string | null): UserPlatform | null {
    if (!p) return null;
    const v = p.trim().toLowerCase();
    if (v === 'lemon' || v === 'farcaster' || v === 'webapp') return v;
    return null;
  }

  /** Convierte cualquier cosa a number o null. */
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

  private toNumber2(d: Decimal): number {
    return Number(d.toFixed(2));
  }

  private toBps(d: Decimal): number {
    return Number(d.mul(10000).toFixed(0));
  }

  // ===================== VERIFY ===================== //

  async submitAndVerify(dto: VerifyUserDto) {
    return this.verificationService.verify(dto);
  }

  // ===================== Loan terms ===================== //

  private async getTieredPricingContext(userId: number): Promise<{
    onTimeLoans: number;
    walletQuality: WalletQuality;
    totalRepaidUsd: number;
    lateLoans: number;
  }> {
    const [onTimeLoans, rawLateLoans, totalRepaidResult, userRow] =
      await Promise.all([
        this.loanRepo.count({ where: { userId, repaidOnTime: true } }),
        this.loanRepo.count({
          where: { userId, status: LoanStatus.REPAID_LATE },
        }),
        this.loanRepo
          .createQueryBuilder('loan')
          .select('COALESCE(SUM(loan.amountPaid), 0)', 'total')
          .where('loan.userId = :userId', { userId })
          .andWhere('loan.amountPaid IS NOT NULL')
          .getRawOne<{ total: string }>(),
        this.userRepo.findOne({
          where: { id: userId },
          select: ['hadDefaultEver', 'walletQuality'],
        }),
      ]);

    const totalRepaidUsd = Number(totalRepaidResult?.total ?? 0);
    const hadDefaultEver = userRow?.hadDefaultEver === true;
    const lateLoans = hadDefaultEver ? rawLateLoans : 0;

    const walletQuality = (userRow?.walletQuality as WalletQuality) ?? 'fea';

    return {
      onTimeLoans,
      walletQuality,
      totalRepaidUsd,
      lateLoans,
    };
  }

  private getRatesForTerm(
    days: number,
    score: number | null,
    pDefault: number | null = null,
    tieredParams?: {
      onTimeLoans: number;
      walletQuality: WalletQuality;
      totalRepaidUsd: number;
      lateLoans: number;
    },
  ) {
    if (!Number.isFinite(days) || days <= 0) {
      throw new BadRequestException('Invalid tenorDays');
    }

    const d = new Decimal(days);
    const DAYS_IN_MONTH = new Decimal(30);
    const BASE_TERM_DAYS = new Decimal(14);
    const VARIATION_FACTOR = new Decimal(0.4);

    let baseMonthlyRate: Decimal;
    let tierName: string | null = null;

    if (tieredParams) {
      const result = this.creditPolicy.getTieredMonthlyRate(
        pDefault,
        tieredParams.onTimeLoans,
        tieredParams.walletQuality,
        tieredParams.totalRepaidUsd,
        tieredParams.lateLoans,
      );
      baseMonthlyRate = new Decimal(result.monthlyRate);
      tierName = result.tier;
    } else {
      baseMonthlyRate = this.creditPolicy.getRiskAdjustedMonthlyRate(
        score,
        pDefault,
      );
    }

    const relative = d.minus(BASE_TERM_DAYS).div(BASE_TERM_DAYS);
    const monthlyRateForTerm = baseMonthlyRate.mul(
      new Decimal(1).plus(relative.mul(VARIATION_FACTOR)),
    );
    const monthlyRate = Decimal.max(monthlyRateForTerm, new Decimal(0));
    const periodRate = monthlyRate.mul(d).div(DAYS_IN_MONTH);

    return { monthlyRate, periodRate, tierName };
  }

  public getFeeBpsForTerm(
    days: number,
    score: number | null,
    pDefault: number | null = null,
    tieredParams?: {
      onTimeLoans: number;
      walletQuality: WalletQuality;
      totalRepaidUsd: number;
      lateLoans: number;
    },
  ): number {
    const { periodRate } = this.getRatesForTerm(days, score, pDefault, tieredParams);
    return this.toBps(periodRate);
  }

  async getLoanTerms(walletAddress: string, amountHuman: string) {
    const wallet = normalizeWallet(walletAddress);

    const user = await this.userRepo.findOne({
      where: { walletAddress: wallet },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const score = user.score ?? null;
    const pDefault = this.toNum(user.riskPDefault);
    const principal = this.parseAmountHuman(amountHuman);
    const TERM_OPTIONS = [7, 14, 21];

    const tieredCtx = await this.getTieredPricingContext(user.id);
    tieredCtx.walletQuality = (user.walletQuality as WalletQuality) ?? 'fea';

    const tieredResult = this.creditPolicy.getTieredMonthlyRate(
      pDefault,
      tieredCtx.onTimeLoans,
      tieredCtx.walletQuality,
      tieredCtx.totalRepaidUsd,
      tieredCtx.lateLoans,
    );
    const isPreferentialRate = tieredResult.monthlyRate < 0.28;
    const adjustedLimitUsdc = this.creditPolicy.getStepForScore(score ?? 1).limitUsdc;

    const terms = TERM_OPTIONS.map((days) => {
      const { monthlyRate, periodRate } = this.getRatesForTerm(
        days,
        score,
        pDefault,
        tieredCtx,
      );

      const periodRatePercent = periodRate.mul(100);
      const monthlyRatePercent = monthlyRate.mul(100);
      const interest = principal.mul(periodRate);
      const total = principal.plus(interest);
      const feeBps = this.toBps(periodRate);

      return {
        days,
        periodRatePercent: this.toNumber2(periodRatePercent),
        monthlyRatePercent: this.toNumber2(monthlyRatePercent),
        baseMonthlyRatePercent: 28,
        feeBps,
        principalAmount: this.formatAmount(principal),
        interestAmount: this.formatAmount(interest),
        finalAmount: this.formatAmount(total),
        tier: tieredResult.tier,
      };
    });

    return {
      walletAddress: wallet,
      score,
      baseAmount: this.formatAmount(principal),
      terms,
      isPreferentialRate,
      adjustedLimitUsdc,
      pricingTier: tieredResult.tier,
    };
  }

  // ===================== BORROW ===================== //

  async borrow(dto: BorrowLoanDto) {
    const { amountHuman, receiver, tenorDays } = dto;

    if (!amountHuman || !receiver || tenorDays == null) {
      throw new BadRequestException(
        'Missing amountHuman, receiver or tenorDays',
      );
    }

    const borrower = normalizeWallet(receiver);
    const tenor = Number(tenorDays);

    if (!Number.isFinite(tenor) || tenor <= 0) {
      throw new BadRequestException('Invalid tenorDays');
    }

    if (![7, 14, 21].includes(tenor)) {
      throw new BadRequestException(
        `Invalid tenorDays: ${tenor}. Allowed values: 7, 14, 21`,
      );
    }

    const user = await this.userRepo.findOne({
      where: { walletAddress: borrower },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.phone || !user.phoneVerifiedAt) {
      throw new BadRequestException({
        code: 'PHONE_VERIFICATION_REQUIRED',
        message: 'Phone verification required before requesting loan',
      });
    }

    const scoreNum = this.toNum(user.score);
    const pDefaultNum = this.toNum(user.riskPDefault);

    const ladderLimitUsdc = this.creditPolicy.getStepForScore(scoreNum ?? 1).limitUsdc;

    let effectiveLimitUsdc = ladderLimitUsdc;
    try {
      const onChainLimitUnits = await this.blockchain.readCreditLimitOnChain(borrower);
      const onChainLimitUsdc = Number(onChainLimitUnits) / 1_000_000;
      if (onChainLimitUsdc > 0 && onChainLimitUsdc < ladderLimitUsdc) {
        this.logger.warn(
          `[LoanService] borrow: on-chain limit (${onChainLimitUsdc}) < ladder limit (${ladderLimitUsdc}) for wallet=${borrower}. Using on-chain.`,
        );
        effectiveLimitUsdc = onChainLimitUsdc;
      }
    } catch (e) {
      this.logger.warn(
        `[LoanService] borrow: readCreditLimitOnChain failed for ${borrower}, using ladder limit ${ladderLimitUsdc}`,
      );
    }

    const requestedDec = this.parseAmountHuman(amountHuman);
    if (requestedDec.gt(new Decimal(effectiveLimitUsdc))) {
      throw new BadRequestException(
        `Amount exceeds your credit limit of $${effectiveLimitUsdc}`,
      );
    }

    const tieredCtx = await this.getTieredPricingContext(user.id);
    tieredCtx.walletQuality = (user.walletQuality as WalletQuality) ?? 'fea';

    const feeBps = this.getFeeBpsForTerm(tenor, scoreNum, pDefaultNum, tieredCtx);

    this.logger.log(
      `[LoanService] borrow: wallet=${borrower} amount=${amountHuman} tenorDays=${tenor} feeBps=${feeBps} score=${scoreNum ?? 'null'} tier=${this.creditPolicy.getTieredMonthlyRate(pDefaultNum, tieredCtx.onTimeLoans, tieredCtx.walletQuality, tieredCtx.totalRepaidUsd, tieredCtx.lateLoans).tier}`,
    );

    try {
      const offer = await this.blockchain.createLoanOfferBackend(
        amountHuman,
        borrower,
        tenor,
        feeBps,
        'high',
      );

      void this.blockchain
        .setPremiumConfig(borrower, LATE_RATE_PER_SEC_WAD, 'high')
        .catch((e: unknown) => {
          const errMsg = e instanceof Error ? e.message : String(e);
          this.logger.error(
            `setPremiumConfig failed for ${borrower}: ${errMsg}`,
          );
        });

      return offer;
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      this.logger.error(
        `createLoanOfferBackend failed for ${borrower}: ${errMsg}`,
      );
      throw new BadRequestException('Creating loan offer failed');
    }
  }

  // ===================== INFORMAR APERTURA ===================== //

  async informLoanOpened(dto: InformLoanDto) {
    const wallet = normalizeWallet(dto.walletAddress);

    const user = await this.userRepo.findOne({
      where: { walletAddress: wallet },
    });

    if (!user) {
      this.logger.warn(
        `[LoanService] informLoanOpened: user not found for wallet=${wallet}`,
      );
      throw new NotFoundException('User not found');
    }

    const tenor = Number(dto.tenorDays);
    if (!Number.isFinite(tenor) || tenor <= 0) {
      throw new BadRequestException('Invalid tenorDays');
    }

    if (![7, 14, 21].includes(tenor)) {
      throw new BadRequestException(
        `Invalid tenorDays: ${tenor}. Allowed values: 7, 14, 21`,
      );
    }

    const existing = await this.loanRepo.findOne({
      where: { openTxHash: dto.txHash },
    });
    if (existing) {
      this.logger.log(
        `[LoanService] informLoanOpened: duplicate txHash=${dto.txHash}, returning existing loanId=${existing.id}`,
      );
      return { ok: true, loanId: existing.id };
    }

    await this.assertLoanOpenedTxValid(dto.txHash, wallet);

    const principalDec = this.parseAmountHuman(dto.amountHuman);
    const principalNum = Number(this.formatAmount(principalDec));
    const scoreNum = this.toNum(user.score);
    const pDefaultNum = this.toNum(user.riskPDefault);

    const tieredCtx = await this.getTieredPricingContext(user.id);
    tieredCtx.walletQuality = (user.walletQuality as WalletQuality) ?? 'fea';

    const feeBps = this.getFeeBpsForTerm(tenor, scoreNum, pDefaultNum, tieredCtx);
    const feeDec = principalDec.mul(feeBps).div(10000);
    const totalDec = principalDec.plus(feeDec);
    const amountDueAtOpenNum = Number(this.formatAmount(totalDec));

    const loan = await this.loanRepo.manager.transaction(async (manager) => {
      const existingOpen = await manager.findOne(Loan, {
        where: { userId: user.id, status: LoanStatus.OPEN, closedAt: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });
      if (existingOpen) {
        this.logger.log(
          `[LoanService] informLoanOpened: OPEN loan already exists for userId=${user.id}, returning loanId=${existingOpen.id}`,
        );
        return existingOpen;
      }

      const existingByTx = await manager.findOne(Loan, {
        where: { openTxHash: dto.txHash },
      });
      if (existingByTx) {
        this.logger.log(
          `[LoanService] informLoanOpened: loan with openTxHash=${dto.txHash} already exists (loanId=${existingByTx.id}), returning it`,
        );
        return existingByTx;
      }

      const orphanedDefaulted = await manager.find(Loan, {
        where: {
          userId: user.id,
          status: In([LoanStatus.DEFAULTED, LoanStatus.DEFAULTED_IN_GRACE]),
          closedAt: IsNull(),
          closeTxHash: IsNull(),
        },
        lock: { mode: 'pessimistic_write' },
      });

      if (orphanedDefaulted.length > 0) {
        const now = new Date();
        for (const orphan of orphanedDefaulted) {
          orphan.status = LoanStatus.REPAID_LATE;
          orphan.repaidOnTime = false;
          orphan.closedAt = now;
          orphan.closeTxHash = `SYNTHETIC_ORPHAN_AUTOCLOSE_${orphan.id}`;
        }
        await manager.save(Loan, orphanedDefaulted);

        this.logger.warn(
          `[LoanService] informLoanOpened: auto-closed ${orphanedDefaulted.length} orphaned DEFAULTED loan(s) ` +
            `for wallet=${wallet} (ids=${orphanedDefaulted.map((l) => l.id).join(',')}) as REPAID_LATE`,
        );
      }

      const startAt = new Date();
      const dueAt = new Date(startAt.getTime() + tenor * 24 * 60 * 60 * 1000);

      const newLoan = manager.create(Loan, {
        userId: user.id,
        borrowerAddress: wallet,
        principal: principalNum,
        amountDueAtOpen: amountDueAtOpenNum,
        amountPaid: 0,
        tenorDays: tenor,
        feeBps,
        startAt,
        dueAt,
        status: LoanStatus.OPEN,
        repaidOnTime: false,
        openTxHash: dto.txHash,
      });

      try {
        return await manager.save(Loan, newLoan);
      } catch (err: unknown) {
        const pgErr = err as { code?: string };
        if (pgErr.code === '23505') {
          this.logger.warn(
            `[LoanService] informLoanOpened: unique constraint hit for openTxHash=${dto.txHash}, fetching existing`,
          );
          const existing = await manager.findOne(Loan, {
            where: { openTxHash: dto.txHash },
          });
          if (existing) return existing;
        }
        throw err;
      }
    });

    this.logger.log(
      `[LoanService] informLoanOpened: loanId=${loan.id} wallet=${wallet} principal=${principalNum} tenor=${tenor} feeBps=${feeBps}`,
    );

    return { ok: true, loanId: loan.id };
  }

  private async assertLoanOpenedTxValid(
    txHash: string,
    wallet: string,
  ): Promise<void> {
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) {
      throw new BadRequestException('txHash not found on chain');
    }
    if (receipt.status !== 1) {
      throw new BadRequestException('txHash transaction reverted');
    }

    const walletLower = wallet.toLowerCase();
    const clmLower = CLM_ADDRESS.toLowerCase();

    const matched = receipt.logs.some((log) => {
      if (log.address.toLowerCase() !== clmLower) return false;
      if (log.topics[0] !== LOAN_OPENED_TOPIC) return false;
      const userFromTopic = '0x' + log.topics[1].slice(-40).toLowerCase();
      return userFromTopic === walletLower;
    });

    if (!matched) {
      throw new BadRequestException(
        'txHash is not a LoanOpened event for this wallet',
      );
    }
  }

  // ===================== INFORM REPAYMENT ===================== //

  async informRepayment(dto: InformRepaymentDto) {
    return this.repaymentService.processRepayment(dto);
  }

  // ===================== REPAY PREFLIGHT ===================== //

  async preflightRepayment(
    walletAddress: string,
    opts: { force?: boolean } = {},
  ) {
    return this.repaymentService.preflightRepayment(walletAddress, opts);
  }
}
