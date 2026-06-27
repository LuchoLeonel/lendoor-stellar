import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEmail,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WALLET_ADDRESS_PATTERN } from 'src/common/normalize-wallet';

export class ResendOtpDto {
  @ApiProperty({
    description: 'Wallet address of the user',
    example: 'GABC...',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(WALLET_ADDRESS_PATTERN, { message: 'Invalid wallet address format' })
  walletAddress!: string;

  @ApiPropertyOptional({
    description: 'Email address to resend OTP to',
    example: 'user@example.com',
  })
  @IsOptional()
  @IsEmail()
  email?: string;
}
