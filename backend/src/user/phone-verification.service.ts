// src/user/phone-verification.service.ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { User } from 'src/domain/entities/user.entity';
import { PhoneOtpService } from './phone-otp.service';
import { normalizeWallet } from 'src/common/normalize-wallet';

@Injectable()
export class PhoneVerificationService {
  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
    private readonly phoneOtp: PhoneOtpService,
  ) {}

  /**
   * Ensures the phone number is not already associated with another wallet.
   * This query is efficient because the `idx_users_phone` partial index
   * covers non-null phone values only (see AddPhoneToUsers migration).
   */
  async ensurePhoneIsFreeForWallet(phone: string, wallet: string) {
    const existing = await this.repo.findOne({ where: { phone } });
    if (existing && existing.walletAddress !== wallet) {
      throw new ConflictException(
        'Este número ya está registrado con otra cuenta',
      );
    }
  }

  /** Throws if the user sent an OTP less than 60 seconds ago. */
  assertPhoneOtpThrottle(user: User) {
    if (
      user.lastPhoneOtpSentAt &&
      new Date().getTime() - user.lastPhoneOtpSentAt.getTime() < 60_000
    ) {
      throw new BadRequestException(
        'Esperá al menos 1 minuto antes de pedir otro código',
      );
    }
  }

  /**
   * Initiates phone verification: sends an OTP via WhatsApp or SMS.
   * Throttled to 1 request per minute per user.
   */
  async verifyPhone(
    walletAddress: string,
    phone: string,
    channel: 'whatsapp' | 'sms' = 'whatsapp',
  ) {
    const wallet = normalizeWallet(walletAddress);
    const user = await this.repo.findOne({ where: { walletAddress: wallet } });
    if (!user) throw new NotFoundException('User not found');

    await this.ensurePhoneIsFreeForWallet(phone, wallet);
    this.assertPhoneOtpThrottle(user);

    await this.phoneOtp.sendVerification(phone, channel, wallet);

    // Atomic update — repo.save(user) would overwrite the phoneOtpCode that
    // sendVerification just wrote, because the user entity in memory still has
    // the stale value from the findOne above.
    await this.repo.update({ id: user.id }, { lastPhoneOtpSentAt: new Date() });

    return { ok: true };
  }

  /**
   * Checks the OTP code submitted by the user. On success, saves
   * phone + phoneVerifiedAt on the User record.
   */
  async verifyPhoneOtp(walletAddress: string, phone: string, code: string) {
    const wallet = normalizeWallet(walletAddress);
    const user = await this.repo.findOne({ where: { walletAddress: wallet } });
    if (!user) throw new NotFoundException('User not found');

    await this.ensurePhoneIsFreeForWallet(phone, wallet);

    const approved = await this.phoneOtp.checkVerification(phone, code, wallet);
    if (!approved) {
      throw new BadRequestException('Código inválido o expirado');
    }

    try {
      await this.repo.update(
        { id: user.id },
        { phone, phoneVerifiedAt: new Date() },
      );
    } catch (err: unknown) {
      // Unique constraint on phone — another user verified the same number concurrently
      if ((err as { code?: string })?.code === '23505') {
        throw new ConflictException(
          'Este teléfono ya fue verificado por otro usuario',
        );
      }
      throw err;
    }

    return { ok: true };
  }

  /** Re-sends the OTP to the same phone number. Same throttle as verifyPhone. */
  async resendPhoneOtp(
    walletAddress: string,
    phone: string,
    channel: 'whatsapp' | 'sms' = 'whatsapp',
  ) {
    return this.verifyPhone(walletAddress, phone, channel);
  }

  /**
   * Starts a new verification flow for a new number. The old phone stays
   * active until verifyPhoneOtp succeeds with the new number.
   */
  async updatePhone(
    walletAddress: string,
    phone: string,
    channel: 'whatsapp' | 'sms' = 'whatsapp',
  ) {
    const wallet = normalizeWallet(walletAddress);
    const user = await this.repo.findOne({ where: { walletAddress: wallet } });
    if (!user) throw new NotFoundException('User not found');

    await this.ensurePhoneIsFreeForWallet(phone, wallet);
    this.assertPhoneOtpThrottle(user);

    await this.phoneOtp.sendVerification(phone, channel, wallet);

    await this.repo.update({ id: user.id }, { lastPhoneOtpSentAt: new Date() });

    return { ok: true };
  }
}
