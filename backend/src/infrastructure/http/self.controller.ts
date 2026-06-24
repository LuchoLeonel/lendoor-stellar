// src/infrastructure/http/self.controller.ts
// Re-export: canonical copy is this file; src/self/self.controller.ts is kept for backward compat.
import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { SelfService } from 'src/self/self.service';

@ApiTags('self')
@Controller('self')
export class SelfController {
  constructor(private readonly selfService: SelfService) {}

  // Called by the Self app (NOT your frontend). Must NOT have a guard.
  @Post('verify')
  @ApiOperation({
    summary: 'Webhook called by the Self app to submit a passport verification',
  })
  @ApiResponse({
    status: 201,
    description: 'Verification received and processed',
  })
  async verifyFromSelf(@Body() body: Record<string, unknown>) {
    return this.selfService.verifyFromSelf(body);
  }

  // Public: used by the frontend to poll verification status
  // GET /self/profile?walletAddress=0x...
  @Get('profile')
  @ApiOperation({
    summary: 'Poll the Self identity verification status for a wallet',
  })
  @ApiQuery({
    name: 'walletAddress',
    description: 'EVM wallet address to look up',
    example: '0xabc123...',
  })
  @ApiResponse({
    status: 200,
    description: 'Profile and verification status returned',
  })
  async getProfile(@Query('walletAddress') walletAddress: string) {
    return this.selfService.getProfile(walletAddress);
  }
}
