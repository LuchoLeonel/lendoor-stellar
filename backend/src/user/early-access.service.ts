// src/user/early-access.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, IsNull } from 'typeorm';

import { User } from 'src/domain/entities/user.entity';
import { Loan } from 'src/domain/entities/loan.entity';

type UserPlatform = 'lemon' | 'farcaster' | 'webapp';

/** First 1000 Lemon users get the "Early user" badge regardless of waitlist config */
const EARLY_USER_BADGE_LIMIT = 1000;

@Injectable()
export class EarlyAccessService {
  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
    @InjectRepository(Loan) private readonly loanRepo: Repository<Loan>,
  ) {}

  private normalizePlatform(p?: string | null): UserPlatform | null {
    if (!p) return null;
    const v = p.trim().toLowerCase();
    if (v === 'lemon' || v === 'farcaster' || v === 'webapp') return v;
    return null;
  }

  private async getRankWithinPlatform(
    user: Pick<User, 'createdAt' | 'waitlistPriority'>,
    platform: UserPlatform,
  ): Promise<number> {
    return this.repo
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
  }

  /**
   * "Early user" badge — independent of waitlist access.
   * Only the first 1000 Lemon users get this badge.
   */
  async isEarlyUser(
    user: User,
    platformOverride?: UserPlatform | null,
  ): Promise<boolean> {
    if (!user?.createdAt) return false;

    const platformEff =
      platformOverride ?? this.normalizePlatform(user.platform) ?? 'lemon';

    // Only Lemon users can be "early users"
    if (platformEff !== 'lemon') return false;

    const rank = await this.getRankWithinPlatform(user, platformEff);
    return rank <= EARLY_USER_BADGE_LIMIT;
  }

  async findUsersToNotifyEarlyAccess(): Promise<User[]> {
    // Spec 011 Fix-2: only notify users whose admission decision is 'admit'.
    // Prevents the "email sent but app shows waitlist" pattern (spec 010 §6.1)
    // for users the model did not actually admit (reject, waitlist,
    // admit_restricted). These cohorts observed default rates of 33–60%
    // (spec 011 A15 §3) and should not receive the "access activated" email.
    // Filter at the query level so candidates never enter the notifier loop.
    const candidates = await this.repo.find({
      where: {
        email: Not(IsNull()),
        waitlistJoinedAt: Not(IsNull()),
        earlyAccessNotifiedAt: IsNull(),
        riskDecision: 'admit',
      },
      order: { createdAt: 'ASC' },
      take: 100,
    });

    const eligible: User[] = [];
    for (const user of candidates) {
      // Users with loans already have access — skip early access notifications
      const hasLoans = await this.loanRepo.count({ where: { userId: user.id } });
      if (hasLoans > 0) continue;

      if (await this.isEarlyUser(user)) {
        eligible.push(user);
      }
    }

    return eligible;
  }

  async markEarlyAccessNotified(userId: number) {
    await this.repo.update(
      { id: userId },
      { earlyAccessNotifiedAt: new Date() },
    );
  }
}
