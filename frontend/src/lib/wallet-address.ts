import type { WalletMode } from "@shared/types/platform";

export const EVM_WALLET_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
export const STELLAR_ACCOUNT_ADDRESS_PATTERN = /^G[A-Z2-7]{55}$/;

export function normalizeWalletAddress(
  address?: string | null,
  mode?: WalletMode | null,
): string | null {
  const trimmed = address?.trim();
  if (!trimmed) return null;

  if (mode === "stellar") {
    return STELLAR_ACCOUNT_ADDRESS_PATTERN.test(trimmed) ? trimmed : null;
  }

  if (EVM_WALLET_ADDRESS_PATTERN.test(trimmed)) return trimmed.toLowerCase();
  if (STELLAR_ACCOUNT_ADDRESS_PATTERN.test(trimmed)) return trimmed;

  return null;
}

export function walletAddressEquals(
  a?: string | null,
  b?: string | null,
  mode?: WalletMode | null,
): boolean {
  const left = normalizeWalletAddress(a, mode);
  const right = normalizeWalletAddress(b, mode);
  return !!left && !!right && left === right;
}
