import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Extracts the authenticated caller's wallet address from req.user
 * (set by AccessTokenGuard).
 */
export const CallerWallet = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ user?: { walletAddress: string } }>();
    return request.user?.walletAddress ?? '';
  },
);
