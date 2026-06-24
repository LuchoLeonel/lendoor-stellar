import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentWallet = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const req = ctx
      .switchToHttp()
      .getRequest<{ user?: { walletAddress: string } }>();
    return req.user?.walletAddress;
  },
);
