// src/loan/dto/get-loan-terms.dto.ts
import { IsNotEmpty, IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GetLoanTermsDto {
  @ApiProperty({
    description: 'EVM wallet address of the borrower',
    example: '0xabc123...',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^0x[0-9a-fA-F]{40}$/, { message: 'Invalid wallet address format' })
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
