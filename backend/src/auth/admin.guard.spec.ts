import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AdminGuard, parseAdminWallets } from './admin.guard';

const ADMIN = '0x4CC122dFB13bA7888363C964dc0e53cb7153e185';
const NOT_ADMIN = '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function mockCtx(wallet: string | null | undefined): ExecutionContext {
  const req = wallet != null ? { user: { walletAddress: wallet } } : {};
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('parseAdminWallets', () => {
  it('returns empty array for undefined/null/empty', () => {
    expect(parseAdminWallets(undefined)).toEqual([]);
    expect(parseAdminWallets(null)).toEqual([]);
    expect(parseAdminWallets('')).toEqual([]);
  });

  it('parses a single wallet and lowercases it', () => {
    expect(parseAdminWallets(ADMIN)).toEqual([ADMIN.toLowerCase()]);
  });

  it('parses comma-separated list trimming whitespace', () => {
    const raw = ` ${ADMIN} ,  0xDeadBeef00000000000000000000000000000000 `;
    expect(parseAdminWallets(raw)).toEqual([
      ADMIN.toLowerCase(),
      '0xdeadbeef00000000000000000000000000000000',
    ]);
  });

  it('strips wrapping quotes (common when value is exported from .env)', () => {
    expect(parseAdminWallets(`"${ADMIN}"`)).toEqual([ADMIN.toLowerCase()]);
    expect(parseAdminWallets(`'${ADMIN}'`)).toEqual([ADMIN.toLowerCase()]);
  });

  it('drops empty slots from trailing commas', () => {
    expect(parseAdminWallets(`${ADMIN},,,`)).toEqual([ADMIN.toLowerCase()]);
  });
});

describe('AdminGuard', () => {
  let guard: AdminGuard;
  const originalEnv = process.env.ADMIN_WALLETS;

  beforeEach(() => {
    guard = new AdminGuard();
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.ADMIN_WALLETS;
    else process.env.ADMIN_WALLETS = originalEnv;
  });

  it('allows a whitelisted wallet (case-insensitive)', () => {
    process.env.ADMIN_WALLETS = ADMIN;
    expect(guard.canActivate(mockCtx(ADMIN.toUpperCase()))).toBe(true);
    expect(guard.canActivate(mockCtx(ADMIN.toLowerCase()))).toBe(true);
  });

  it('rejects a wallet not in the whitelist', () => {
    process.env.ADMIN_WALLETS = ADMIN;
    expect(() => guard.canActivate(mockCtx(NOT_ADMIN))).toThrow(
      ForbiddenException,
    );
  });

  it('rejects when req.user is missing (AccessTokenGuard did not run)', () => {
    process.env.ADMIN_WALLETS = ADMIN;
    expect(() => guard.canActivate(mockCtx(undefined))).toThrow(
      ForbiddenException,
    );
  });

  it('rejects everyone when ADMIN_WALLETS is not set (safe default)', () => {
    delete process.env.ADMIN_WALLETS;
    expect(() => guard.canActivate(mockCtx(ADMIN))).toThrow(ForbiddenException);
  });

  it('rejects everyone when ADMIN_WALLETS is empty string', () => {
    process.env.ADMIN_WALLETS = '';
    expect(() => guard.canActivate(mockCtx(ADMIN))).toThrow(ForbiddenException);
  });

  it('supports multiple admins in the comma-separated list', () => {
    const second = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    process.env.ADMIN_WALLETS = `${ADMIN},${second}`;
    expect(guard.canActivate(mockCtx(ADMIN))).toBe(true);
    expect(guard.canActivate(mockCtx(second.toUpperCase()))).toBe(true);
    expect(() => guard.canActivate(mockCtx(NOT_ADMIN))).toThrow(
      ForbiddenException,
    );
  });
});
