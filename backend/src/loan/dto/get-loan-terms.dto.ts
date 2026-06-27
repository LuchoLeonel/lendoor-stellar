// src/loan/dto/get-loan-terms.dto.ts
import { IsNotEmpty, IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { WALLET_ADDRESS_PATTERN } from 'src/common/normalize-wallet';

export class GetLoanTermsDto {
  @ApiProperty({
    description: 'Wallet address of the borrower',
    example: 'GABC...',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(WALLET_ADDRESS_PATTERN, { message: 'Invalid wallet address format' })
  walletAddress!: string;

  @ApiProperty({
    description: 'Loan amount in human-readable form (no commas)',
    example: '1000',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{1,10}(\.\d{1,6})?$/, {
    message:
      'amountHuman must be a number with up to 10 integer and 6 decimal digits',
  })
  amountHuman!: string;
}
