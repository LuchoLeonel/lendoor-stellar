// src/auth/access-token.guard.ts
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';

@Injectable()
export class AccessTokenGuard implements CanActivate {
  private readonly logger = new Logger(AccessTokenGuard.name);

  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();

    const authHeader = req.headers['authorization'] ?? null;

    this.logger.log(
      `Incoming ${req.method} ${req.url} | Authorization=${authHeader ?? 'NONE'}`,
    );

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      this.logger.warn('Missing or invalid Authorization header');
      throw new UnauthorizedException(
        'Missing or invalid Authorization header',
      );
    }

    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) {
      this.logger.warn('Empty bearer token');
      throw new UnauthorizedException('Empty bearer token');
    }

    try {
      const user = await this.authService.validateToken(token);
      (req as Request & { user: typeof user }).user = user;
      this.logger.log(`Token OK for wallet ${user.walletAddress}`);
      return true;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.error(`Token validation failed: ${message}`);
      throw e;
    }
  }
}
