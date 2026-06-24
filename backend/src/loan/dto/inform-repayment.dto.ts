import { IsString, IsNotEmpty, IsOptional, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class InformRepaymentDto {
  /** Wallet EVM del usuario (0x...) */
  @ApiProperty({
    description: 'EVM wallet address of the user',
    example: '0xabc123...',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^0x[0-9a-fA-F]{40}$/, { message: 'Invalid wallet address format' })
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
    example: '0xtxhash...',
  })
  @IsOptional()
  @IsString()
  @Matches(/^0x[0-9a-fA-F]{64}$/, {
    message: 'Invalid transaction hash format',
  })
  txHash?: string;
}
