// src/infrastructure/http/auth.controller.ts
import { Body, Controller, HttpCode, Post, Headers } from '@nestjs/common';
import { IsString, IsNotEmpty } from 'class-validator';
import { UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiProperty,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuthService } from 'src/auth/auth.service';

class VerifySiweDto {
  @ApiProperty({
    description: 'EVM wallet address',
    example: '0xabc123...',
  })
  @IsString()
  @IsNotEmpty()
  wallet!: string;

  @ApiProperty({
    description: 'SIWE message signature',
    example: '0xsig...',
  })
  @IsString()
  @IsNotEmpty()
  signature!: string;

  @ApiProperty({
    description: 'EIP-4361 SIWE message',
    example: 'lendoor.xyz wants you to sign in...',
  })
  @IsString()
  @IsNotEmpty()
  message!: string;

  @ApiProperty({
    description: 'One-time nonce from POST /auth/nonce',
    example: 'a1b2c3d4',
  })
  @IsString()
  @IsNotEmpty()
  nonce!: string;
}

class VerifyStellarDto {
  @ApiProperty({
    description: 'Stellar account public key',
    example: 'GABC...',
  })
  @IsString()
  @IsNotEmpty()
  wallet!: string;

  @ApiProperty({
    description: 'Base64 signature returned by Freighter signMessage',
    example: 'base64-signature',
  })
  @IsString()
  @IsNotEmpty()
  signature!: string;

  @ApiProperty({
    description: 'Base64-encoded message that was signed',
    example: 'bGVuZG9vci54eXogbm9uY2U6IGExYjJjM2Q0',
  })
  @IsString()
  @IsNotEmpty()
  message!: string;

  @ApiProperty({
    description: 'One-time nonce from POST /auth/nonce',
    example: 'a1b2c3d4',
  })
  @IsString()
  @IsNotEmpty()
  nonce!: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('nonce')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOperation({ summary: 'Generate a one-time nonce for SIWE sign-in' })
  @ApiResponse({
    status: 200,
    description: 'Nonce created successfully',
    schema: { example: { nonce: 'a1b2c3d4' } },
  })
  async getNonce() {
    const nonce = await this.auth.createNonce();
    return { nonce };
  }

  @Post('verify')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @ApiOperation({
    summary: 'Verify a SIWE signature and issue a JWT access token',
  })
  @ApiResponse({
    status: 200,
    description: 'Signature verified, access token issued',
    schema: {
      example: { verified: true, wallet: '0xabc123...', accessToken: 'eyJ...' },
    },
  })
  @ApiResponse({ status: 401, description: 'Invalid signature or nonce' })
  async verify(@Body() dto: VerifySiweDto) {
    const { wallet, accessToken } =
      await this.auth.verifySiweAndIssueToken(dto);

    return {
      verified: true,
      wallet,
      accessToken,
    };
  }

  @Post('stellar/verify')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @ApiOperation({
    summary: 'Verify a Stellar signed message and issue an access token',
  })
  @ApiResponse({
    status: 200,
    description: 'Signature verified, access token issued',
    schema: {
      example: { verified: true, wallet: 'GABC...', accessToken: 'eyJ...' },
    },
  })
  @ApiResponse({ status: 401, description: 'Invalid signature or nonce' })
  async verifyStellar(@Body() dto: VerifyStellarDto) {
    const { wallet, accessToken } =
      await this.auth.verifyStellarAndIssueToken(dto);

    return {
      verified: true,
      wallet,
      accessToken,
    };
  }

  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Refresh an existing JWT access token' })
  @ApiResponse({
    status: 200,
    description: 'New access token issued',
    schema: {
      example: { accessToken: 'eyJ...', wallet: '0xabc123...' },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid Authorization header',
  })
  async refresh(@Headers('authorization') authHeader: string) {
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing Authorization header');
    }
    const token = authHeader.slice('Bearer '.length).trim();
    const { accessToken, wallet } = await this.auth.refreshToken(token);
    return { accessToken, wallet };
  }
}
