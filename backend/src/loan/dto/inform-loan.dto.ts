import {
  IsString,
  IsNotEmpty,
  IsInt,
  IsIn,
  Matches,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import {
  CHAIN_TX_HASH_PATTERN,
  WALLET_ADDRESS_PATTERN,
} from 'src/common/normalize-wallet';

export class InformLoanDto {
  /** Wallet del usuario */
  @ApiProperty({
    description: 'Wallet address of the user',
    example: 'GABC...',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(WALLET_ADDRESS_PATTERN, { message: 'Invalid wallet address format' })
  walletAddress!: string;

  /** Monto prestado, human-readable, ej: "50" para 50 USDC */
  @ApiProperty({
    description: 'Borrowed amount in human-readable USDC (e.g. "50" = 50 USDC)',
    example: '50',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{1,10}(\.\d{1,6})?$/, {
    message:
      'amountHuman must be a number with up to 10 integer and 6 decimal digits',
  })
  amountHuman!: string;

  /** Plazo en dias — only 7, 14, or 21 allowed */
  @ApiProperty({
    description: 'Loan tenor in days',
    example: 14,
    enum: [7, 14, 21],
  })
  @IsInt()
  @IsIn([7, 14, 21])
  tenorDays!: number;

  /** tx hash de la tx de borrow — required para idempotencia */
  @ApiProperty({
    description: 'On-chain transaction hash of the borrow tx',
    example: '0123456789abcdef...',
  })
  @IsString()
  @IsNotEmpty({ message: 'txHash is required for idempotent loan creation' })
  @Matches(CHAIN_TX_HASH_PATTERN, {
    message: 'Invalid transaction hash format',
  })
  txHash!: string;
}
