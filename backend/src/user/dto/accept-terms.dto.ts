// src/user/dto/accept-terms.dto.ts
import { IsString, IsOptional, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AcceptTermsDto {
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
  platform?: string;
}
