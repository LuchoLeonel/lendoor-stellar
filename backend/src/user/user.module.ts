// src/user/user.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { User } from 'src/domain/entities/user.entity';
import { NotVerifiedUser } from 'src/domain/entities/not-verified-user.entity';
import { Loan } from 'src/domain/entities/loan.entity';
import { AuthModule } from 'src/auth/auth.module';
import { UserController } from 'src/infrastructure/http/user.controller';
import { UserService } from './user.service';
import { UserQueryService } from './user-query.service';
import { UserOnboardingService } from './user-onboarding.service';
import { EarlyAccessService } from './early-access.service';
import { PhoneVerificationService } from './phone-verification.service';
import { PhoneOtpService } from './phone-otp.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, NotVerifiedUser, Loan]),
    AuthModule,
  ],
  controllers: [UserController],
  providers: [
    UserService,
    UserQueryService,
    UserOnboardingService,
    EarlyAccessService,
    PhoneVerificationService,
    PhoneOtpService,
  ],
  exports: [
    UserService,
    UserQueryService,
    UserOnboardingService,
    EarlyAccessService,
  ],
})
export class UserModule {}
