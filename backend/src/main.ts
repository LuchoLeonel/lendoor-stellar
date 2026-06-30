// Sentry must be imported and initialised before any other application code
// so its auto-instrumentation hooks are in place from the very start.
import './instrument';

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { join } from 'path';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as express from 'express';
import { validateEnv } from './config/env';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  // Validate all env vars before anything else — fail fast with clear errors.
  const env = validateEnv();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));

  // Trust first proxy (Caddy) — required for req.ip to reflect X-Forwarded-For
  // so per-IP rate limiting works correctly for unauthenticated requests.
  app.set('trust proxy', 1);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Security headers (safe for Lemon/Farcaster WebView embedding)
  app.use(
    helmet({
      frameguard: false, // allow iframe embedding (Lemon Cash, Farcaster)
      contentSecurityPolicy: false, // don't block SDK scripts or RPC connections
    }),
  );

  // Body size limit: 1MB is more than enough for all API payloads (SIWE messages
  // are < 4KB, DTOs are < 1KB). Smaller limit reduces DoS surface.
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  const isProd = env.NODE_ENV === 'production';

  const corsOrigins = isProd
    ? ['https://lendoor.xyz', 'https://staging.lendoor.xyz',
        'https://stellar.lendoor.xyz', 'https://stellar.lendoor.xyz']
    : [
        'https://lendoor.xyz',
        'https://staging.lendoor.xyz',
        'https://stellar.lendoor.xyz',
        'http://localhost:3000',
        'http://localhost:5173',
        /\.trycloudflare\.com$/,
      ];
  app.enableCors({
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  app.useStaticAssets(join(__dirname, '..', 'public'));

  // Swagger only in local development. Staging and production should not
  // expose the full API surface publicly.
  if (env.NODE_ENV === 'development') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Lendoor API')
      .setDescription('Uncollateralized lending platform API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  await app.listen(env.PORT);
}
void bootstrap();
