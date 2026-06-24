// src/user/phone-otp.service.ts
//
// DEV placeholder for phone OTP. Instead of calling a real SMS/WhatsApp
// provider (Twilio Verify, etc.), it generates a code, stores it on the user,
// and LOGS it. Swap this for a real provider integration for production.
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { User } from 'src/domain/entities/user.entity';
import { normalizeWallet } from 'src/common/normalize-wallet';

@Injectable()
export class PhoneOtpService {
  private readonly logger = new Logger(PhoneOtpService.name);

  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
  ) {}

  /** Generates a 6-digit code, persists it on the user, and logs it (dev). */
  async sendVerification(
    phone: string,
    channel: 'whatsapp' | 'sms',
    walletAddress: string,
  ): Promise<void> {
    const wallet = normalizeWallet(walletAddress);
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await this.repo.update(
      { walletAddress: wallet },
      {
        phoneOtpCode: code,
        phoneOtpExpiresAt: new Date(Date.now() + 10 * 60_000),
      },
    );
    this.logger.warn(`[DEV] phone OTP for ${phone} via ${channel}: ${code}`);
  }

  /** Compares the submitted code against the stored one (dev). */
  async checkVerification(
    _phone: string,
    code: string,
    walletAddress: string,
  ): Promise<boolean> {
    const wallet = normalizeWallet(walletAddress);
    const user = await this.repo.findOne({ where: { walletAddress: wallet } });
    if (!user?.phoneOtpCode || !user.phoneOtpExpiresAt) return false;
    if (user.phoneOtpExpiresAt.getTime() < Date.now()) return false;
    const ok = user.phoneOtpCode === code;
    if (ok) {
      await this.repo.update(
        { walletAddress: wallet },
        { phoneOtpCode: null, phoneOtpExpiresAt: null },
      );
    }
    return ok;
  }
}
