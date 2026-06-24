// src/wallet-link/wallet-link.controller.ts
// Spec 084 — 6 endpoints /wallet-link/*. Shapes EXACTOS de frontend/src/lib/api.ts.
import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { WalletLinkService } from './wallet-link.service';
import { WalletLinkScopeGuard } from './wallet-link-scope.guard';
import { CurrentLinkUser } from './current-link-user.decorator';
import { AccessTokenGuard } from 'src/auth/access-token.guard';
import { CurrentWallet } from 'src/auth/current-wallet.decorator';

@Controller('wallet-link')
export class WalletLinkController {
  constructor(private readonly service: WalletLinkService) {}

  // POST /wallet-link/start (unauth) — siempre 200. Throttle por IP + email.
  @Post('start')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  start(@Body() body: { email: string }) {
    return this.service.start(body?.email);
  }

  // POST /wallet-link/session (unauth) — OTP → linkSession.
  @Post('session')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  session(@Body() body: { email: string; code: string }) {
    return this.service.session(body?.email, body?.code);
  }

  // POST /wallet-link/nonce (Bearer linkSession).
  @Post('nonce')
  @UseGuards(WalletLinkScopeGuard)
  nonce(
    @CurrentLinkUser() userId: number,
    @Body() body: { address: string; chainId: number },
  ) {
    return this.service.createNonce(userId, body?.address, body?.chainId ?? 1);
  }

  // POST /wallet-link/verify (Bearer linkSession).
  @Post('verify')
  @UseGuards(WalletLinkScopeGuard)
  verify(
    @CurrentLinkUser() userId: number,
    @Body() body: { address: string; chainId: number; message: string; signature: string },
  ) {
    return this.service.verify(
      userId,
      body?.address,
      body?.chainId ?? 1,
      body?.message,
      body?.signature,
    );
  }

  // GET /wallet-link/wallets (Bearer linkSession).
  @Get('wallets')
  @UseGuards(WalletLinkScopeGuard)
  wallets(@CurrentLinkUser() userId: number) {
    return this.service.walletsForUser(userId);
  }

  // GET /wallet-link/status — lo pollea el MÓVIL con su access-token.
  @Get('status')
  @UseGuards(AccessTokenGuard)
  status(@CurrentWallet() wallet: string) {
    return this.service.statusForWallet(wallet);
  }
}
