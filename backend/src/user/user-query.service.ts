// src/user/user-query.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { User } from 'src/domain/entities/user.entity';
import { NotVerifiedUser } from 'src/domain/entities/not-verified-user.entity';
import { Loan } from 'src/domain/entities/loan.entity';
import { normalizeWallet } from 'src/common/normalize-wallet';

type UserPlatform = 'lemon' | 'farcaster' | 'webapp';

/** First 1000 Lemon users get the "Early user" badge regardless of waitlist config */
const EARLY_USER_BADGE_LIMIT = 1000;

@Injectable()
export class UserQueryService {
  private readonly rankCache = new Map<
    string,
    { value: number; expiresAt: number }
  >();
  private readonly RANK_CACHE_TTL_MS = 60_000; // 1 minute

  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
    @InjectRepository(NotVerifiedUser)
    private readonly pendingRepo: Repository<NotVerifiedUser>,
    @InjectRepository(Loan)
    private readonly loanRepo: Repository<Loan>,
  ) {}

  normalizePlatform(p?: string | null): UserPlatform | null {
    if (!p) return null;
    const v = p.trim().toLowerCase();
    if (v === 'lemon' || v === 'farcaster' || v === 'webapp') return v;
    return null;
  }

  resolvePlatform(
    storedPlatform?: string | null,
    requestPlatform?: string | null,
  ): UserPlatform {
    const a = this.normalizePlatform(storedPlatform);
    const b = this.normalizePlatform(requestPlatform);
    return a ?? b ?? 'lemon';
  }

  // Waitlist module removed — no slot limit enforced in stellar base.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getUserUntilWaitlist(_platform?: UserPlatform | null): Promise<number> {
    return 0;
  }

  async getRankWithinPlatform(
    user: Pick<User, 'createdAt' | 'waitlistPriority'>,
    platform: UserPlatform,
  ): Promise<number> {
    const cacheKey = `${platform}:${user.waitlistPriority ?? 0}:${user.createdAt.getTime()}`;
    const cached = this.rankCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const rank = await this.repo
      .createQueryBuilder('u')
      .where(
        '(u.platform = :platform OR (u.platform IS NULL AND :platform = :defaultPlatform))',
        { platform, defaultPlatform: 'lemon' },
      )
      .andWhere(
        '(u."waitlistPriority" < :priority OR (u."waitlistPriority" = :priority AND u."createdAt" <= :createdAt))',
        {
          priority: user.waitlistPriority ?? 0,
          createdAt: user.createdAt,
        },
      )
      .getCount();

    this.rankCache.set(cacheKey, {
      value: rank,
      expiresAt: Date.now() + this.RANK_CACHE_TTL_MS,
    });

    // Prune old entries if cache grows too large
    if (this.rankCache.size > 500) {
      const now = Date.now();
      for (const [key, entry] of this.rankCache) {
        if (entry.expiresAt <= now) this.rankCache.delete(key);
      }
      // Hard cap: if still oversized after expiry cleanup, evict oldest entries
      if (this.rankCache.size > 500) {
        const excess = this.rankCache.size - 500;
        const keys = this.rankCache.keys();
        for (let i = 0; i < excess; i++) {
          const k = keys.next().value as string | undefined;
          if (k !== undefined) this.rankCache.delete(k);
        }
      }
    }

    return rank;
  }

  async getWaitlistPosition(
    user: User,
    platformOverride?: UserPlatform | null,
  ): Promise<number | null> {
    if (!user.waitlistJoinedAt) return null;

    const platformEff =
      platformOverride ?? this.normalizePlatform(user.platform) ?? 'lemon';

    const limit = await this.getUserUntilWaitlist(platformEff);
    if (!limit || limit <= 0) return null;

    const rank = await this.getRankWithinPlatform(user, platformEff);

    if (rank <= limit) return null;

    return rank - limit;
  }

  /**
   * Devuelve el estado del usuario.
   *
   * Reglas:
   * - NO crea usuarios en `users`. Eso solo pasa en verifyOtp.
   * - Si hay `User`, usamos ese.
   * - Si no hay `User` pero sí `NotVerifiedUser`, devolvemos el estado "pending"
   * - Si no hay nada → always early (no waitlist in stellar base).
   */
  async getStepByWallet(walletAddress: string, platform?: string) {
    const wallet = normalizeWallet(walletAddress);

    // platform pedida (si no viene, default lemon)
    const requestPlatformEff = this.resolvePlatform(null, platform);

    // No waitlist limit in stellar base
    const requestWaitlistLimit = 0;
    const shouldGoToWaitlistRequest = false;

    // 1) Usuario real ya creado en `users`
    const user = await this.repo.findOne({ where: { walletAddress: wallet } });

    if (user) {
      // platform efectiva SIEMPRE (si user.platform es null, cae a la request, sino lemon)
      const platformEff = this.resolvePlatform(user.platform, platform);

      const waitlistLimit = 0; // no waitlist in stellar base

      const isVerified = this.allRequiredPresent(user);

      // Access control: no waitlist limit → everyone is "early"
      const rankInPlatform = await this.getRankWithinPlatform(
        user,
        platformEff,
      );
      const early = true; // no limit enforced

      // Badge: uses EARLY_USER_BADGE_LIMIT (hardcoded, first 1000 Lemon users)
      const earlyBadge =
        platformEff === 'lemon' && rankInPlatform <= EARLY_USER_BADGE_LIMIT;

      interface LoanMetricsRow {
        loansTotal: number;
        closedLoansTotal: number;
        loansOnTime: number;
        openLoansCount: number;
      }
      const loanMetricsPromise: Promise<LoanMetricsRow[]> = this.loanRepo.query(
        `SELECT
             COUNT(*)::int AS "loansTotal",
             COUNT(*) FILTER (WHERE "closedAt" IS NOT NULL)::int AS "closedLoansTotal",
             COUNT(*) FILTER (WHERE "closedAt" IS NOT NULL AND "repaidOnTime" = true)::int AS "loansOnTime",
             COUNT(*) FILTER (WHERE "closeTxHash" IS NULL AND status IN ('open','defaulted','defaulted_in_grace'))::int AS "openLoansCount"
           FROM loans WHERE "userId" = $1`,
        [user.id],
      );
      const [loanMetricsRows] = await Promise.all([
        loanMetricsPromise,
      ]);
      const achievementsCount = 0;
      const metrics = loanMetricsRows[0];
      const loansTotal = metrics.loansTotal;
      const closedLoansTotal = metrics.closedLoansTotal;
      const loansOnTime = metrics.loansOnTime;
      const openLoansCount = metrics.openLoansCount;

      const hasLoanHistory = loansTotal > 0;
      const isInWaitlist = false; // no waitlist in stellar base

      const waitlistPosition = null; // no waitlist in stellar base

      // pending (OTP)
      const pending = await this.pendingRepo.findOne({
        where: { walletAddress: wallet },
      });

      const requiresEmailOtp = !!pending;
      const otpExpiresAt = pending?.otpExpiresAt ?? null;

      // Suppress unused variable warning
      void earlyBadge;
      void hasLoanHistory;
      void requestPlatformEff;
      void shouldGoToWaitlistRequest;

      return {
        walletAddress: user.walletAddress,
        userId: user.id,
        isVerified,
        creditLimit: user.creditLimit ?? null,
        email: user.email ?? null,
        xp: user.xp ?? 1,
        achievementsCount,
        score: user.score ?? null,

        workType: user.workType ?? null,
        termsAccepted: !!user.termsAcceptedAt,
        phoneVerified: !!user.phoneVerifiedAt,
        phoneMasked: user.phone
          ? (() => {
              const p = user.phone;
              const prefix = p.match(/^\+\d{1,3}/)?.[0] || '';
              const rest = p.slice(prefix.length);
              return (
                prefix +
                ' ' +
                rest.slice(0, -4).replace(/\d/g, '•') +
                rest.slice(-4)
              );
            })()
          : null,
        pendingPhoneOtp: !!(
          user.phoneOtpCode &&
          user.phoneOtpExpiresAt &&
          user.phoneOtpExpiresAt > new Date()
        ),

        waitlistLimit,
        isEarlyUser: early,
        isInWaitlist,
        waitlistPosition,
        waitlistPriority: user.waitlistPriority ?? 0,
        needsEmailForWaitlist: false,
        goToWaitlist: false,

        hasPendingWaitlist: false,
        requiresWaitlistOtp: requiresEmailOtp,
        otpExpiresAt,

        loansTotal,
        closedLoansTotal,
        loansOnTime,
        openLoansCount,
      };
    }

    const pending = await this.pendingRepo.findOne({
      where: { walletAddress: wallet },
    });

    if (pending) {
      const hasPendingWaitlist = !!pending.waitlistJoinedAt;

      return {
        walletAddress: pending.walletAddress,
        userId: null,
        isVerified: false,
        creditLimit: null,
        email: pending.email ?? null,
        xp: 1,
        achievementsCount: 0,
        score: null,

        termsAccepted: !!pending.termsAcceptedAt,
        phoneVerified: false,

        waitlistLimit: 0,
        isEarlyUser: true,
        isInWaitlist: false,
        waitlistPosition: null,
        waitlistPriority: 0,
        needsEmailForWaitlist: false,
        goToWaitlist: false,

        hasPendingWaitlist,
        requiresWaitlistOtp: true,
        otpExpiresAt: pending.otpExpiresAt ?? null,

        loansTotal: 0,
        closedLoansTotal: 0,
        loansOnTime: 0,
      };
    }

    // No user, no pending — always early in stellar base (no waitlist)
    return {
      walletAddress: wallet,
      userId: null,
      isVerified: false,
      creditLimit: null,
      email: null,
      xp: 1,
      achievementsCount: 0,
      score: null,

      termsAccepted: false,
      phoneVerified: false,

      waitlistLimit: requestWaitlistLimit,
      isEarlyUser: true,
      isInWaitlist: false,
      waitlistPosition: null,
      waitlistPriority: 0,
      needsEmailForWaitlist: false,
      goToWaitlist: false,

      hasPendingWaitlist: false,
      requiresWaitlistOtp: false,
      otpExpiresAt: null,

      loansTotal: 0,
      closedLoansTotal: 0,
      loansOnTime: 0,
    };
  }

  private allRequiredPresent(u: Partial<User>): boolean {
    const req = [u.creditLimit, u.score];
    return req.every((v) => !!(v && String(v).toString().trim().length > 0));
  }
}
