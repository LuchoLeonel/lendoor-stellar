// src/user/dto/verify-opt.dto.ts
import { IsString, IsIn, IsOptional, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class VerifyOtpDto {
  @ApiProperty({
    description: 'EVM wallet address of the user',
    example: '0xabc123...',
  })
  @IsString()
  @Matches(/^0x[0-9a-fA-F]{40}$/, { message: 'Invalid wallet address format' })
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
