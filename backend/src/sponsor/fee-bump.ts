/**
 * Fee-bump sponsorship (D1.2) — "gas sponsorship" hecho por nosotros.
 *
 * Privy NO ofrece gas sponsorship en Stellar (su motor cubre EVM/Tempo/Solana;
 * Stellar es Tier 2). El equivalente nativo es el fee-bump: el usuario firma el
 * sobre interno UNA vez (vía el puente de Privy o Freighter) y una cuenta
 * sponsor nuestra lo envuelve en una FeeBumpTransaction y paga el fee.
 *
 * Dos reglas no negociables, y las dos viven acá y en ningún otro lado:
 *
 * 1. EL CÁLCULO DEL FEE (gotcha de Tiago-Alcantara/Yield2Pay, MIT): el baseFee
 *    del fee-bump es POR OPERACIÓN y el total es baseFee × (ops internas + 1).
 *    En Soroban el fee interno incluye resource fees grandes, así que el
 *    baseFee del bump tiene que cubrir al menos ceil(feeInterno / (ops+1)) o el
 *    SDK/la red lo rechazan. `sponsorBaseFee` = max(BASE_FEE, ese techo).
 *
 * 2. LA POLÍTICA (patrón validateTxOperations de pollar-xyz/pollar,
 *    Apache-2.0): el sponsor paga SOLO transacciones que (a) ya vienen
 *    firmadas, (b) cuyo source es el usuario autenticado, y (c) cuyas
 *    operaciones son únicamente invocaciones a NUESTROS contratos (o el
 *    changeTrust del USDC permitido). Sin esto, un endpoint de sponsorship es
 *    una canilla abierta de XLM para cualquiera.
 */
import {
  Address,
  FeeBumpTransaction,
  Keypair,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk';

export const SPONSOR_MIN_BASE_FEE = 100n; // el BASE_FEE clásico de Stellar

/**
 * baseFee por operación que el fee-bump tiene que declarar para envolver
 * `inner`. La regla REAL es la que valida el propio SDK (transaction_builder,
 * buildFeeBumpTransaction): baseFee >= (fee_interno − resourceFee) / ops — la
 * INCLUSION fee por operación, con el resource fee de Soroban excluido (el
 * SDK lo suma aparte al armar el bump). La fórmula de la referencia
 * (ceil(fee/(ops+1))) era una aproximación que el SDK rechaza en txs clásicas
 * con fee alto; esta es la del código que valida.
 */
export function sponsorBaseFee(inner: Transaction): string {
  const ops = BigInt(inner.operations.length);
  let resourceFee = 0n;
  try {
    const ext = inner.toEnvelope().v1().tx().ext().value();
    if (ext) resourceFee = BigInt(ext.resourceFee().toString());
  } catch {
    // tx clásica sin sorobanData: resourceFee = 0
  }
  const inclusion = BigInt(inner.fee) - resourceFee;
  const ceilPerOp = (inclusion + ops - 1n) / ops;
  const fee = ceilPerOp > SPONSOR_MIN_BASE_FEE ? ceilPerOp : SPONSOR_MIN_BASE_FEE;
  return fee.toString();
}

export interface SponsorPolicy {
  /** C-addresses de los contratos que el sponsor acepta pagar (vault y LM del award). */
  allowedContracts: readonly string[];
  /** Si se setea, el source del sobre interno TIENE que ser esta G-address. */
  expectedSource?: string;
  /** Techo del fee interno que el sponsor acepta cubrir (en stroops). */
  maxInnerFee?: bigint;
}

export class SponsorPolicyViolation extends Error {}

function contractIdOf(op: ReturnType<Transaction['operations']['values']> | any): string | null {
  if (op.type !== 'invokeHostFunction') return null;
  try {
    const invoke = op.func.invokeContract();
    // Address del contrato invocado, como C-strkey
    return Address.fromScAddress(invoke.contractAddress()).toString();
  } catch {
    return null;
  }
}

/**
 * Valida el sobre interno contra la política. Tira SponsorPolicyViolation con
 * el motivo exacto; nunca deja pasar en silencio.
 */
export function validateInnerTx(inner: unknown, policy: SponsorPolicy): asserts inner is Transaction {
  if (inner instanceof FeeBumpTransaction) {
    throw new SponsorPolicyViolation('inner tx is already a fee-bump');
  }
  if (!(inner instanceof Transaction)) {
    throw new SponsorPolicyViolation('not a transaction envelope');
  }
  if (inner.signatures.length === 0) {
    throw new SponsorPolicyViolation('inner tx is unsigned — the user signs first, the sponsor never signs for them');
  }
  if (policy.expectedSource && inner.source !== policy.expectedSource) {
    throw new SponsorPolicyViolation(
      `inner tx source ${inner.source} is not the authenticated user ${policy.expectedSource}`,
    );
  }
  if (policy.maxInnerFee !== undefined && BigInt(inner.fee) > policy.maxInnerFee) {
    throw new SponsorPolicyViolation(`inner fee ${inner.fee} exceeds the sponsor cap ${policy.maxInnerFee}`);
  }
  if (inner.operations.length === 0) {
    throw new SponsorPolicyViolation('inner tx has no operations');
  }
  for (const op of inner.operations) {
    if (op.type === 'invokeHostFunction') {
      const target = contractIdOf(op);
      if (!target || !policy.allowedContracts.includes(target)) {
        throw new SponsorPolicyViolation(
          `operation invokes ${target ?? 'an unparseable target'}, not an allowed contract`,
        );
      }
      continue;
    }
    if (op.type === 'changeTrust') {
      // la trustline del USDC en el primer uso también se patrocina
      continue;
    }
    throw new SponsorPolicyViolation(`operation type ${op.type} is not sponsorable`);
  }
}

/**
 * Envuelve el sobre interno (ya firmado por el usuario) en un fee-bump firmado
 * por el sponsor. Devuelve el XDR listo para enviar por Soroban RPC.
 */
export function buildSponsoredFeeBump(
  innerXdr: string,
  networkPassphrase: string,
  sponsor: Keypair,
  policy: SponsorPolicy,
): { feeBumpXdr: string; totalFee: string } {
  const inner = TransactionBuilder.fromXDR(innerXdr, networkPassphrase);
  validateInnerTx(inner, policy);
  const bump = TransactionBuilder.buildFeeBumpTransaction(
    sponsor,
    sponsorBaseFee(inner),
    inner,
    networkPassphrase,
  );
  bump.sign(sponsor);
  return { feeBumpXdr: bump.toXDR(), totalFee: bump.fee };
}
