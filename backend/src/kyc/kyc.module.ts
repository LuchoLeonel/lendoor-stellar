// src/kyc/kyc.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from 'src/auth/auth.module';
import { User } from 'src/domain/entities/user.entity';
import { KYC_PROVIDER } from 'src/domain/ports/outbound/kyc-provider.port';
import { KycController } from 'src/infrastructure/http/kyc.controller';
import { FakeKycProvider } from './fake-kyc.provider';
import { KycService } from './kyc.service';

/**
 * D1.3 — modulo de KYC. El binding del puerto es el UNICO lugar que decide
 * el vendor: hoy FakeKycProvider (testnet); cuando el vendor real se
 * confirme, un useFactory sobre KYC_PROVIDER_NAME elige la implementacion
 * sin tocar nada mas (gate, service y controller son vendor-agnosticos).
 */
@Module({
  // AuthModule provee AuthService para el AccessTokenGuard del controller
  // (mismo patron que UserModule/ContractModule). Sin esto el boot real muere
  // con UnknownDependenciesException aunque la suite unitaria pase.
  imports: [TypeOrmModule.forFeature([User]), AuthModule],
  controllers: [KycController],
  providers: [
    FakeKycProvider,
    { provide: KYC_PROVIDER, useExisting: FakeKycProvider },
    KycService,
  ],
  exports: [KycService],
})
export class KycModule {}
