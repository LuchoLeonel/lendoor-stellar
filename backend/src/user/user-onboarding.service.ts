// src/user/user-onboarding.service.ts
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { randomInt } from 'crypto';
import * as nodemailer from 'nodemailer';

import { User } from 'src/domain/entities/user.entity';
import { NotVerifiedUser } from 'src/domain/entities/not-verified-user.entity';
import { normalizeWallet } from 'src/common/normalize-wallet';
import { hashOtp } from 'src/common/otp-hash';
import { EarlyAccessService } from './early-access.service';
import { UserQueryService } from './user-query.service';

type UserPlatform = 'lemon' | 'farcaster' | 'webapp';

/** Mask email PII for logs: "johnsmith@gmail.com" -> "joh***@gmail.com" */
function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  return `${email.slice(0, 3)}***@${email.slice(at + 1)}`;
}

// Lazy ZeptoMail (Zoho) transport — mirrors the live Lendoor backend
// (smtp.zeptomail.com:465, SSL). Built once from env on first use.
let cachedMailer: nodemailer.Transporter | null = null;
function getOtpMailer(): nodemailer.Transporter | null {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_APP_PASS;
  if (!user || !pass) return null;
  if (!cachedMailer) {
    cachedMailer = nodemailer.createTransport({
      host: 'smtp.zeptomail.com',
      port: 465,
      secure: true,
      pool: true,
      maxConnections: 2,
      maxMessages: 50,
      auth: { user, pass },
    });
  }
  return cachedMailer;
}

@Injectable()
export class UserOnboardingService {
  private readonly logger = new Logger(UserOnboardingService.name);

  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
    @InjectRepository(NotVerifiedUser)
    private readonly pendingRepo: Repository<NotVerifiedUser>,
    private readonly dataSource: DataSource,
    private readonly earlyAccess: EarlyAccessService,
    private readonly userQuery: UserQueryService,
  ) {}

  // ===================== Helpers =====================

  /**
   * Spec 011 — after a user row is created, link analytics rows that carried
   * the same walletAddress but couldn't set userId because the user didn't
   * exist yet. Idempotent (WHERE "userId" IS NULL), safe (wallet->user is 1:1).
   * Runs outside the user-creation transaction: the commit already happened
   * and linkage failures must not roll that back.
   */
  private async linkAnalyticsForNewUser(
    userId: number,
    walletAddress: string,
  ): Promise<void> {
    const wallet = normalizeWallet(walletAddress);
    const walletLower = wallet.toLowerCase();

    const sessionUpdate = await this.dataSource
      .createQueryBuilder()
      .update('device_sessions')
      .set({ userId })
      .where(
        '"userId" IS NULL AND ("walletAddress" = :wallet OR LOWER("walletAddress") = :walletLower)',
        { wallet, walletLower },
      )
      .execute();

    const attemptUpdate = await this.dataSource
      .createQueryBuilder()
      .update('borrow_attempts')
      .set({ userId })
      .where(
        '"userId" IS NULL AND ("walletAddress" = :wallet OR LOWER("walletAddress") = :walletLower)',
        { wallet, walletLower },
      )
      .execute();

    const sessionRows = sessionUpdate.affected ?? 0;
    const attemptRows = attemptUpdate.affected ?? 0;

    if (sessionRows > 0 || attemptRows > 0) {
      this.logger.log(
        `[linkAnalyticsForNewUser] user=${userId} wallet=${wallet.slice(0, 10)}… ` +
          `sessions_linked=${sessionRows} borrow_attempts_linked=${attemptRows}`,
      );
    }
  }

  /** Asegura que el email no esté usado por OTRA wallet en `users`. */
  async ensureEmailIsFreeForWallet(normalizedEmail: string, wallet: string) {
    if (!normalizedEmail) {
      throw new BadRequestException('Email is required');
    }

    const existingUser = await this.repo.findOne({
      where: { email: normalizedEmail },
    });

    if (existingUser && existingUser.walletAddress !== wallet) {
      throw new BadRequestException('Email already used by another account');
    }
  }

  private async issueOtpForPending(pending: NotVerifiedUser) {
    if (!pending.email) {
      throw new BadRequestException('User has no email');
    }

    const now = new Date();

    // Throttle: no más de 1 por minuto
    if (
      pending.lastOtpSentAt &&
      now.getTime() - pending.lastOtpSentAt.getTime() < 60_000
    ) {
      throw new BadRequestException(
        'Esperá unos segundos antes de pedir otro código',
      );
    }

    const code = String(randomInt(100000, 1000000)); // 6 dígitos
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000); // 10 minutos

    pending.otpCode = hashOtp(code);
    pending.otpExpiresAt = expiresAt;
    pending.otpAttemptCount = 0;
    pending.lastOtpSentAt = now;

    await this.pendingRepo.save(pending);

    // Send the OTP by email (ZeptoMail, same provider as the live Lendoor).
    const mailer = getOtpMailer();
    const from = process.env.SMTP_SENDER;
    if (mailer && from) {
      try {
        await mailer.sendMail({
          from,
          to: pending.email,
          subject: 'Tu código de Lendoor',
          text: `Tu código de verificación de Lendoor es ${code}. Vence en 10 minutos.`,
          html:
            `<div style="font-family:system-ui,sans-serif;max-width:420px">` +
            `<p>Tu código de verificación de Lendoor es:</p>` +
            `<p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:12px 0">${code}</p>` +
            `<p style="color:#666">Vence en 10 minutos. Si no fuiste vos, ignorá este mail.</p>` +
            `</div>`,
        });
        this.logger.log(`OTP email sent to ${maskEmail(pending.email)}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `OTP email send FAILED to ${maskEmail(pending.email)}: ${msg}`,
        );
      }
    } else if (process.env.NODE_ENV !== 'production') {
      // Dev fallback when SMTP isn't configured.
      this.logger.log(`[DEV] OTP for ${pending.email}: ${code}`);
    }
  }

  // ===================== Onboarding methods =====================

  async acceptTerms(walletAddress: string, platform?: string) {
    const wallet = normalizeWallet(walletAddress);
    const platformNorm = this.userQuery.normalizePlatform(platform);
    const now = new Date();

    // 1) Si ya hay User → marcamos TyC ahí
    const user = await this.repo.findOne({ where: { walletAddress: wallet } });

    if (user) {
      const updates: Partial<typeof user> = {};
      if (!user.termsAcceptedAt) {
        updates.termsAcceptedAt = now;
      }
      if (!user.platform && platformNorm) {
        updates.platform = platformNorm;
      }
      await this.repo.update({ id: user.id }, updates);
      return this.userQuery.getStepByWallet(wallet);
    }

    // 2) Si no hay User, revisamos not_verified_users
    let pending = await this.pendingRepo.findOne({
      where: { walletAddress: wallet },
    });

    if (!pending) {
      // 3) No había pending → lo creamos solo para guardar TyC
      pending = this.pendingRepo.create({
        walletAddress: wallet,
        platform: platformNorm ?? null,
        termsAcceptedAt: now,
      });
    } else {
      if (!pending.termsAcceptedAt) {
        pending.termsAcceptedAt = now;
      }
      if (!pending.platform && platformNorm) {
        pending.platform = platformNorm;
      }
    }

    await this.pendingRepo.save(pending);
    return this.userQuery.getStepByWallet(wallet);
  }

  /**
   * verify-email:
   * - registra / actualiza el email del usuario
   * - crea/actualiza un NotVerifiedUser para manejar OTP
   * - NO lo mete en la waitlist (no toca waitlistJoinedAt)
   * - también marca platform si viene del front
   */
  async verifyEmail(walletAddress: string, email: string, platform?: string) {
    const wallet = normalizeWallet(walletAddress);
    const normalizedEmail = email.trim().toLowerCase();
    const platformNorm = this.userQuery.normalizePlatform(platform);

    await this.ensureEmailIsFreeForWallet(normalizedEmail, wallet);

    const user = await this.repo.findOne({ where: { walletAddress: wallet } });

    if (user) {
      const updates: Partial<typeof user> = { email: normalizedEmail };
      if (!user.platform && platformNorm) {
        updates.platform = platformNorm;
      }
      await this.repo.update({ id: user.id }, updates);
    }

    let pending = await this.pendingRepo.findOne({
      where: { walletAddress: wallet },
    });

    if (!pending) {
      pending = this.pendingRepo.create({
        walletAddress: wallet,
        email: normalizedEmail,
        platform: platformNorm ?? null,
      });
    } else {
      pending.email = normalizedEmail;
      if (!pending.platform && platformNorm) {
        pending.platform = platformNorm;
      }
    }

    await this.pendingRepo.save(pending);

    await this.issueOtpForPending(pending);

    return this.userQuery.getStepByWallet(wallet);
  }

  /** Join waitlist: crea/actualiza not_verified_users y manda OTP SIEMPRE. */
  async joinWaitlist(walletAddress: string, email: string, platform?: string) {
    const wallet = normalizeWallet(walletAddress);
    const normalizedEmail = email.trim().toLowerCase();
    const platformNorm = this.userQuery.normalizePlatform(platform);

    await this.ensureEmailIsFreeForWallet(normalizedEmail, wallet);

    const user = await this.repo.findOne({ where: { walletAddress: wallet } });
    let waitlistJoinedAt: Date | null = null;

    if (user) {
      const early = await this.earlyAccess.isEarlyUser(user);

      const updates: Partial<typeof user> = { email: normalizedEmail };
      if (!early && !user.waitlistJoinedAt) {
        updates.waitlistJoinedAt = new Date();
      }
      if (!user.platform && platformNorm) {
        updates.platform = platformNorm;
      }

      await this.repo.update({ id: user.id }, updates);
      waitlistJoinedAt =
        updates.waitlistJoinedAt ?? user.waitlistJoinedAt ?? null;
    }

    let pending = await this.pendingRepo.findOne({
      where: { walletAddress: wallet },
    });

    if (!pending) {
      pending = this.pendingRepo.create({
        walletAddress: wallet,
        email: normalizedEmail,
        waitlistJoinedAt: waitlistJoinedAt ?? new Date(),
        platform: platformNorm ?? null,
      });
    } else {
      pending.email = normalizedEmail;
      if (!pending.waitlistJoinedAt) {
        pending.waitlistJoinedAt = waitlistJoinedAt ?? new Date();
      }
      if (!pending.platform && platformNorm) {
        pending.platform = platformNorm;
      }
    }

    await this.pendingRepo.save(pending);

    await this.issueOtpForPending(pending);
    return this.userQuery.getStepByWallet(wallet);
  }

  async verifyOtp(
    walletAddress: string,
    code: string,
    workType: string,
    platform?: string,
  ) {
    const wallet = normalizeWallet(walletAddress);
    const trimmedCode = (code ?? '').trim();
    const workTypeClean = (workType ?? '').trim();

    if (!trimmedCode) {
      throw new BadRequestException('Code is required');
    }

    if (!workTypeClean) {
      throw new BadRequestException('workType is required');
    }

    // plataforma de la request (viene del front)
    const requestPlatformNorm = this.userQuery.normalizePlatform(platform);

    const pending = await this.pendingRepo.findOne({
      where: { walletAddress: wallet },
    });

    // Caso raro: no hay pending (o pending sin email), pero el User existe.
    if (!pending || !pending.email) {
      const existingUser = await this.repo.findOne({
        where: { walletAddress: wallet },
      });

      if (existingUser) {
        const updates: Partial<User> = { workType: workTypeClean };
        if (!existingUser.platform && requestPlatformNorm) {
          updates.platform = requestPlatformNorm;
        }
        await this.repo.update({ id: existingUser.id }, updates);

        const effectivePlatform =
          this.userQuery.normalizePlatform(existingUser.platform) ??
          requestPlatformNorm;

        return this.userQuery.getStepByWallet(
          wallet,
          effectivePlatform ?? undefined,
        );
      }

      throw new BadRequestException('Invalid user');
    }

    // =========================
    // Validaciones OTP
    // =========================
    if (!pending.otpCode || !pending.otpExpiresAt) {
      throw new BadRequestException('No active code, request a new one');
    }

    const now = new Date();

    if (pending.otpExpiresAt < now) {
      throw new BadRequestException('Code expired');
    }

    if (pending.otpAttemptCount >= 5) {
      throw new BadRequestException(
        'Too many failed attempts, request a new code',
      );
    }

    if (pending.otpCode !== hashOtp(trimmedCode)) {
      pending.otpAttemptCount += 1;
      await this.pendingRepo.save(pending);
      throw new BadRequestException('Invalid code');
    }

    const normalizedEmail = pending.email.trim().toLowerCase();
    await this.ensureEmailIsFreeForWallet(normalizedEmail, wallet);

    // plataforma efectiva: pending.platform si existe, sino la de la request
    const pendingPlatformNorm = this.userQuery.normalizePlatform(
      pending.platform,
    );
    const platformNorm: UserPlatform | null =
      pendingPlatformNorm ?? requestPlatformNorm;

    // =========================
    // Si ya existía User → sincronizamos
    // =========================
    const existingUser = await this.repo.findOne({
      where: { walletAddress: wallet },
    });

    if (existingUser) {
      const updates: Partial<User> = {
        email: normalizedEmail,
        workType: workTypeClean,
      };
      if (!existingUser.platform && platformNorm) {
        updates.platform = platformNorm;
      }
      if (pending.termsAcceptedAt && !existingUser.termsAcceptedAt) {
        updates.termsAcceptedAt = pending.termsAcceptedAt;
      }

      const qrExisting = this.dataSource.createQueryRunner();
      await qrExisting.connect();
      await qrExisting.startTransaction();
      try {
        await qrExisting.manager.update(User, { id: existingUser.id }, updates);
        await qrExisting.manager.delete(NotVerifiedUser, { id: pending.id });
        await qrExisting.commitTransaction();
      } catch (err) {
        await qrExisting.rollbackTransaction();
        throw err;
      } finally {
        await qrExisting.release();
      }

      const effectivePlatform =
        this.userQuery.normalizePlatform(existingUser.platform) ?? platformNorm;

      return this.userQuery.getStepByWallet(
        wallet,
        effectivePlatform ?? undefined,
      );
    }

    // =========================
    // Si NO existía User → lo creamos
    // =========================
    const waitlistLimit =
      await this.userQuery.getUserUntilWaitlist(platformNorm);

    const whereCount: Record<string, string> = {};
    if (platformNorm) {
      whereCount.platform = platformNorm;
    }

    const currentUsersInPlatform = await this.repo.count({ where: whereCount });
    const newIndex = currentUsersInPlatform + 1;
    const isEarly = waitlistLimit > 0 && newIndex <= waitlistLimit;

    const newUser = this.repo.create({
      walletAddress: pending.walletAddress,
      email: normalizedEmail,
      waitlistJoinedAt: isEarly
        ? null
        : (pending.waitlistJoinedAt ?? new Date()),
      platform: platformNorm ?? null,
      workType: workTypeClean,
      termsAcceptedAt: pending.termsAcceptedAt ?? null,
      waitlistPriority: 0,
    });

    const qrNew = this.dataSource.createQueryRunner();
    await qrNew.connect();
    await qrNew.startTransaction();
    try {
      await qrNew.manager.save(User, newUser);
      await qrNew.manager.delete(NotVerifiedUser, { id: pending.id });
      await qrNew.commitTransaction();
    } catch (err) {
      await qrNew.rollbackTransaction();
      throw err;
    } finally {
      await qrNew.release();
    }

    // Spec 011 — link analytics rows that existed BEFORE this user signed up.
    await this.linkAnalyticsForNewUser(newUser.id, newUser.walletAddress).catch(
      (err) =>
        this.logger.warn(
          `linkAnalyticsForNewUser failed for user=${newUser.id}: ${
            (err as Error)?.message ?? err
          }`,
        ),
    );

    return this.userQuery.getStepByWallet(wallet, platformNorm ?? undefined);
  }

  async resendOtp(walletAddress: string, email?: string) {
    const wallet = normalizeWallet(walletAddress);
    const normalizedEmail = email?.trim().toLowerCase() || null;

    // Si ya hay User → el mail ya está verificado, no dejamos tocar nada acá
    const existingUser = await this.repo.findOne({
      where: { walletAddress: wallet },
    });
    if (existingUser) {
      return this.userQuery.getStepByWallet(wallet);
    }

    let pending = await this.pendingRepo.findOne({
      where: { walletAddress: wallet },
    });

    // Caso 1: viene un mail nuevo y el usuario todavía no está verificado
    if (normalizedEmail) {
      await this.ensureEmailIsFreeForWallet(normalizedEmail, wallet);

      if (!pending) {
        pending = this.pendingRepo.create({
          walletAddress: wallet,
          email: normalizedEmail,
        });
      } else {
        pending.email = normalizedEmail;
      }

      await this.pendingRepo.save(pending);
    }

    // Caso 2: no vino mail nuevo → reusamos el que ya estaba guardado
    if (!pending || !pending.email) {
      throw new BadRequestException('Invalid user');
    }

    await this.issueOtpForPending(pending);

    return {
      walletAddress: pending.walletAddress,
      otpExpiresAt: pending.otpExpiresAt ?? null,
    };
  }
}
