import { BadRequestException } from '@nestjs/common';
import { isValidStellarPublicKey } from './stellar-strkey';

export const EVM_WALLET_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
export const STELLAR_ACCOUNT_ADDRESS_PATTERN = /^G[A-Z2-7]{55}$/;
export const WALLET_ADDRESS_PATTERN =
  /^(0x[0-9a-fA-F]{40}|G[A-Z2-7]{55})$/;
export const CHAIN_TX_HASH_PATTERN = /^(0x)?[0-9a-fA-F]{64}$/;

export const walletAddressTransformer = {
  to: (v?: string | null) => (v == null ? null : normalizeWallet(v)),
  from: (v?: string | null) => (v == null ? null : normalizeWallet(v)),
};

/**
 * Normalises supported wallet addresses.
 *
 * EVM addresses remain lowercase for backwards compatibility. Stellar
 * account IDs are case-sensitive StrKeys, so they are trimmed and preserved.
 */
export function normalizeWallet(addr: string): string {
  const w = (addr ?? '').trim();
  if (EVM_WALLET_ADDRESS_PATTERN.test(w)) return w.toLowerCase();
  if (isValidStellarPublicKey(w)) return w;

  throw new BadRequestException('Invalid wallet address');
}

export function normalizeWalletOrNull(addr?: string | null): string | null {
  if (addr == null) return null;
  const trimmed = addr.trim();
  if (!trimmed) return null;
  return normalizeWallet(trimmed);
}

export function assertValidWalletAddress(addr: string): void {
  try {
    normalizeWallet(addr);
  } catch {
    throw new BadRequestException('Invalid wallet address');
  }
}
