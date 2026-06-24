// src/wallet-link/wallet-link.module.ts — Spec 084 companion wallet link.
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { User } from 'src/domain/entities/user.entity';
import { LinkedExternalWallet } from 'src/domain/entities/linked-external-wallet.entity';
import { WalletLinkSession } from 'src/domain/entities/wallet-link-session.entity';
import { WalletLinkNonce } from 'src/domain/entities/wallet-link-nonce.entity';
import { AuthModule } from 'src/auth/auth.module';
import { WalletLinkService } from './wallet-link.service';
import { WalletLinkController } from './wallet-link.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      LinkedExternalWallet,
      WalletLinkSession,
      WalletLinkNonce,
    ]),
    AuthModule,
  ],
  controllers: [WalletLinkController],
  providers: [WalletLinkService],
  exports: [WalletLinkService],
})
export class WalletLinkModule {}
