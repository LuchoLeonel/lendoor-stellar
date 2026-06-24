import { ForbiddenException } from '@nestjs/common';
import { normalizeWallet } from './normalize-wallet';

/**
 * Throws ForbiddenException if the caller's wallet does not match
 * the wallet in the request body/params.
 */
export function assertWalletOwnership(
  callerWallet: string,
  requestedWallet: string,
): void {
  if (normalizeWallet(callerWallet) !== normalizeWallet(requestedWallet)) {
    throw new ForbiddenException("Cannot operate on another user's wallet");
  }
}
