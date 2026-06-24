// src/loan/dto/verify-user.dto.ts
import { IsString, IsOptional, IsIn, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class VerifyUserDto {
  @ApiProperty({
    description: 'EVM wallet address of the user',
    example: '0xabc123...',
  })
  @IsString()
  @Matches(/^0x[0-9a-fA-F]{40}$/, { message: 'Invalid wallet address format' })
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
