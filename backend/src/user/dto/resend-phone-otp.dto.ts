import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsIn,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ResendPhoneOtpDto {
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

  @ApiPropertyOptional({
    description: 'Delivery channel for OTP',
    example: 'whatsapp',
    enum: ['whatsapp', 'sms'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['whatsapp', 'sms'])
  channel?: 'whatsapp' | 'sms';
}
