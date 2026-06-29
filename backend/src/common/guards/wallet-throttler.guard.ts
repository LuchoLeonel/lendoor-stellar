// src/common/guards/wallet-throttler.guard.ts
import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { normalizeWallet } from '../normalize-wallet';

interface AuthenticatedRequest {
  user?: { walletAddress?: string };
  ip?: string;
  socket?: { remoteAddress?: string };
}

@Injectable()
export class WalletThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, unknown>): Promise<string> {
    const typedReq = req as AuthenticatedRequest;
    const walletAddress = typedReq.user?.walletAddress;

    if (walletAddress) {
      return Promise.resolve(`wallet:${normalizeWallet(walletAddress)}`);
    }

    // Fall back to IP-based tracking for unauthenticated requests
    return Promise.resolve(
      typedReq.ip ?? typedReq.socket?.remoteAddress ?? 'unknown',
    );
  }
}
