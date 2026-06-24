// src/wallet-link/current-link-user.decorator.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** userId resuelto por WalletLinkScopeGuard desde el linkSession. */
export const CurrentLinkUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): number | undefined => {
    const req = ctx
      .switchToHttp()
      .getRequest<{ walletLink?: { userId: number } }>();
    return req.walletLink?.userId;
  },
);
