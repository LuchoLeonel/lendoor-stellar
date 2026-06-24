// src/app.module.ts
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { SentryModule, SentryGlobalFilter } from '@sentry/nestjs/setup';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import Redis from 'ioredis';
import { CacheModule } from '@nestjs/cache-manager';
import { BullModule } from '@nestjs/bullmq';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'crypto';
import KeyvRedis from '@keyv/redis';
import { env } from 'src/config/env';
import { WalletThrottlerGuard } from 'src/common/guards/wallet-throttler.guard';
import { join } from 'path';

import { User } from 'src/domain/entities/user.entity';
import { NotVerifiedUser } from 'src/domain/entities/not-verified-user.entity';
import { SiweNonce } from 'src/domain/entities/siwe-nonce.entity';
import { AccessToken } from 'src/domain/entities/access-token.entity';
import { Loan } from 'src/domain/entities/loan.entity';
import { DeviceSession } from 'src/domain/entities/device-session.entity';
import { BorrowAttempt } from 'src/domain/entities/borrow-attempt.entity';
import { ChainScanCursor } from 'src/domain/entities/chain-scan-cursor.entity';
import { Metric } from 'src/domain/entities/metric.entity';
import { LinkedExternalWallet } from 'src/domain/entities/linked-external-wallet.entity';
import { WalletLinkSession } from 'src/domain/entities/wallet-link-session.entity';
import { WalletLinkNonce } from 'src/domain/entities/wallet-link-nonce.entity';
import { SelfVerification } from 'src/domain/entities/self-verification.entity';

import { UserModule } from 'src/user/user.module';
import { ContractModule } from 'src/loan/loan.module';
import { AuthModule } from 'src/auth/auth.module';
import { AppController } from 'src/infrastructure/http/app.controller';
import { AppService } from 'src/app.service';
import { SelfModule } from 'src/self/self.module';
import { WalletLinkModule } from 'src/wallet-link/wallet-link.module';

@Module({
  imports: [
    // Must be first so Sentry captures errors from all other modules.
    SentryModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: env().LOG_LEVEL || 'info',
        genReqId: (req: {
          headers: Record<string, string | string[] | undefined>;
        }) => {
          // Only trust client-supplied correlation IDs if they are valid UUIDs.
          // Prevents log injection via crafted headers.
          const UUID_RE =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          const candidate =
            req.headers['x-correlation-id'] ?? req.headers['x-request-id'];
          const value = Array.isArray(candidate) ? candidate[0] : candidate;
          if (typeof value === 'string' && UUID_RE.test(value)) return value;
          return randomUUID();
        },
        serializers: {
          req: (req: { id: string; method: string; url: string }) => ({
            id: req.id,
            method: req.method,
            url: req.url,
          }),
          res: (res: { statusCode: number }) => ({
            statusCode: res.statusCode,
          }),
        },
        ...(env().NODE_ENV !== 'production' && {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, singleLine: true },
          },
        }),
      },
    }),
    ScheduleModule.forRoot(),

    ThrottlerModule.forRootAsync({
      useFactory: () => {
        const e = env();
        const redis = new Redis({
          host: e.REDIS_HOST,
          port: e.REDIS_PORT,
          ...(e.REDIS_PASSWORD && { password: e.REDIS_PASSWORD }),
        });
        return {
          throttlers: [
            { name: 'default', ttl: 60_000, limit: 30 },
            { name: 'admin', ttl: 60_000, limit: 600 },
          ],
          storage: new ThrottlerStorageRedisService(redis),
        };
      },
    }),

    // Redis-backed cache (global — all modules can inject CACHE_MANAGER)
    CacheModule.registerAsync({
      isGlobal: true,
      useFactory: () => {
        const e = env();
        const redisUrl = e.REDIS_PASSWORD
          ? `redis://:${e.REDIS_PASSWORD}@${e.REDIS_HOST}:${e.REDIS_PORT}`
          : `redis://${e.REDIS_HOST}:${e.REDIS_PORT}`;
        return {
          stores: [new KeyvRedis(redisUrl)],
          ttl: 60_000,
        };
      },
    }),

    BullModule.forRoot({
      connection: {
        host: env().REDIS_HOST,
        port: env().REDIS_PORT,
        ...(env().REDIS_PASSWORD && { password: env().REDIS_PASSWORD }),
        maxRetriesPerRequest: null, // required by BullMQ
      },
    }),

    // TypeORM
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.POSTGRES_HOST,
      port: Number(process.env.POSTGRES_PORT) || 5432,
      username: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      database: process.env.POSTGRES_DB,
      entities: [
        User,
        NotVerifiedUser,
        SiweNonce,
        AccessToken,
        Loan,
        SelfVerification,
        DeviceSession,
        BorrowAttempt,
        ChainScanCursor,
        Metric,
        LinkedExternalWallet,
        WalletLinkSession,
        WalletLinkNonce,
      ],
      synchronize: false,
      migrationsRun: true,
      migrationsTransactionMode: 'each',
      migrations: [join(__dirname, 'migrations/*.{js,ts}')],
      logging: ['error', 'warn'],
      ssl:
        process.env.POSTGRES_SSL === 'true'
          ? {
              rejectUnauthorized: process.env.POSTGRES_SSL_CA
                ? true
                : process.env.POSTGRES_SSL_STRICT === 'true',
              ca: process.env.POSTGRES_SSL_CA || undefined,
            }
          : false,
      extra: {
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      },
    }),
    // Metric repo needed by AppController for /health/db-chain-parity.
    TypeOrmModule.forFeature([Metric]),
    UserModule,
    ContractModule,
    AuthModule,
    SelfModule,
    WalletLinkModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Report all unhandled exceptions to Sentry (no-op when DSN is not set).
    { provide: APP_FILTER, useClass: SentryGlobalFilter },
    { provide: APP_GUARD, useClass: WalletThrottlerGuard },
  ],
})
export class AppModule {}
