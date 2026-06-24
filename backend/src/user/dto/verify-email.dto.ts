// src/user/dto/verify-email.dto.ts
import { IsString, IsEmail, IsOptional, IsIn, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class VerifyEmailDto {
  @ApiProperty({
    description: 'EVM wallet address of the user',
    example: '0xabc123...',
  })
  @IsString()
  @Matches(/^0x[0-9a-fA-F]{40}$/, { message: 'Invalid wallet address format' })
  walletAddress!: string;

  @ApiProperty({
    description: 'Email address to verify',
    example: 'user@example.com',
  })
  @IsEmail()
  email!: string;

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
