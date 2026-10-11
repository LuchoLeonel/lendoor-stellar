// src/infrastructure/http/kyc.controller.ts
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { AccessTokenGuard } from 'src/auth/access-token.guard';
import { CallerWallet } from 'src/common/caller-wallet.decorator';
import { KycService } from 'src/kyc/kyc.service';
import { FakeKycProvider } from 'src/kyc/fake-kyc.provider';
import {
  KYC_PROVIDER,
  KycProviderPort,
} from 'src/domain/ports/outbound/kyc-provider.port';
import { SandboxDecisionDto } from 'src/kyc/dto/sandbox-decision.dto';

/**
 * D1.3 — endpoints del KYC. La wallet SIEMPRE sale del token (CallerWallet):
 * nadie arranca ni consulta el KYC de otro.
 */
@ApiTags('kyc')
@ApiBearerAuth()
@Controller('kyc')
@UseGuards(AccessTokenGuard)
export class KycController {
  constructor(
    private readonly service: KycService,
    @Inject(KYC_PROVIDER) private readonly provider: KycProviderPort,
  ) {}

  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('start')
  @HttpCode(200)
  @ApiOperation({ summary: 'Start (or resume) identity verification for the caller wallet' })
  @ApiResponse({ status: 200, description: 'Session created or resumed' })
  async start(@CallerWallet() caller: string) {
    return this.service.start(caller);
  }

  @Get('status')
  @ApiOperation({ summary: 'Current KYC status for the caller wallet (refreshes if pending)' })
  @ApiResponse({ status: 200, description: 'none | pending | approved | rejected' })
  async status(@CallerWallet() caller: string) {
    return this.service.status(caller);
  }

  /**
   * SOLO sandbox: resuelve una sesion del proveedor FAKE a mano, para el
   * demo del gate (bloquea → aprueba → pasa). Con cualquier vendor real el
   * endpoint no existe a efectos practicos: 403 siempre.
   */
  @Post('sandbox/decision')
  @HttpCode(200)
  @ApiOperation({ summary: '[fake provider only] resolve a KYC session by hand' })
  async sandboxDecision(@Body() body: SandboxDecisionDto) {
    if (!(this.provider instanceof FakeKycProvider)) {
      throw new ForbiddenException('sandbox decisions only exist for the fake provider');
    }
    this.provider.resolve(body.sessionId, body.decision);
    return { ok: true };
  }
}
