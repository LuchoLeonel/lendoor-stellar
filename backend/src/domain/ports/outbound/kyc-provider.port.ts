// src/domain/ports/outbound/kyc-provider.port.ts

export const KYC_PROVIDER = Symbol('KYC_PROVIDER');

/**
 * D1.3 (SCF #45) — puerto del proveedor de KYC.
 *
 * El award lo promete con el vendor ABSTRAIDO a proposito (commit 21be5783:
 * "genericize KYC provider — drop vendor name for integration-track
 * eligibility"): la regla "a wallet must pass identity verification through
 * an off-chain KYC provider before `borrow` is enabled" es nuestra; el
 * vendor es un detalle enchufable detras de este puerto.
 *
 * Contrato minimo que TODO vendor de KYC hosted-flow cumple (didit, Sumsub,
 * Persona…): crear una sesion de verificacion que devuelve una URL donde el
 * usuario completa el flujo, y consultar la decision de esa sesion.
 */
export type KycDecision = 'pending' | 'approved' | 'rejected';

export interface KycSession {
  sessionId: string;
  /** URL del flujo hosted donde el usuario completa la verificacion. */
  verificationUrl: string;
}

export interface KycProviderPort {
  /** Nombre corto del vendor ('fake', 'didit', …) — se persiste en el user. */
  readonly name: string;
  createSession(wallet: string): Promise<KycSession>;
  getDecision(sessionId: string): Promise<KycDecision>;
}
