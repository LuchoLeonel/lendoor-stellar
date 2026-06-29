import { IsString, IsNotEmpty, IsOptional, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CHAIN_TX_HASH_PATTERN,
  WALLET_ADDRESS_PATTERN,
} from 'src/common/normalize-wallet';

export class InformRepaymentDto {
  /** Wallet del usuario */
  @ApiProperty({
    description: 'Wallet address of the user',
    example: 'GABC...',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(WALLET_ADDRESS_PATTERN, { message: 'Invalid wallet address format' })
  walletAddress!: string;

  /** Monto efectivamente pagado (total), human-readable, ej: "52.35" */
  @ApiProperty({
    description: 'Total amount paid in human-readable USDC (e.g. "52.35")',
    example: '52.35',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{1,10}(\.\d{1,6})?$/, {
    message:
      'amountPaidHuman must be a number with up to 10 integer and 6 decimal digits',
  })
  amountPaidHuman!: string;

  /** Opcional: tx hash de la tx de repay */
  @ApiPropertyOptional({
    description: 'On-chain transaction hash of the repayment tx',
    example: '0123456789abcdef...',
  })
  @IsOptional()
  @IsString()
  @Matches(CHAIN_TX_HASH_PATTERN, {
    message: 'Invalid transaction hash format',
  })
  txHash?: string;
}
