// src/user/dto/verify-opt.dto.ts
import { IsString, IsIn, IsOptional, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WALLET_ADDRESS_PATTERN } from 'src/common/normalize-wallet';

export class VerifyOtpDto {
  @ApiProperty({
    description: 'Wallet address of the user',
    example: 'GABC...',
  })
  @IsString()
  @Matches(WALLET_ADDRESS_PATTERN, { message: 'Invalid wallet address format' })
  walletAddress!: string;

  @ApiProperty({
    description: 'OTP code received by email',
    example: '482910',
  })
  @IsString()
  code!: string;

  @ApiProperty({
    description: 'Work type of the user',
    example: 'app_driver',
    enum: [
      'app_driver',
      'app_delivery',
      'creator',
      'freelance_cripto',
      'other_job',
      'no_job',
    ],
  })
  @IsString()
  @IsIn([
    'app_driver',
    'app_delivery',
    'creator',
    'freelance_cripto',
    'other_job',
    'no_job',
  ])
  workType!: string;

  @ApiPropertyOptional({
    description: 'Platform identifier',
    example: 'webapp',
    enum: ['lemon', 'farcaster', 'webapp'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['lemon', 'farcaster', 'webapp'])
  platform?: string;
}
