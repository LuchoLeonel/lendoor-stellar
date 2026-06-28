// src/loan/loan-verification.service.ts
import {
  Injectable,
  BadRequestException,
  Logger,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import { User } from 'src/domain/entities/user.entity';
import { VerifyUserDto } from './dto/verify-user.dto';
import { toUnits } from 'src/common/amount-units';
import { BlockchainGatewayPort } from 'src/domain/ports/outbound/blockchain-gateway.port';
import { CreditPolicyService } from 'src/domain/services/credit-policy.service';
import { UserService } from 'src/user/user.service';
import { SelfService } from 'src/self/self.service';
import { normalizeWallet } from 'src/common/normalize-wallet';

// On-chain defaults (1 score, 1 USDC)
const DEFAULT_SCORE = 1;
const DEFAULT_CREDIT_LIMIT_USDC = toUnits(1, 6);

type UserPlatform = 'lemon' | 'farcaster' | 'webapp';

@Injectable()
export class LoanVerificationService {
  private readonly logger = new Logger(LoanVerificationService.name);

  constructor(
    private readonly userRepo: Repository<User>,
    private readonly userService: UserService,
    private readonly creditPolicy: CreditPolicyService,
    private readonly selfService: SelfService,
    private readonly blockchain: BlockchainGatewayPort,
  ) {}

  private normalizePlatform(p?: string | null): UserPlatform | null {
    if (!p) return null;
    const v = p.trim().toLowerCase();
    if (v === 'lemon' || v === 'farcaster' || v === 'webapp') return v;
    return null;
  }

  private toNum(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  async verify(dto: VerifyUserDto) {
    const wallet = normalizeWallet(dto.walletAddress);
    const platformNorm = this.normalizePlatform(dto.platform);

    const user = await this.userRepo.findOne({
      where: { walletAddress: wallet },
    });

    if (!user) {
      throw new NotFoundException(
        'User not found. Completá el registro y verificación antes de pedir crédito.',
      );
    }

    if (!user.email) {
      throw new ForbiddenException(
        'Necesitás verificar tu email antes de habilitar tu línea de crédito.',
      );
    }

    if (!user.workType) {
      throw new ForbiddenException(
        'Contanos en qué trabajás antes de habilitar tu línea de crédito.',
      );
    }

    // Set platform if not yet assigned
    if (!user.platform && platformNorm) {
      user.platform = platformNorm;
      await this.userRepo.update({ id: user.id }, { platform: platformNorm });
    }

    const effectivePlatform =
      this.normalizePlatform(user.platform) ?? platformNorm ?? 'lemon';

    if (!user.termsAcceptedAt && effectivePlatform !== 'farcaster') {
      throw new ForbiddenException(
        'Tenés que aceptar los Términos y Condiciones antes de habilitar tu crédito.',
      );
    }

    await this.selfService.ensureSelfVerificationForPlatform(user);

    // Re-check platform in case it still wasn't set
    if (!user.platform && platformNorm) {
      user.platform = platformNorm;
      await this.userRepo.update({ id: user.id }, { platform: platformNorm });
    }

    // Check early access quota only when a waitlist limit is configured.
    // Stellar base has no waitlist, so journey and verify must both allow access.
    const waitlistLimit =
      await this.userService.getUserUntilWaitlist(effectivePlatform);
    const canAccessCredit =
      !waitlistLimit ||
      waitlistLimit <= 0 ||
      (await this.userService.isEarlyUser(user, effectivePlatform));

    if (!canAccessCredit) {
      this.logger.warn(
        `[LoanVerificationService] Wallet ${wallet} (id=${user.id}) fuera del cupo early, no se asigna crédito.`,
      );
      throw new ForbiddenException('Early access cupo completo');
    }

    // Check existing score + limit
    const creditNum = this.toNum(user.creditLimit);
    const scoreNum = this.toNum(user.score);

    const alreadyHasCredit =
      creditNum !== null &&
      creditNum > 0 &&
      scoreNum !== null &&
      scoreNum >= DEFAULT_SCORE;

    if (alreadyHasCredit) {
      const onChainLimit = await this.blockchain.readCreditLimitOnChain(wallet);

      if (onChainLimit > 0n) {
        this.logger.log(
          `[LoanVerificationService] Wallet ${wallet} ya tiene score=${scoreNum} y limit=${creditNum}, on-chain OK, skip`,
        );

        return {
          verified: true,
          alreadyHadCredit: true,
          user: {
            id: user.id,
            walletAddress: user.walletAddress,
            score: scoreNum,
            creditLimit: creditNum,
          },
        };
      }

      // On-chain expired → refresh using risk-adjusted limit
      this.logger.warn(
        `[LoanVerificationService] Wallet ${wallet} on-chain creditLimit=0 (expired), refreshing with risk-adjusted values score=${scoreNum} limit=${creditNum}`,
      );

      const ladderLimitUsdc = this.creditPolicy.getStepForScore(
        scoreNum ?? 1,
      ).limitUsdc;
      const adjustedLimitUnits = toUnits(ladderLimitUsdc, 6);

      try {
        await this.blockchain.giveCreditScoreAndLimit(
          wallet,
          scoreNum,
          adjustedLimitUnits,
        );
      } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : String(e);
        this.logger.error(
          `[LoanVerificationService] Failed to refresh on-chain credit for ${wallet}: ${errMsg}`,
        );
        throw new BadRequestException('Failed to refresh on-chain credit line');
      }

      return {
        verified: true,
        alreadyHadCredit: true,
        refreshedOnChain: true,
        user: {
          id: user.id,
          walletAddress: user.walletAddress,
          score: scoreNum,
          creditLimit: creditNum,
        },
      };
    }

    // First-time credit setup
    const result = await this.blockchain.giveCreditScoreAndLimit(
      wallet,
      DEFAULT_SCORE,
      DEFAULT_CREDIT_LIMIT_USDC,
    );

    if (result !== 200) {
      this.logger.error(
        `[LoanVerificationService] Setting on-chain credit line failed for ${wallet}`,
      );
      throw new BadRequestException('Setting credit line failed');
    }

    user.score = DEFAULT_SCORE;
    user.creditLimit = Number(DEFAULT_CREDIT_LIMIT_USDC);
    await this.userRepo.update(
      { id: user.id },
      { score: DEFAULT_SCORE, creditLimit: user.creditLimit },
    );

    const fresh = await this.userRepo.findOne({
      where: { walletAddress: wallet },
    });

    if (!fresh) {
      this.logger.error(
        '[LoanVerificationService] Contract verification failed (user not found after save)',
      );
      throw new BadRequestException('Identity verification failed');
    }

    const freshCredit = this.toNum(fresh.creditLimit);
    const freshScore = this.toNum(fresh.score);

    return {
      verified: true,
      user: {
        id: fresh.id,
        walletAddress: fresh.walletAddress,
        score: freshScore,
        creditLimit: freshCredit,
      },
    };
  }
}
