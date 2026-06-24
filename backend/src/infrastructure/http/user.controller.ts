// src/infrastructure/http/user.controller.ts
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { UserService } from 'src/user/user.service';
import { VerifyEmailDto } from 'src/user/dto/verify-email.dto';
import { VerifyOtpDto } from 'src/user/dto/verify-opt.dto';
import { AcceptTermsDto } from 'src/user/dto/accept-terms.dto';
import { AccessTokenGuard } from 'src/auth/access-token.guard';
import { ResendOtpDto } from 'src/user/dto/resend-otp.dto';
import { VerifyPhoneDto } from 'src/user/dto/verify-phone.dto';
import { VerifyPhoneOtpDto } from 'src/user/dto/verify-phone-otp.dto';
import { ResendPhoneOtpDto } from 'src/user/dto/resend-phone-otp.dto';
import { CallerWallet } from 'src/common/caller-wallet.decorator';
import { assertWalletOwnership } from 'src/common/assert-wallet-ownership';
import { LemonProfileDto } from 'src/user/dto/lemon-profile.dto';

@ApiTags('user')
@ApiBearerAuth()
@Controller('user')
@UseGuards(AccessTokenGuard)
export class UserController {
  constructor(private readonly service: UserService) {}

  @Get(':wallet')
  @ApiOperation({ summary: 'Get onboarding step and profile for a wallet' })
  @ApiParam({
    name: 'wallet',
    description: 'EVM wallet address',
    example: '0xabc123...',
  })
  @ApiQuery({
    name: 'platform',
    required: false,
    description: 'Platform identifier',
    example: 'webapp',
  })
  @ApiResponse({
    status: 200,
    description: 'User profile and onboarding step returned',
  })
  @ApiResponse({
    status: 403,
    description: 'Caller is not the owner of this wallet',
  })
  async getByWallet(
    @Param('wallet') wallet: string,
    @Query('platform') platform?: string,
    @CallerWallet() caller?: string,
  ) {
    if (caller) assertWalletOwnership(caller, wallet);
    return this.service.getStepByWallet(wallet, platform);
  }

  @Post('accept-terms')
  @ApiOperation({ summary: 'Accept platform terms of service' })
  @ApiResponse({ status: 201, description: 'Terms accepted' })
  @ApiResponse({
    status: 403,
    description: 'Caller is not the owner of this wallet',
  })
  async acceptTerms(
    @Body() dto: AcceptTermsDto,
    @CallerWallet() caller: string,
  ) {
    assertWalletOwnership(caller, dto.walletAddress);
    return this.service.acceptTerms(dto.walletAddress, dto.platform);
  }

  @Post('join-waitlist')
  @ApiOperation({ summary: 'Join the waitlist with an email address' })
  @ApiResponse({ status: 201, description: 'Added to waitlist' })
  @ApiResponse({
    status: 403,
    description: 'Caller is not the owner of this wallet',
  })
  async joinWaitlist(
    @Body() dto: VerifyEmailDto,
    @CallerWallet() caller: string,
  ) {
    assertWalletOwnership(caller, dto.walletAddress);
    return this.service.joinWaitlist(
      dto.walletAddress,
      dto.email,
      dto.platform,
    );
  }

  @Post('verify-email')
  @ApiOperation({
    summary: 'Send an OTP to the provided email for verification',
  })
  @ApiResponse({ status: 201, description: 'OTP sent to email' })
  @ApiResponse({
    status: 403,
    description: 'Caller is not the owner of this wallet',
  })
  async verifyEmail(
    @Body() dto: VerifyEmailDto,
    @CallerWallet() caller: string,
  ) {
    assertWalletOwnership(caller, dto.walletAddress);
    return this.service.verifyEmail(dto.walletAddress, dto.email, dto.platform);
  }

  @Post('verify-otp')
  @ApiOperation({
    summary: 'Verify the email OTP and complete email verification',
  })
  @ApiResponse({ status: 201, description: 'Email verified successfully' })
  @ApiResponse({ status: 400, description: 'Invalid or expired OTP' })
  @ApiResponse({
    status: 403,
    description: 'Caller is not the owner of this wallet',
  })
  async verifyOtp(@Body() dto: VerifyOtpDto, @CallerWallet() caller: string) {
    assertWalletOwnership(caller, dto.walletAddress);
    return this.service.verifyOtp(
      dto.walletAddress,
      dto.code,
      dto.workType,
      dto.platform,
    );
  }

  @Post('resend-otp')
  @ApiOperation({ summary: 'Resend the email OTP' })
  @ApiResponse({ status: 201, description: 'OTP resent' })
  @ApiResponse({
    status: 403,
    description: 'Caller is not the owner of this wallet',
  })
  async resendOtp(@Body() dto: ResendOtpDto, @CallerWallet() caller: string) {
    assertWalletOwnership(caller, dto.walletAddress);
    return this.service.resendOtp(dto.walletAddress, dto.email);
  }

  @Post('verify-phone')
  @ApiOperation({ summary: 'Send an OTP to the provided phone number' })
  @ApiResponse({ status: 201, description: 'OTP sent to phone' })
  @ApiResponse({
    status: 403,
    description: 'Caller is not the owner of this wallet',
  })
  async verifyPhone(@Body() dto: VerifyPhoneDto, @CallerWallet() caller: string) {
    assertWalletOwnership(caller, dto.walletAddress);
    return this.service.verifyPhone(dto.walletAddress, dto.phone, dto.channel);
  }

  @Post('verify-phone-otp')
  @ApiOperation({
    summary: 'Verify the phone OTP and complete phone verification',
  })
  @ApiResponse({ status: 201, description: 'Phone verified successfully' })
  @ApiResponse({ status: 400, description: 'Invalid or expired OTP' })
  @ApiResponse({
    status: 403,
    description: 'Caller is not the owner of this wallet',
  })
  async verifyPhoneOtp(
    @Body() dto: VerifyPhoneOtpDto,
    @CallerWallet() caller: string,
  ) {
    assertWalletOwnership(caller, dto.walletAddress);
    return this.service.verifyPhoneOtp(dto.walletAddress, dto.phone, dto.code);
  }

  @Post('resend-phone-otp')
  @ApiOperation({ summary: 'Resend the phone OTP' })
  @ApiResponse({ status: 201, description: 'OTP resent to phone' })
  @ApiResponse({
    status: 403,
    description: 'Caller is not the owner of this wallet',
  })
  async resendPhoneOtp(
    @Body() dto: ResendPhoneOtpDto,
    @CallerWallet() caller: string,
  ) {
    assertWalletOwnership(caller, dto.walletAddress);
    return this.service.resendPhoneOtp(
      dto.walletAddress,
      dto.phone,
      dto.channel,
    );
  }

  @Post('update-phone')
  @ApiOperation({ summary: 'Initiate a phone number change (sends a new OTP)' })
  @ApiResponse({ status: 201, description: 'OTP sent to new phone number' })
  @ApiResponse({
    status: 403,
    description: 'Caller is not the owner of this wallet',
  })
  async updatePhone(@Body() dto: VerifyPhoneDto, @CallerWallet() caller: string) {
    assertWalletOwnership(caller, dto.walletAddress);
    return this.service.updatePhone(dto.walletAddress, dto.phone, dto.channel);
  }

  // Spec 044 — Lemon SDK identity claims
  @Post('lemon-profile')
  @ApiOperation({
    summary: 'Persist identity claims granted via Lemon authenticate()',
    description:
      'Idempotent upsert. Self KYC fields take precedence over Lemon claims when both exist.',
  })
  @ApiResponse({
    status: 201,
    description: 'Profile upserted; returns identityMatchScore if comparable',
  })
  @ApiResponse({
    status: 403,
    description: 'Caller is not the owner of this wallet',
  })
  async lemonProfile(
    @Body() dto: LemonProfileDto,
    @CallerWallet() caller: string,
  ) {
    assertWalletOwnership(caller, dto.walletAddress);
    return this.service.upsertLemonProfile({
      walletAddress: dto.walletAddress,
      firstName: dto.firstName,
      lastName: dto.lastName,
      email: dto.email,
      lemonTag: dto.lemonTag,
      pep: dto.pep,
      lemonCountry: dto.lemonCountry,
    });
  }
}
