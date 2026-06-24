// src/infrastructure/http/loan.controller.ts
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { LoanService } from 'src/loan/loan.service';
import { CreditPolicyService } from 'src/domain/services/credit-policy.service';

import { VerifyUserDto } from 'src/loan/dto/verify-user.dto';
import { BorrowLoanDto } from 'src/loan/dto/borrow-loan.dto';
import { InformLoanDto } from 'src/loan/dto/inform-loan.dto';
import { InformRepaymentDto } from 'src/loan/dto/inform-repayment.dto';
import { RepayPreflightDto } from 'src/loan/dto/repay-preflight.dto';
import { GetLoanTermsDto } from 'src/loan/dto/get-loan-terms.dto';
import { Throttle } from '@nestjs/throttler';
import { AccessTokenGuard } from 'src/auth/access-token.guard';
import { CallerWallet } from 'src/common/caller-wallet.decorator';
import { assertWalletOwnership } from 'src/common/assert-wallet-ownership';

@ApiTags('loan')
@ApiBearerAuth()
@Controller('loan')
@UseGuards(AccessTokenGuard)
export class LoanController {
  private readonly logger = new Logger(LoanController.name);

  constructor(
    private readonly service: LoanService,
    private readonly creditPolicy: CreditPolicyService,
  ) {}

  /**
   * Returns the full credit tier ladder. Requires auth.
   */
  @Get('ladder')
  @ApiOperation({
    summary: 'Get the full credit tier ladder (gamification roadmap)',
  })
  @ApiResponse({ status: 200, description: 'Credit tier ladder returned' })
  getLadder() {
    return this.creditPolicy.getLadder();
  }

  @Post('verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Submit wallet for credit verification' })
  @ApiResponse({ status: 200, description: 'Verification submitted successfully' })
  @ApiResponse({ status: 403, description: 'Caller is not the owner of this wallet' })
  async verify(@Body() dto: VerifyUserDto, @CallerWallet() caller: string) {
    assertWalletOwnership(caller, dto.walletAddress);
    return this.service.submitAndVerify(dto);
  }

  @Post('borrow')
  @HttpCode(200)
  @ApiOperation({ summary: 'Request an on-chain loan disbursement' })
  @ApiResponse({ status: 200, description: 'Loan disbursement initiated' })
  @ApiResponse({ status: 403, description: 'Caller is not the owner of this wallet' })
  async borrow(
    @Body() dto: BorrowLoanDto,
    @CallerWallet() caller: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    @Req() _req: unknown,
  ) {
    assertWalletOwnership(caller, dto.receiver);
    return this.service.borrow(dto);
  }

  @Throttle({ default: { ttl: 60_000, limit: 2 } })
  @Post('inform-open')
  @HttpCode(200)
  @ApiOperation({ summary: 'Inform the backend that a loan was opened on-chain' })
  @ApiResponse({ status: 200, description: 'Loan record created in the database' })
  @ApiResponse({ status: 403, description: 'Caller is not the owner of this wallet' })
  async informLoanOpen(
    @Body() dto: InformLoanDto,
    @CallerWallet() caller: string,
  ) {
    assertWalletOwnership(caller, dto.walletAddress);
    return this.service.informLoanOpened(dto);
  }

  @Throttle({ default: { ttl: 60_000, limit: 2 } })
  @Post('inform-repayment')
  @HttpCode(200)
  @ApiOperation({ summary: 'Inform the backend that a loan has been fully repaid' })
  @ApiResponse({ status: 200, description: 'Loan updated to repaid and credit score adjusted' })
  @ApiResponse({ status: 403, description: 'Caller is not the owner of this wallet' })
  async informRepayment(
    @Body() dto: InformRepaymentDto,
    @CallerWallet() caller: string,
  ) {
    assertWalletOwnership(caller, dto.walletAddress);
    return this.service.informRepayment(dto);
  }

  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  @Post('repay/preflight')
  @HttpCode(200)
  @ApiOperation({ summary: 'Preflight a repay: refresh on-chain accrued amount + live ticker payload' })
  @ApiResponse({ status: 200, description: 'Preflight payload returned' })
  @ApiResponse({ status: 403, description: 'Caller is not the owner of this wallet' })
  @ApiResponse({ status: 404, description: 'No active loan for this wallet' })
  @ApiResponse({ status: 503, description: 'On-chain RPC unavailable' })
  async repayPreflight(
    @Body() dto: RepayPreflightDto,
    @CallerWallet() caller: string,
    @Query('force') forceQuery?: string,
  ) {
    assertWalletOwnership(caller, dto.walletAddress);
    const force = forceQuery === 'true' || forceQuery === '1';
    const p = await this.service.preflightRepayment(dto.walletAddress, { force });
    return {
      wallet: p.wallet,
      principal: p.principal.toString(),
      storedAmountDueBefore: p.storedAmountDueBefore.toString(),
      accruedAmountDue: p.accruedAmountDue.toString(),
      lastAccruedTs: p.lastAccruedTs,
      ratePerSecWad: p.ratePerSecWad.toString(),
      baseFeeBps: p.baseFeeBps,
      dueAt: p.dueAt,
      gracePeriod: p.gracePeriod,
      lateStart: p.lateStart,
      serverNowUnix: p.serverNowUnix,
      chainNowUnix: p.chainNowUnix,
      perDayDelta: p.perDayDelta,
      daysLate: p.daysLate,
      daysToDefault: p.daysToDefault,
      isDefaulted: p.isDefaulted,
      accrueLateCalled: p.accrueLateCalled,
      accrueLateSkippedReason: p.accrueLateSkippedReason,
    };
  }

  @Post('loan-terms')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get loan terms for a given wallet and amount' })
  @ApiResponse({ status: 200, description: 'Loan terms returned' })
  @ApiResponse({ status: 403, description: 'Caller is not the owner of this wallet' })
  async getLoanTerms(
    @Body() dto: GetLoanTermsDto,
    @CallerWallet() caller: string,
  ) {
    assertWalletOwnership(caller, dto.walletAddress);
    return this.service.getLoanTerms(dto.walletAddress, dto.amountHuman);
  }
}
