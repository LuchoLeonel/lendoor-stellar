import { BadRequestException } from '@nestjs/common';

/**
 * Normalises an EVM wallet address: trims, lower-cases,
 * and validates the 0x + 40 hex chars format.
 */
export function normalizeWallet(addr: string): string {
  const w = (addr ?? '').trim().toLowerCase();
  if (!w || !/^0x[0-9a-f]{40}$/.test(w)) {
    throw new BadRequestException('Invalid wallet address');
  }
  return w;
}
