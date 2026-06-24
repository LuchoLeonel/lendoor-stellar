// src/common/guards/api-key.guard.ts
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { env } from 'src/config/env';

/**
 * Guard that validates the `X-Api-Key` request header against the
 * `RISK_API_KEY` environment variable.
 *
 * Used to protect internal endpoints that the risk-model Python service
 * calls (e.g. POST /notifications/risk-alert, POST /loans/mark-default).
 *
 * If `RISK_API_KEY` is empty the request is rejected — the guard will not
 * silently accept all traffic when the key is not configured.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const apiKey = env().RISK_API_KEY;

    if (!apiKey) {
      throw new UnauthorizedException('RISK_API_KEY is not configured');
    }

    const provided = request.headers['x-api-key'];
    if (!provided || provided !== apiKey) {
      throw new UnauthorizedException('Invalid or missing API key');
    }

    return true;
  }
}
