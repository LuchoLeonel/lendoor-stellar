// src/loan/dto/repay-preflight.dto.ts
//
// Spec 024 A.4 — DTO for POST /loan/repay/preflight.
//
// Frontend calls this endpoint BEFORE the user signs the repay tx,
// to (a) ensure the on-chain L.amountDue is materialized fresh
// (via accrueLate) and (b) get the live-ticker payload.
import { IsString, IsNotEmpty, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RepayPreflightDto {
  /** Wallet EVM del borrower (0x...) */
  @ApiProperty({
    description: 'EVM wallet address of the borrower preparing to repay',
    example: '0xabc123...',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^0x[0-9a-fA-F]{40}$/, { message: 'Invalid wallet address format' })
  walletAddress!: string;
}
