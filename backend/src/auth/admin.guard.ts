// src/auth/admin.guard.ts
//
// Spec 012 — founder-only admin dashboard access gate.
//
// Runs AFTER AccessTokenGuard so `req.user.walletAddress` is already set and
// verified (signed token). This guard compares the caller's wallet against
// the ADMIN_WALLETS env var (comma-separated list, case-insensitive).
//
// Absence of the env var or empty list => no one is admin (safe default).
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class AdminGuard implements CanActivate {
  private readonly logger = new Logger(AdminGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<
      Request & { user?: { walletAddress?: string } }
    >();

    const wallet = req.user?.walletAddress?.toLowerCase();
    if (!wallet) {
      // AccessTokenGuard should have populated req.user; defense in depth.
      this.logger.warn('AdminGuard: req.user missing — did AccessTokenGuard run?');
      throw new ForbiddenException('Admin access required');
    }

    const allowed = parseAdminWallets(process.env.ADMIN_WALLETS);
    if (!allowed.includes(wallet)) {
      this.logger.warn(`AdminGuard: wallet=${wallet} not in allowlist`);
      throw new ForbiddenException('Admin access required');
    }

    return true;
  }
}

/**
 * Parse ADMIN_WALLETS env var into a lowercase array of addresses.
 * Tolerates trailing/leading whitespace, quotes, and empty slots.
 * Exported for unit testing.
 */
export function parseAdminWallets(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return raw
    .replace(/^["']|["']$/g, '') // strip wrapping quotes if present in .env
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}
