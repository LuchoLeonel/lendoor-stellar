// src/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthService } from './auth.service';
import { AccessTokenGuard } from './access-token.guard';
import { AuthController } from 'src/infrastructure/http/auth.controller';

import { SiweNonce } from 'src/domain/entities/siwe-nonce.entity';
import { AccessToken } from 'src/domain/entities/access-token.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([SiweNonce, AccessToken]),
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [AuthService, AccessTokenGuard],
  exports: [AuthService, AccessTokenGuard],
})
export class AuthModule {}
