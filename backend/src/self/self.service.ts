// src/self/self.service.ts
import {
  Injectable,
  Logger,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  SelfBackendVerifier,
  AllIds,
  AttestationId,
  DefaultConfigStore,
} from '@selfxyz/core';

import { SelfVerification } from 'src/domain/entities/self-verification.entity';
import { User } from 'src/domain/entities/user.entity';
import { normalizeWallet } from 'src/common/normalize-wallet';

@Injectable()
export class SelfService {
  private readonly logger = new Logger(SelfService.name);
  private readonly verifier: SelfBackendVerifier;

  constructor(
    @InjectRepository(SelfVerification)
    private readonly selfRepo: Repository<SelfVerification>,

    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {
    const scope = process.env.SELF_SCOPE;
    const verifyEndpoint = `${process.env.BACKEND_URL}/self/verify`;
    const mockPassport = process.env.SELF_MOCK_PASSPORT === 'true';

    if (!scope) {
      this.logger.error('❌ SELF_SCOPE no está definido en el .env');
      throw new Error('SELF_SCOPE is required for SelfService');
    }

    if (!verifyEndpoint) {
      this.logger.error('❌ SELF_ENDPOINT no está definido en el .env');
      throw new Error('SELF_ENDPOINT is required for SelfService');
    }

    this.logger.log(
      `[SelfService] Init → scope=${scope} | endpoint=${verifyEndpoint} | mock=${mockPassport}`,
    );

    const configStore = new DefaultConfigStore({
      minimumAge: 18,
      excludedCountries: ['USA', 'RUS', 'IRN', 'PRK', 'SYR', 'VEN'],
      ofac: false,
    });

    // ⚠️ userIdentifierType = 'hex' porque en el front usás la wallet como userId
    this.verifier = new SelfBackendVerifier(
      scope,
      verifyEndpoint,
      mockPassport,
      AllIds,
      configStore,
      'hex',
    );
  }

  private extractWalletFromUserContextData(
    userContextData: string,
  ): string | null {
    if (!userContextData) return null;

    let hex = userContextData.trim().toLowerCase();
    if (hex.startsWith('0x')) {
      hex = hex.slice(2);
    }

    // Caso 1: ya es solo la address en hex
    if (/^[0-9a-f]{40}$/.test(hex)) {
      return `0x${hex}`;
    }
    if (/^0x[0-9a-f]{40}$/.test(userContextData.trim())) {
      return userContextData.trim().toLowerCase();
    }

    // Caso 2: ABI encodeado como [chainId: uint256][wallet: address][...]
    // → primeros 64 hex = chainId, siguientes 64 = wallet padded
    if (hex.length >= 128) {
      const secondChunk = hex.slice(64, 128); // bytes 32–64
      const addrPart = secondChunk.slice(24); // últimos 40 chars = address
      const candidate = `0x${addrPart}`;
      if (/^0x[0-9a-f]{40}$/.test(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  private sanitizeSelfPayload(
    value: unknown,
  ):
    | string
    | number
    | boolean
    | null
    | undefined
    | Record<string, unknown>
    | unknown[] {
    if (value === null || value === undefined) return value;

    if (typeof value === 'string') {
      // Sacamos cualquier null char que venga en el string
      // eslint-disable-next-line no-control-regex
      return value.replace(/\u0000/g, '');
    }

    if (Array.isArray(value)) {
      return value.map((v: unknown) => this.sanitizeSelfPayload(v));
    }

    if (typeof value === 'object') {
      const clean: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        clean[k] = this.sanitizeSelfPayload(v);
      }
      return clean;
    }

    // number, boolean, etc
    return value as number | boolean;
  }

  /**
   * Devuelve true si el usuario tiene una verificación Self marcada como verified.
   */
  async isUserSelfVerified(userId: number): Promise<boolean> {
    if (!userId) return false;

    const record = await this.selfRepo.findOne({
      where: { userId },
    });

    return !!record?.verified;
  }

  /**
   * If platform is "farcaster", requires an existing SelfVerification.
   * If missing, we stop the flow but return a WARNING-like payload
   * so the frontend can treat it as "next step" instead of a hard error.
   */
  async ensureSelfVerificationForPlatform(user: User): Promise<void> {
    if (!user) {
      throw new BadRequestException('User not found');
    }

    // Only enforce this rule for Farcaster users
    if ((user.platform ?? '').toLowerCase() !== 'farcaster') {
      return;
    }

    const hasSelf = await this.isUserSelfVerified(user.id);

    if (!hasSelf) {
      throw new HttpException(
        {
          status: 'warning',
          // mantené este code si ya lo estás usando en el front
          error_code: 'SELF_VERIFICATION_REQUIRED_FOR_FARCASTER',
          // extra: por si querés algo más “UI friendly”
          title: 'Identity verification required',
          message:
            'Next step: complete your identity verification with Self to continue setting up your account.',
          next_step: 'self_verification',
        },
        HttpStatus.PRECONDITION_REQUIRED, // 428 (mejor que 400 para “falta un paso”)
      );
    }
  }

  /**
   * Endpoint que llama Self (via QR / deep link).
   * Body estándar:
   *  { attestationId, proof, publicSignals, userContextData }
   */
  async verifyFromSelf(body: Record<string, unknown> | null) {
    this.logger.log('[SelfService] verifyFromSelf llamado');
    this.logger.debug(
      `[SelfService] body keys: ${Object.keys(body ?? {}).join(', ')}`,
    );

    const { attestationId, proof, publicSignals, userContextData } = body ?? {};

    if (!proof || !publicSignals || !attestationId || !userContextData) {
      this.logger.warn('Missing fields in Self verification body', body);
      return {
        status: 'error',
        result: false,
        reason:
          'Proof, publicSignals, attestationId and userContextData are required',
        error_code: 'MISSING_FIELDS',
      };
    }

    interface SelfVerifyError extends Error {
      issues?: Array<{ type?: string }>;
    }
    interface SelfVerifyResult {
      isValidDetails?: {
        isValid?: boolean;
        [key: string]: unknown;
      };
      discloseOutput?: Record<string, unknown>;
    }

    let result: SelfVerifyResult;
    try {
      /* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any */
      result = (await this.verifier.verify(
        attestationId as AttestationId,
        proof as any,
        publicSignals as any,
        userContextData as string,
      )) as SelfVerifyResult;
      /* eslint-enable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any */
    } catch (e: unknown) {
      const err = e as SelfVerifyError;
      this.logger.error('[SelfService] Error calling verifier.verify', e);
      return {
        status: 'error',
        result: false,
        reason: err?.message ?? 'Verification error',
        error_code: err?.issues?.[0]?.type ?? 'VERIFY_EXCEPTION',
        details: err?.issues ?? undefined,
      };
    }

    this.logger.debug(
      `[SelfService] verify() result: ${JSON.stringify(
        result?.isValidDetails ?? {},
      )}`,
    );

    const isValid = !!result?.isValidDetails?.isValid;

    if (!isValid) {
      this.logger.warn(
        '[SelfService] Verification failed',
        result?.isValidDetails,
      );
      return {
        status: 'error',
        result: false,
        reason: 'Verification failed',
        error_code: 'VERIFICATION_FAILED',
        details: result?.isValidDetails,
      };
    }

    // userContextData = wallet que seteaste en el front (hex)
    let wallet: string;
    const userContextStr =
      typeof userContextData === 'string' ? userContextData : '';
    const extracted = this.extractWalletFromUserContextData(userContextStr);

    if (!extracted) {
      this.logger.error(
        `[SelfService] Self verification ok pero userContextData no contiene una wallet reconocible: ${userContextStr}`,
      );
      return {
        status: 'success',
        result: true,
        credentialSubject: result.discloseOutput,
      };
    }

    try {
      wallet = normalizeWallet(extracted);
    } catch {
      this.logger.error(
        `[SelfService] Wallet extraída de userContextData es inválida: ${extracted}`,
      );
      return {
        status: 'success',
        result: true,
        credentialSubject: result.discloseOutput,
      };
    }

    // Buscamos el User correspondiente a esa wallet
    const user = await this.userRepo.findOne({
      where: { walletAddress: wallet },
    });

    if (!user) {
      this.logger.warn(
        `[SelfService] Verificación válida para wallet sin User: ${wallet}`,
      );
      return {
        status: 'success',
        result: true,
        credentialSubject: result.discloseOutput,
      };
    }

    // Read discloseOutput with proper typing — snake_case and camelCase fields
    const rawPayload: Record<string, unknown> =
      (result.discloseOutput as Record<string, unknown>) ?? {};
    const sanitized = this.sanitizeSelfPayload(rawPayload);
    const payload = (sanitized ?? {}) as Record<string, unknown>;

    const nameObj = (payload.name as Record<string, unknown>) ?? {};

    // --- Sincronizar datos de identificación al User ---
    user.firstName =
      (nameObj.given_name as string | null | undefined) ??
      user.firstName ??
      null;
    user.lastName =
      (nameObj.family_name as string | null | undefined) ??
      user.lastName ??
      null;

    user.birthdate =
      (payload.date_of_birth as string | null | undefined) ??
      (payload.dateOfBirth as string | null | undefined) ??
      user.birthdate ??
      null;

    user.nationality =
      (payload.nationality as string | null | undefined) ??
      user.nationality ??
      null;

    user.documentType =
      (payload.document_type as string | null | undefined) ??
      (payload.documentType as string | null | undefined) ??
      user.documentType ??
      null;

    user.documentNumber =
      (payload.passport_number as string | null | undefined) ??
      (payload.document_number as string | null | undefined) ??
      (payload.documentNumber as string | null | undefined) ??
      user.documentNumber ??
      null;

    await this.userRepo.save(user);

    // --- Guardar / actualizar SelfVerification linkeado por userId ---
    const existing = await this.selfRepo.findOne({
      where: { userId: user.id },
    });

    if (existing) {
      existing.verified = true;
      existing.walletAddress = wallet;
      existing.payload = payload;
      await this.selfRepo.save(existing);
    } else {
      const record = this.selfRepo.create({
        userId: user.id,
        user,
        walletAddress: wallet,
        verified: true,
        payload,
      });
      await this.selfRepo.save(record);
    }

    return {
      status: 'success',
      result: true,
      credentialSubject: result.discloseOutput,
    };
  }

  /**
   * Endpoint que usa tu app: chequea si el usuario ya está verificado con Self.
   * GET /self/profile?walletAddress=0x...
   */
  async getProfile(walletAddress: string) {
    const wallet = normalizeWallet(walletAddress);

    const user = await this.userRepo.findOne({
      where: { walletAddress: wallet },
    });

    if (!user) {
      return {
        walletAddress: wallet,
        userId: null,
        verified: false,
        lastUpdatedAt: null,
        createdAt: null,
      };
    }

    const record = await this.selfRepo.findOne({
      where: { userId: user.id },
    });

    return {
      walletAddress: wallet,
      userId: user.id,
      verified: !!record?.verified,
      lastUpdatedAt: record?.updatedAt ?? null,
      createdAt: record?.createdAt ?? null,
    };
  }
}
