import * as Sentry from '@sentry/nestjs';
import { env } from './env';

/**
 * Initialise Sentry. Must be called BEFORE NestFactory.create so that the
 * SDK can instrument all modules from the very start.
 * No-ops when SENTRY_DSN is not set (local / CI environments).
 */
export function initSentry(): void {
  const dsn = env().SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: env().NODE_ENV || 'development',
    // Capture 10 % of transactions for performance monitoring.
    tracesSampleRate: 0.1,
  });
}
