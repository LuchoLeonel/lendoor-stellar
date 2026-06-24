import { IsString, IsNotEmpty, IsInt, IsIn, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class BorrowLoanDto {
  /** Human-readable amount, e.g. "50" for 50 USDC (6 decimals) */
  @ApiProperty({
    description: 'Human-readable loan amount in USDC (e.g. "50" = 50 USDC)',
    example: '50',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{1,10}(\.\d{1,6})?$/, {
    message:
      'amountHuman must be a number with up to 10 integer and 6 decimal digits',
  })
  amountHuman!: string;

  /** EVM address that will receive the funds (borrower wallet) */
  @ApiProperty({
    description: 'EVM address that will receive the funds (borrower wallet)',
    example: '0xabc123...',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^0x[0-9a-fA-F]{40}$/, { message: 'Invalid wallet address format' })
  receiver!: string;

  /** Loan tenor in days — only 7, 14, or 21 allowed */
  @ApiProperty({
    description: 'Loan tenor in days',
    example: 14,
    enum: [7, 14, 21],
  })
  @IsInt()
  @IsIn([7, 14, 21])
  tenorDays!: number;
}
