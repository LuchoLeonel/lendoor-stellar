// src/loan/dto/verify-user.dto.ts
import { IsString, IsOptional, IsIn, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WALLET_ADDRESS_PATTERN } from 'src/common/normalize-wallet';

export class VerifyUserDto {
  @ApiProperty({
    description: 'Wallet address of the user',
    example: 'GABC...',
  })
  @IsString()
  @Matches(WALLET_ADDRESS_PATTERN, { message: 'Invalid wallet address format' })
  walletAddress!: string;

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
