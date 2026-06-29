// src/loan/dto/repay-preflight.dto.ts
//
// Spec 024 A.4 — DTO for POST /loan/repay/preflight.
//
// Frontend calls this endpoint BEFORE the user signs the repay tx,
// to (a) ensure the on-chain L.amountDue is materialized fresh
// (via accrueLate) and (b) get the live-ticker payload.
import { IsString, IsNotEmpty, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { WALLET_ADDRESS_PATTERN } from 'src/common/normalize-wallet';

export class RepayPreflightDto {
  /** Wallet del borrower */
  @ApiProperty({
    description: 'Wallet address of the borrower preparing to repay',
    example: 'GABC...',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(WALLET_ADDRESS_PATTERN, { message: 'Invalid wallet address format' })
  walletAddress!: string;
}
