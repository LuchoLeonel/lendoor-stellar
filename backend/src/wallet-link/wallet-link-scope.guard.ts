// src/wallet-link/wallet-link-scope.guard.ts
// Spec 084 — valida el linkSession (Bearer) contra wallet_link_sessions. Como
// vive en tabla SEPARADA de access_tokens, un access-token normal NO valida acá
// y un linkSession NO valida en AccessTokenGuard (/loan) → aislamiento de scope
// por construcción (decisión #2).
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { WalletLinkService } from './wallet-link.service';

@Injectable()
export class WalletLinkScopeGuard implements CanActivate {
  constructor(private readonly service: WalletLinkService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const authHeader = req.headers['authorization'] ?? null;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing link session');
    }
    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) throw new UnauthorizedException('Empty link session');

    const { userId } = await this.service.validateLinkSession(token);
    (req as Request & { walletLink?: { userId: number } }).walletLink = { userId };
    return true;
  }
}
