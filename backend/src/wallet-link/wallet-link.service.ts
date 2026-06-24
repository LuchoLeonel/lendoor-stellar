// src/wallet-link/wallet-link.service.ts
// Spec 084 — companion "firmá desde la computadora". Email-OTP → token opaco
// (linkSession) → nonce → verify firma ECDSA → linked_wallets.
import {
  Injectable,
  Logger,
  BadRequestException,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomBytes, randomInt } from 'crypto';
import { recoverMessageAddress } from 'viem';

import { User } from 'src/domain/entities/user.entity';
import { LinkedExternalWallet } from 'src/domain/entities/linked-external-wallet.entity';
import { WalletLinkSession } from 'src/domain/entities/wallet-link-session.entity';
import { WalletLinkNonce } from 'src/domain/entities/wallet-link-nonce.entity';
import { hashOtp } from 'src/common/otp-hash';

const OTP_TTL_MS = 10 * 60 * 1000; // 10 min
const OTP_THROTTLE_MS = 60 * 1000; // 1/min
const OTP_MAX_ATTEMPTS = 5;
const SESSION_TTL_MS = 15 * 60 * 1000; // 15 min
const NONCE_TTL_MS = 5 * 60 * 1000; // 5 min
const SIGN_DOMAIN = 'link.lendoor.xyz';

@Injectable()
export class WalletLinkService {
  private readonly logger = new Logger(WalletLinkService.name);

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(LinkedExternalWallet)
    private readonly linkedRepo: Repository<LinkedExternalWallet>,
    @InjectRepository(WalletLinkSession)
    private readonly sessionRepo: Repository<WalletLinkSession>,
    @InjectRepository(WalletLinkNonce)
    private readonly nonceRepo: Repository<WalletLinkNonce>,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  // 1) START — email → OTP. Siempre 200 (anti-enumeration); OTP solo si el
  //    email es un user real.
  // ─────────────────────────────────────────────────────────────────────────
  async start(emailRaw: string): Promise<{ ok: true; otpExpiresAt?: string }> {
    const email = (emailRaw ?? '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new BadRequestException('Invalid email');
    }
    const matches = await this.userRepo.find({
      where: [{ email }, { lemonEmail: email }],
    });
    if (matches.length !== 1) {
      this.logger.warn(
        `wallet-link/start: email matchea ${matches.length} users (silencioso) ${email}`,
      );
      return { ok: true };
    }
    const user = matches[0];

    let session = await this.sessionRepo.findOne({ where: { email } });
    const now = new Date();

    // Throttle por email (1/min).
    if (
      session?.lastOtpSentAt &&
      now.getTime() - session.lastOtpSentAt.getTime() < OTP_THROTTLE_MS
    ) {
      throw new BadRequestException(
        'Esperá unos segundos antes de pedir otro código',
      );
    }

    const code = String(randomInt(100000, 1000000)); // 6 dígitos
    const otpExpiresAt = new Date(now.getTime() + OTP_TTL_MS);

    if (!session) {
      session = this.sessionRepo.create({ email });
    }
    session.userId = user.id;
    session.otpCodeHash = hashOtp(code);
    session.otpExpiresAt = otpExpiresAt;
    session.otpAttemptCount = 0;
    session.lastOtpSentAt = now;
    // invalida cualquier token previo al re-loguear
    session.token = null;
    session.tokenExpiresAt = null;
    await this.sessionRepo.save(session);

    // In stellar base there is no email provider — log OTP for dev use only.
    if (process.env.NODE_ENV !== 'production') {
      this.logger.log(`[DEV] wallet-link OTP para ${email}: ${code}`);
    }

    return { ok: true, otpExpiresAt: otpExpiresAt.toISOString() };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 2) SESSION — email + code → linkSession (token opaco).
  // ─────────────────────────────────────────────────────────────────────────
  async session(
    emailRaw: string,
    code: string,
  ): Promise<{ linkSession: string; userId: number; email: string; lendoorAddress: string | null }> {
    const email = (emailRaw ?? '').trim().toLowerCase();
    const trimmedCode = (code ?? '').trim();
    const session = await this.sessionRepo.findOne({ where: { email } });

    // Mensaje genérico para no filtrar si el email existe.
    const fail = () => new UnauthorizedException('Invalid or expired code');

    if (!session || !session.otpCodeHash || !session.otpExpiresAt || session.userId == null) {
      throw fail();
    }
    const now = new Date();
    if (session.otpExpiresAt < now) throw fail();
    if (session.otpAttemptCount >= OTP_MAX_ATTEMPTS) {
      throw new UnauthorizedException('Too many attempts, request a new code');
    }
    if (session.otpCodeHash !== hashOtp(trimmedCode)) {
      session.otpAttemptCount += 1;
      await this.sessionRepo.save(session);
      throw fail();
    }

    // OK → emitir token opaco (NO JWT). Consume el OTP.
    const token = randomBytes(24).toString('hex');
    session.token = token;
    session.tokenExpiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    session.otpCodeHash = null;
    session.otpExpiresAt = null;
    session.otpAttemptCount = 0;
    await this.sessionRepo.save(session);

    // Wallet del user (smart wallet de Lemon = "Cuenta Lendoor") para mostrarla
    // ya conectada en el companion.
    const user = await this.userRepo.findOne({ where: { id: session.userId } });
    return {
      linkSession: token,
      userId: session.userId,
      email,
      lendoorAddress: user?.walletAddress ?? null,
    };
  }

  /** Valida el linkSession (Bearer). Lo usa WalletLinkScopeGuard. */
  async validateLinkSession(token: string): Promise<{ userId: number }> {
    const session = await this.sessionRepo.findOne({ where: { token } });
    if (!session || session.userId == null || !session.tokenExpiresAt) {
      throw new UnauthorizedException('Invalid link session');
    }
    if (session.tokenExpiresAt < new Date()) {
      throw new UnauthorizedException('Link session expired');
    }
    return { userId: session.userId };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 3) NONCE — arma el mensaje server-side y crea un nonce single-use.
  // ─────────────────────────────────────────────────────────────────────────
  async createNonce(
    userId: number,
    addressRaw: string,
    chainId: number,
  ): Promise<{ nonce: string; message: string; expiresAt: string }> {
    const address = this.requireAddress(addressRaw);
    const nonce = randomBytes(16).toString('hex');
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + NONCE_TTL_MS);
    const message =
      `By signing, you are proving you own this wallet and linking it to your Lendoor account. ` +
      `This does not initiate a transaction or cost any fees.\n\n` +
      `Domain: ${SIGN_DOMAIN}\n` +
      `Wallet: ${address}\n` +
      `Chain ID: ${chainId}\n` +
      `Nonce: ${nonce}\n` +
      `Issued At: ${issuedAt.toISOString()}`;

    await this.nonceRepo.save(
      this.nonceRepo.create({ userId, address, nonce, message, used: false, expiresAt }),
    );
    return { nonce, message, expiresAt: expiresAt.toISOString() };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 4) VERIFY — recupera el firmante (ECDSA), consume nonce, vincula wallet.
  // ─────────────────────────────────────────────────────────────────────────
  async verify(
    userId: number,
    addressRaw: string,
    chainId: number,
    message: string,
    signature: string,
  ): Promise<{ ok: true; wallet: { address: string; verifiedAt: string } }> {
    const address = this.requireAddress(addressRaw);

    // v1: solo ECDSA puro (firma 132 chars). ERC-1271 → v2.
    if (typeof signature !== 'string' || !signature.startsWith('0x') || signature.length !== 132) {
      throw new BadRequestException('Unsupported signature (v1 = ECDSA only)');
    }

    // El nonce DEBE existir para este (userId,address) con este mensaje, vivo.
    const nonceRow = await this.nonceRepo.findOne({
      where: { userId, address, message, used: false },
    });
    if (!nonceRow) throw new BadRequestException('Nonce not found or already used');
    if (nonceRow.expiresAt < new Date()) throw new BadRequestException('Nonce expired');

    // Recuperar el firmante y comparar con el address declarado.
    let recovered: string;
    try {
      recovered = await recoverMessageAddress({
        message,
        signature: signature as `0x${string}`,
      });
    } catch (e) {
      this.logger.error(`verify recover error: ${(e as Error)?.message}`);
      throw new BadRequestException('Invalid signature');
    }
    if (recovered.toLowerCase() !== address) {
      throw new BadRequestException('Signature does not match wallet');
    }

    // Consumir el nonce atómicamente (anti-replay / doble-uso).
    const consumed = await this.nonceRepo
      .createQueryBuilder()
      .update()
      .set({ used: true })
      .where('id = :id', { id: nonceRow.id })
      .andWhere('used = false')
      .execute();
    if (!consumed.affected) throw new BadRequestException('Nonce already used');

    // Anti-sybil: la address no puede estar vinculada a OTRO user.
    const existing = await this.linkedRepo.findOne({ where: { address } });
    if (existing && existing.userId !== userId) {
      throw new ConflictException('Wallet already linked to another account');
    }

    const verifiedAt = new Date();
    if (!existing) {
      await this.linkedRepo.save(
        this.linkedRepo.create({
          userId,
          address,
          chainId,
          verifiedAt,
          source: 'companion_web',
          verificationMethod: 'ecdsa_companion',
          message,
          signature,
        }),
      );
    }

    return { ok: true, wallet: { address, verifiedAt: (existing?.verifiedAt ?? verifiedAt).toISOString() } };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 5) WALLETS — lista vinculadas (companion).
  // ─────────────────────────────────────────────────────────────────────────
  async walletsForUser(userId: number): Promise<{ wallets: { address: string; chainId: number; verifiedAt: string; source: string }[] }> {
    const rows = await this.linkedRepo.find({ where: { userId }, order: { verifiedAt: 'DESC' } });
    return {
      wallets: rows.map((r) => ({
        address: r.address,
        chainId: r.chainId,
        verifiedAt: r.verifiedAt.toISOString(),
        source: r.source,
      })),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 6) STATUS — lo pollea el MÓVIL con su access-token (resuelve por wallet).
  // ─────────────────────────────────────────────────────────────────────────
  async statusForWallet(
    walletAddress: string,
  ): Promise<{ linkedCount: number; wallets: { address: string; verifiedAt: string }[]; latestVerifiedAt: string | null }> {
    const user = await this.userRepo.findOne({
      where: { walletAddress: walletAddress.toLowerCase() },
    });
    if (!user) return { linkedCount: 0, wallets: [], latestVerifiedAt: null };
    const rows = await this.linkedRepo.find({ where: { userId: user.id }, order: { verifiedAt: 'DESC' } });
    return {
      linkedCount: rows.length,
      wallets: rows.map((r) => ({ address: r.address, verifiedAt: r.verifiedAt.toISOString() })),
      latestVerifiedAt: rows[0]?.verifiedAt.toISOString() ?? null,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  private requireAddress(addressRaw: string): string {
    const a = (addressRaw ?? '').trim().toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(a)) throw new BadRequestException('Invalid address');
    return a;
  }

  @Cron(CronExpression.EVERY_HOUR)
  async cleanup(): Promise<void> {
    const now = new Date();
    const n = await this.nonceRepo.delete({ expiresAt: LessThan(now) });
    // tokens vencidos: limpiar el token (no la fila, que es por-email).
    await this.sessionRepo
      .createQueryBuilder()
      .update()
      .set({ token: null, tokenExpiresAt: null })
      .where('tokenExpiresAt IS NOT NULL')
      .andWhere('tokenExpiresAt < :now', { now })
      .execute();
    this.logger.log(`wallet-link cleanup: ${n.affected ?? 0} nonces`);
  }
}
