// src/user/dto/lemon-profile.dto.ts
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WALLET_ADDRESS_PATTERN } from 'src/common/normalize-wallet';

/**
 * Spec 044 — payload accepted by `POST /user/lemon-profile`.
 *
 * Sent by the frontend after `lemonAuthenticate({ requirements: { claims }})`
 * resolves with `data.grantedClaims`. Each field is optional because the
 * user may grant only a subset of the 6 claims.
 */
export class LemonProfileDto {
  @ApiProperty({ description: 'Wallet address' })
  @IsString()
  @Matches(WALLET_ADDRESS_PATTERN, { message: 'Invalid wallet address format' })
  walletAddress!: string;

  @ApiPropertyOptional({ description: 'First name (NAME claim)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string | null;

  @ApiPropertyOptional({ description: 'Last name (LAST_NAME claim)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string | null;

  @ApiPropertyOptional({ description: 'Email (EMAIL claim)' })
  @IsOptional()
  @IsEmail()
  email?: string | null;

  @ApiPropertyOptional({ description: 'Lemon Cash handle (LEMONTAG claim)' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  lemonTag?: string | null;

  @ApiPropertyOptional({ description: 'Politically Exposed Person flag (IS_PEP claim)' })
  @IsOptional()
  @IsBoolean()
  pep?: boolean | null;

  @ApiPropertyOptional({
    description: 'Country (OPERATION_COUNTRY claim, ISO 3166-1 alpha-2 or alpha-3)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  lemonCountry?: string | null;
}
