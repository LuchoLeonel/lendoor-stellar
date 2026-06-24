import {
  IsString,
  IsNotEmpty,
  IsInt,
  IsIn,
  Matches,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class InformLoanDto {
  /** Wallet EVM del usuario (0x...) */
  @ApiProperty({
    description: 'EVM wallet address of the user',
    example: '0xabc123...',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^0x[0-9a-fA-F]{40}$/, { message: 'Invalid wallet address format' })
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
    example: '0xtxhash...',
  })
  @IsString()
  @IsNotEmpty({ message: 'txHash is required for idempotent loan creation' })
  @Matches(/^0x[0-9a-fA-F]{64}$/, {
    message: 'Invalid transaction hash format',
  })
  txHash!: string;
}
