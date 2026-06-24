// This file must be the very first import in main.ts.
// Sentry needs to instrument modules before they are loaded by NestJS.
import { validateEnv } from './config/env';
import { initSentry } from './config/sentry';

// Ensure env is validated first (idempotent if called again in bootstrap).
validateEnv();
initSentry();
