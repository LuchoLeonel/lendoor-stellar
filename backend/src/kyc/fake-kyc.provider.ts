// src/kyc/fake-kyc.provider.ts
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';

import {
  KycDecision,
  KycProviderPort,
  KycSession,
} from 'src/domain/ports/outbound/kyc-provider.port';

/**
 * Proveedor FAKE para testnet/demo — el vendor real (didit u otro) se
 * enchufa despues detras del mismo puerto, cuando se confirme.
 *
 * Dos modos:
 * - default: la sesion nace 'pending' y se resuelve con resolve() (el
 *   endpoint sandbox del controller) — asi el demo muestra el gate
 *   BLOQUEANDO y despues dejando pasar, que es la evidencia que importa.
 * - KYC_FAKE_AUTO_APPROVE=true: toda consulta devuelve 'approved' (para
 *   e2e automatizados donde el bloqueo no es lo que se prueba).
 *
 * Estado en memoria A PROPOSITO: la verdad persistida vive en users
 * (kycStatus via KycService); esto solo simula el lado del vendor.
 */
@Injectable()
export class FakeKycProvider implements KycProviderPort {
  readonly name = 'fake';

  private readonly sessions = new Map<string, KycDecision>();

  async createSession(wallet: string): Promise<KycSession> {
    const sessionId = `fake-${randomUUID()}`;
    this.sessions.set(sessionId, 'pending');
    return {
      sessionId,
      verificationUrl: `https://kyc.invalid/fake/${sessionId}?wallet=${wallet}`,
    };
  }

  async getDecision(sessionId: string): Promise<KycDecision> {
    if ((process.env.KYC_FAKE_AUTO_APPROVE ?? '').toLowerCase() === 'true') {
      return 'approved';
    }
    // sesion desconocida = pending, no error: el vendor real tambien contesta
    // "sin decision todavia" ante una sesion que su lado aun no indexo
    return this.sessions.get(sessionId) ?? 'pending';
  }

  /** Solo sandbox: resuelve una sesion a mano (lo expone el controller). */
  resolve(sessionId: string, decision: Exclude<KycDecision, 'pending'>): void {
    this.sessions.set(sessionId, decision);
  }
}
