import dotenv from 'dotenv';
dotenv.config();

// Decimales del token de settlement en unidades on-chain, decididos una sola
// vez por proceso según el gateway activo (mismo criterio que env.ts /
// loan.module.ts). EVM (Celo): USDC ERC-20 = 6. Soroban: los classic assets de
// Stellar — el SAC de XLM en testnet y el USDC SAC en mainnet — usan 7
// (verificado on-chain contra decimals() del SAC el 2026-10-05; el gateway lo
// re-verifica al boot). El dotenv.config() de arriba es necesario: este módulo
// puede evaluarse antes que el de quien lo importa (hoisting de imports).
export const EVM_USDC_DECIMALS = 6;
export const STELLAR_TOKEN_DECIMALS = 7;
export const TOKEN_DECIMALS =
  (process.env.BLOCKCHAIN_GATEWAY ?? '').trim().toLowerCase() === 'soroban'
    ? STELLAR_TOKEN_DECIMALS
    : EVM_USDC_DECIMALS;
/** 10^TOKEN_DECIMALS, como number — para conversiones unidades↔humano. */
export const TOKEN_UNIT = 10 ** TOKEN_DECIMALS;

/** Limite de credito default (1 USDC) — UNA sola copia (review PR #2: vivia
 * triplicada en chain-sync, loan-verification y loan-repayment). */

export function toUnits(
  v: string | number | bigint,
  decimals = TOKEN_DECIMALS,
): bigint {
  if (typeof v === 'bigint') return v;
  // Signo manejado EXPLICITO (review PR #2): con el split ingenuo, '-0.5'
  // parseaba whole='-0' → 0n y la fraccion POSITIVA se sumaba: devolvia
  // +5e6 de un monto negativo, saltando los guards de monto <= 0.
  const raw = String(v).trim();
  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;
  const [wholeRaw, fracRaw = ''] = unsigned.split('.');
  const whole = wholeRaw === '' ? '0' : wholeRaw;
  const frac = fracRaw.padEnd(decimals, '0').slice(0, decimals);
  const units = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac || '0');
  return negative ? -units : units;
}

export const DEFAULT_CREDIT_LIMIT_USDC = toUnits(1);
