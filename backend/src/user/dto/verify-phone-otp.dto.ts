import { IsString, IsNotEmpty, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyPhoneOtpDto {
  @ApiProperty({
    description: 'EVM wallet address of the user',
    example: '0xabc123...',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^0x[0-9a-fA-F]{40}$/, { message: 'Invalid wallet address format' })
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
