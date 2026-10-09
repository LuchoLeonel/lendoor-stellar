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

export function toUnits(
  v: string | number | bigint,
  decimals = TOKEN_DECIMALS,
): bigint {
  if (typeof v === 'bigint') return v;
  const [wholeRaw, fracRaw = ''] = String(v).split('.');
  const whole = wholeRaw === '' ? '0' : wholeRaw;
  const frac = fracRaw.padEnd(decimals, '0').slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac || '0');
}
