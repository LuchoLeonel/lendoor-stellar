import { IsString, IsNotEmpty, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { WALLET_ADDRESS_PATTERN } from 'src/common/normalize-wallet';

export class VerifyPhoneOtpDto {
  @ApiProperty({
    description: 'Wallet address of the user',
    example: 'GABC...',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(WALLET_ADDRESS_PATTERN, { message: 'Invalid wallet address format' })
  walletAddress!: string;

  /** E.164 format: +5491112345678 */
  @ApiProperty({
    description: 'Phone number in E.164 format',
    example: '+5491112345678',
  })
  @IsString()
  @Matches(/^\+[1-9]\d{6,14}$/, {
    message: 'phone must be in E.164 format (e.g. +5491112345678)',
  })
  phone!: string;

  @ApiProperty({
    description: '6-digit OTP code received via SMS or WhatsApp',
    example: '482910',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{6}$/, { message: 'code must be a 6-digit number' })
  code!: string;
}
