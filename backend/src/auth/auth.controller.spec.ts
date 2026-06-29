// src/auth/auth.controller.spec.ts

import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { AuthController } from 'src/infrastructure/http/auth.controller';
import { AuthService } from './auth.service';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const VALID_WALLET = '0x1234567890abcdef1234567890abcdef12345678';
const VALID_NONCE = 'abc123xyz';
const VALID_ACCESS_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.test.token';
const VALID_REFRESH_HEADER = `Bearer ${VALID_ACCESS_TOKEN}`;

const VERIFY_SIWE_DTO = {
  wallet: VALID_WALLET,
  signature: '0xsignature',
  message: 'Sign in with Ethereum',
  nonce: VALID_NONCE,
};

// ── Test suite ─────────────────────────────────────────────────────────────────

describe('AuthController', () => {
  let controller: AuthController;
  let authService: {
    createNonce: jest.Mock;
    verifySiweAndIssueToken: jest.Mock;
    verifyStellarAndIssueToken: jest.Mock;
    refreshToken: jest.Mock;
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    authService = {
      createNonce: jest.fn().mockResolvedValue(VALID_NONCE),
      verifySiweAndIssueToken: jest.fn().mockResolvedValue({
        wallet: VALID_WALLET,
        accessToken: VALID_ACCESS_TOKEN,
      }),
      verifyStellarAndIssueToken: jest.fn().mockResolvedValue({
        wallet: VALID_WALLET,
        accessToken: VALID_ACCESS_TOKEN,
      }),
      refreshToken: jest.fn().mockResolvedValue({
        accessToken: VALID_ACCESS_TOKEN,
        wallet: VALID_WALLET,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  // ── POST /auth/nonce ────────────────────────────────────────────────────────

  describe('getNonce', () => {
    it('calls authService.createNonce() and returns wrapped nonce', async () => {
      const result = await controller.getNonce();

      expect(authService.createNonce).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ nonce: VALID_NONCE });
    });
  });

  // ── POST /auth/verify ───────────────────────────────────────────────────────

  describe('verify', () => {
    it('calls authService.verifySiweAndIssueToken() with the full DTO', async () => {
      await controller.verify(VERIFY_SIWE_DTO);

      expect(authService.verifySiweAndIssueToken).toHaveBeenCalledTimes(1);
      expect(authService.verifySiweAndIssueToken).toHaveBeenCalledWith(
        VERIFY_SIWE_DTO,
      );
    });

    it('returns verified: true, wallet, and accessToken on success', async () => {
      const result = await controller.verify(VERIFY_SIWE_DTO);

      expect(result).toEqual({
        verified: true,
        wallet: VALID_WALLET,
        accessToken: VALID_ACCESS_TOKEN,
      });
    });
  });

  describe('verifyStellar', () => {
    it('calls authService.verifyStellarAndIssueToken() with the full DTO', async () => {
      const dto = {
        wallet: 'GABC',
        signature: 'base64-signature',
        message: 'base64-message',
        nonce: VALID_NONCE,
      };

      await controller.verifyStellar(dto);

      expect(authService.verifyStellarAndIssueToken).toHaveBeenCalledTimes(1);
      expect(authService.verifyStellarAndIssueToken).toHaveBeenCalledWith(dto);
    });
  });

  // ── POST /auth/refresh ──────────────────────────────────────────────────────

  describe('refresh', () => {
    it('calls authService.refreshToken() with the extracted bearer token', async () => {
      await controller.refresh(VALID_REFRESH_HEADER);

      expect(authService.refreshToken).toHaveBeenCalledTimes(1);
      expect(authService.refreshToken).toHaveBeenCalledWith(VALID_ACCESS_TOKEN);
    });

    it('returns accessToken and wallet on success', async () => {
      const result = await controller.refresh(VALID_REFRESH_HEADER);

      expect(result).toEqual({
        accessToken: VALID_ACCESS_TOKEN,
        wallet: VALID_WALLET,
      });
    });

    it('throws UnauthorizedException when Authorization header is missing', async () => {
      await expect(controller.refresh(undefined as any)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when Authorization header does not start with Bearer', async () => {
      await expect(controller.refresh('Basic sometoken')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
