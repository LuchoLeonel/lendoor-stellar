import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEmail,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ResendOtpDto {
  @ApiProperty({
    description: 'EVM wallet address of the user',
    example: '0xabc123...',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^0x[0-9a-fA-F]{40}$/, { message: 'Invalid wallet address format' })
  walletAddress!: string;

  @ApiPropertyOptional({
    description: 'Email address to resend OTP to',
    example: 'user@example.com',
  })
  @IsOptional()
  @IsEmail()
  email?: string;
}
