// src/kyc/kyc.service.ts
import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { User } from 'src/domain/entities/user.entity';
import {
  KYC_PROVIDER,
  KycProviderPort,
} from 'src/domain/ports/outbound/kyc-provider.port';
import { normalizeWallet } from 'src/common/normalize-wallet';

/**
 * D1.3 — orquestacion del KYC. La verdad persistida es users.kycStatus; el
 * vendor (detras del puerto) solo se consulta al arrancar una sesion y al
 * refrescar el estado desde /kyc/status. El gate (kyc-gate.ts) NUNCA llama
 * aca: lee el estado persistido y listo.
 *
 * Transiciones de kycStatus: none → pending → approved | rejected.
 * 'approved' es pegajoso (no se re-consulta al vendor); 'rejected' permite
 * reintentar con una sesion nueva via start().
 */
@Injectable()
export class KycService {
  private readonly logger = new Logger(KycService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @Inject(KYC_PROVIDER)
    private readonly provider: KycProviderPort,
  ) {}

  private async findUserOrThrow(walletAddress: string): Promise<User> {
    const wallet = normalizeWallet(walletAddress);
    const user = await this.userRepo.findOne({ where: { walletAddress: wallet } });
    if (!user) {
      throw new NotFoundException(
        'User not found. Completá el registro antes de verificar tu identidad.',
      );
    }
    return user;
  }

  /**
   * Arranca (o retoma) una verificacion. Idempotente sobre 'pending': si ya
   * hay sesion abierta devuelve la misma, no multiplica sesiones en el
   * vendor. Sobre 'approved' devuelve el estado sin crear nada.
   */
  async start(walletAddress: string): Promise<{
    status: string;
    sessionId?: string;
    verificationUrl?: string;
  }> {
    const user = await this.findUserOrThrow(walletAddress);

    if (user.kycStatus === 'approved') {
      return { status: 'approved' };
    }
    if (user.kycStatus === 'pending' && user.kycSessionId) {
      return { status: 'pending', sessionId: user.kycSessionId };
    }

    const session = await this.provider.createSession(user.walletAddress);
    await this.userRepo.update(
      { id: user.id },
      {
        kycStatus: 'pending',
        kycSessionId: session.sessionId,
        kycProvider: this.provider.name,
      },
    );
    this.logger.log(
      `[KycService] start wallet=${user.walletAddress} provider=${this.provider.name} session=${session.sessionId}`,
    );
    return {
      status: 'pending',
      sessionId: session.sessionId,
      verificationUrl: session.verificationUrl,
    };
  }

  /**
   * Estado actual, refrescando desde el vendor SOLO si hay sesion pendiente.
   * Persiste la transicion (approved con timestamp; rejected limpia la
   * sesion para permitir reintento).
   */
  async status(walletAddress: string): Promise<{ status: string }> {
    const user = await this.findUserOrThrow(walletAddress);

    if (user.kycStatus !== 'pending' || !user.kycSessionId) {
      return { status: user.kycStatus ?? 'none' };
    }

    const decision = await this.provider.getDecision(user.kycSessionId);
    if (decision === 'approved') {
      await this.userRepo.update(
        { id: user.id },
        { kycStatus: 'approved', kycApprovedAt: new Date() },
      );
      this.logger.log(`[KycService] APPROVED wallet=${user.walletAddress}`);
      return { status: 'approved' };
    }
    if (decision === 'rejected') {
      await this.userRepo.update(
        { id: user.id },
        { kycStatus: 'rejected', kycSessionId: null },
      );
      this.logger.warn(`[KycService] REJECTED wallet=${user.walletAddress}`);
      return { status: 'rejected' };
    }
    return { status: 'pending' };
  }
}
