import { IsString, IsNotEmpty, IsInt, IsIn, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { WALLET_ADDRESS_PATTERN } from 'src/common/normalize-wallet';

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

  /** Wallet address that will receive the funds (borrower wallet) */
  @ApiProperty({
    description: 'Wallet address that will receive the funds (borrower wallet)',
    example: 'GABC...',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(WALLET_ADDRESS_PATTERN, { message: 'Invalid wallet address format' })
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
