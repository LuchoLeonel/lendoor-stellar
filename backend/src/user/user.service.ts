// src/user/user.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { User } from 'src/domain/entities/user.entity';
import { EarlyAccessService } from './early-access.service';
import { normalizeWallet } from 'src/common/normalize-wallet';
import { toIso2 } from 'src/common/iso-country.util';
import { UserQueryService } from './user-query.service';
import { UserOnboardingService } from './user-onboarding.service';
import { PhoneVerificationService } from './phone-verification.service';

type UserPlatform = 'lemon' | 'farcaster' | 'webapp';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
    private readonly earlyAccess: EarlyAccessService,
    private readonly userQuery: UserQueryService,
    private readonly userOnboarding: UserOnboardingService,
    private readonly phoneVerification: PhoneVerificationService,
  ) {}

  // ===================== Shared utilities =====================

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private normalizePlatform(p?: string | null): UserPlatform | null {
    return this.userQuery.normalizePlatform(p);
  }

  async isEarlyUser(
    user: User,
    platformOverride?: UserPlatform | null,
  ): Promise<boolean> {
    return this.earlyAccess.isEarlyUser(user, platformOverride);
  }

  async getUserUntilWaitlist(platform?: UserPlatform | null): Promise<number> {
    return this.userQuery.getUserUntilWaitlist(platform);
  }

  // ===================== Query =====================

  async getStepByWallet(walletAddress: string, platform?: string) {
    return this.userQuery.getStepByWallet(walletAddress, platform);
  }

  // ===================== Onboarding =====================

  async acceptTerms(walletAddress: string, platform?: string) {
    return this.userOnboarding.acceptTerms(walletAddress, platform);
  }

  async verifyEmail(walletAddress: string, email: string, platform?: string) {
    return this.userOnboarding.verifyEmail(walletAddress, email, platform);
  }

  async joinWaitlist(walletAddress: string, email: string, platform?: string) {
    return this.userOnboarding.joinWaitlist(walletAddress, email, platform);
  }

  async verifyOtp(
    walletAddress: string,
    code: string,
    workType: string,
    platform?: string,
  ) {
    return this.userOnboarding.verifyOtp(walletAddress, code, workType, platform);
  }

  async resendOtp(walletAddress: string, email?: string) {
    return this.userOnboarding.resendOtp(walletAddress, email);
  }

  // ===================== Phone verification =====================

  async verifyPhone(
    walletAddress: string,
    phone: string,
    channel: 'whatsapp' | 'sms' = 'whatsapp',
  ) {
    return this.phoneVerification.verifyPhone(walletAddress, phone, channel);
  }

  async verifyPhoneOtp(walletAddress: string, phone: string, code: string) {
    return this.phoneVerification.verifyPhoneOtp(walletAddress, phone, code);
  }

  async resendPhoneOtp(
    walletAddress: string,
    phone: string,
    channel: 'whatsapp' | 'sms' = 'whatsapp',
  ) {
    return this.phoneVerification.resendPhoneOtp(walletAddress, phone, channel);
  }

  async updatePhone(
    walletAddress: string,
    phone: string,
    channel: 'whatsapp' | 'sms' = 'whatsapp',
  ) {
    return this.phoneVerification.updatePhone(walletAddress, phone, channel);
  }

  async updateWorkType(walletAddress: string, workType: string) {
    const wallet = normalizeWallet(walletAddress);
    const user = await this.repo.findOne({ where: { walletAddress: wallet } });
    if (!user) throw new NotFoundException('User not found');
    await this.repo.update({ id: user.id }, { workType: workType.trim() });
    return { ok: true };
  }

  async getStrict(walletAddress: string) {
    const wallet = normalizeWallet(walletAddress);
    const user = await this.repo.findOne({ where: { walletAddress: wallet } });
    if (!user) throw new NotFoundException('User not found');
    return { walletAddress: user.walletAddress };
  }

  // ===================== Early access notifications =====================

  async findUsersToNotifyEarlyAccess(): Promise<User[]> {
    return this.earlyAccess.findUsersToNotifyEarlyAccess();
  }

  async markEarlyAccessNotified(userId: number) {
    return this.earlyAccess.markEarlyAccessNotified(userId);
  }

  // ===================== Spec 044 — Lemon profile =====================

  async upsertLemonProfile(payload: {
    walletAddress: string;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    lemonTag?: string | null;
    pep?: boolean | null;
    lemonCountry?: string | null;
  }): Promise<{ ok: true; updated: boolean; identityMatchScore: number | null }> {
    const wallet = normalizeWallet(payload.walletAddress);
    const user = await this.repo.findOne({ where: { walletAddress: wallet } });
    if (!user) throw new NotFoundException('User not found');

    const hadSelfFirst = !!user.firstName;
    const hadSelfLast = !!user.lastName;
    const hadSelfEmail = !!user.email;

    let updated = false;

    if (!user.firstName && payload.firstName) {
      user.firstName = payload.firstName.trim();
      updated = true;
    }
    if (!user.lastName && payload.lastName) {
      user.lastName = payload.lastName.trim();
      updated = true;
    }
    if (!user.email && payload.email) {
      user.email = payload.email.trim();
      updated = true;
    }

    if (payload.lemonTag !== undefined && payload.lemonTag !== null) {
      user.lemonTag = payload.lemonTag.trim();
      updated = true;
    }
    if (payload.pep !== undefined && payload.pep !== null) {
      user.pep = payload.pep;
      updated = true;
    }
    if (payload.lemonCountry !== undefined && payload.lemonCountry !== null) {
      const iso2 = toIso2(payload.lemonCountry);
      user.lemonCountry = iso2 ?? payload.lemonCountry.trim().toUpperCase();
      updated = true;
    }

    user.lemonAuthenticatedAt = new Date();

    if (payload.email) {
      user.lemonEmail = payload.email.trim();
      if (user.email) {
        const norm = (s: string) => s.trim().toLowerCase();
        user.emailMatchesLemon = norm(user.email) === norm(payload.email);
      }
      updated = true;
    }

    let identityMatchScore: number | null = null;
    if (hadSelfFirst || hadSelfLast || hadSelfEmail) {
      let score = 0;
      const norm = (s?: string | null) => (s ?? '').trim().toLowerCase();
      if (hadSelfFirst && payload.firstName && norm(user.firstName) === norm(payload.firstName)) {
        score += 40;
      }
      if (hadSelfLast && payload.lastName && norm(user.lastName) === norm(payload.lastName)) {
        score += 40;
      }
      if (hadSelfEmail && payload.email && norm(user.email) === norm(payload.email)) {
        score += 20;
      }
      identityMatchScore = score;
      user.identityMatchScore = score;
      user.identityCrossCheckedAt = new Date();
    }

    await this.repo.save(user);

    this.logger.log(
      `[upsertLemonProfile] wallet=${wallet} updated=${updated} ` +
        `lemonTag=${user.lemonTag ?? 'null'} pep=${user.pep ?? 'null'} ` +
        `country=${user.lemonCountry ?? 'null'} matchScore=${identityMatchScore ?? 'n/a'}`,
    );

    return { ok: true, updated, identityMatchScore };
  }
}
