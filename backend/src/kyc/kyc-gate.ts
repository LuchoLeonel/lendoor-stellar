// src/kyc/kyc-gate.ts
import { ForbiddenException } from '@nestjs/common';

/**
 * D1.3 — EL gate. Funcion pura a proposito: lee el estado PERSISTIDO del
 * user (nunca llama al vendor en el camino caliente de credito) y no mete
 * dependencias nuevas en los constructores de LoanVerificationService /
 * LoanService. El refresh del estado contra el vendor pasa en KycService,
 * por los endpoints de /kyc.
 *
 * Flag KYC_GATE_ENABLED (default: APAGADO): el flujo testnet existente de
 * stellar.lendoor.xyz no exige KYC hoy y no se regresiona en silencio. El
 * demo del deliverable lo prende; el cutover a mainnet lo deja prendido
 * (la metrica del tranche final cuenta prestamos a borrowers
 * KYC-verificados, asi que el gate es lo que hace el conteo no-sybileable).
 */
export function kycGateEnabled(): boolean {
  return (process.env.KYC_GATE_ENABLED ?? '').toLowerCase() === 'true';
}

export function assertKycGate(user: { kycStatus?: string | null }): void {
  if (!kycGateEnabled()) return;
  if (user.kycStatus === 'approved') return;
  throw new ForbiddenException(
    'Necesitás completar la verificación de identidad (KYC) antes de operar tu línea de crédito.',
  );
}
