// src/self/self.service.spec.ts

// ---------------------------------------------------------------------------
// Module-level mock: @selfxyz/core must be mocked before any imports so the
// SelfService constructor does not attempt real network/crypto operations.
// ---------------------------------------------------------------------------
jest.mock('@selfxyz/core', () => {
  const mockVerifier = {
    verify: jest.fn(),
  };

  return {
    SelfBackendVerifier: jest.fn().mockImplementation(() => mockVerifier),
    AllIds: 'AllIds',
    DefaultConfigStore: jest.fn().mockImplementation(() => ({})),
    __mockVerifier: mockVerifier,
  };
});

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';

import { SelfService } from './self.service';
import { SelfVerification } from 'src/domain/entities/self-verification.entity';
import { User } from 'src/domain/entities/user.entity';

// Reach into the module-level mock to control verifier.verify per test
// eslint-disable-next-line @typescript-eslint/no-require-imports
const selfxyz = require('@selfxyz/core');
const mockVerifier: { verify: jest.Mock } = selfxyz.__mockVerifier;

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

const VALID_WALLET = '0xabcdef1234567890abcdef1234567890abcdef12';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 1,
    walletAddress: VALID_WALLET,
    email: 'user@example.com',
    firstName: null,
    lastName: null,
    birthdate: null,
    nationality: null,
    documentType: null,
    documentNumber: null,
    platform: 'webapp',
    xp: 1,
    waitlistPriority: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as User;
}

function makeSelfVerification(
  overrides: Partial<SelfVerification> = {},
): SelfVerification {
  return {
    id: 1,
    userId: 1,
    user: makeUser(),
    walletAddress: VALID_WALLET,
    verified: true,
    payload: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as SelfVerification;
}

// ---------------------------------------------------------------------------
// Mock repository builder
// ---------------------------------------------------------------------------

type MockRepo<_T = unknown> = {
  findOne: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
};

function mockRepo<T>(): MockRepo<T> {
  return {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// Minimal valid Self payload returned by verifier.verify
// ---------------------------------------------------------------------------

function makeVerifyResult(overrides: any = {}) {
  return {
    isValidDetails: { isValid: true },
    discloseOutput: {
      name: { given_name: 'Ana', family_name: 'Lopez' },
      date_of_birth: '1995-06-15',
      nationality: 'ARG',
      document_type: 'PASSPORT',
      passport_number: 'AAA111222',
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('SelfService', () => {
  let service: SelfService;
  let selfRepo: MockRepo<SelfVerification>;
  let userRepo: MockRepo<User>;

  beforeEach(async () => {
    // Set required env vars consumed by the SelfService constructor
    process.env.SELF_SCOPE = 'lendoor-test';
    process.env.BACKEND_URL = 'https://api.lendoor.xyz';
    process.env.SELF_MOCK_PASSPORT = 'false';

    selfRepo = mockRepo<SelfVerification>();
    userRepo = mockRepo<User>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SelfService,
        { provide: getRepositoryToken(SelfVerification), useValue: selfRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
      ],
    }).compile();

    service = module.get<SelfService>(SelfService);

    // Reset the shared mock verifier before each test
    mockVerifier.verify.mockReset();
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.SELF_SCOPE;
    delete process.env.BACKEND_URL;
    delete process.env.SELF_MOCK_PASSPORT;
  });

  // -------------------------------------------------------------------------
  // Constructor: required env vars
  // -------------------------------------------------------------------------

  describe('constructor', () => {
    it('throws when SELF_SCOPE is missing', async () => {
      delete process.env.SELF_SCOPE;

      await expect(
        Test.createTestingModule({
          providers: [
            SelfService,
            {
              provide: getRepositoryToken(SelfVerification),
              useValue: mockRepo(),
            },
            { provide: getRepositoryToken(User), useValue: mockRepo() },
          ],
        }).compile(),
      ).rejects.toThrow('SELF_SCOPE is required for SelfService');
    });
  });

  // -------------------------------------------------------------------------
  // verifyFromSelf — missing fields
  // -------------------------------------------------------------------------

  describe('verifyFromSelf — missing fields', () => {
    it('returns error when body is null', async () => {
      const result = await service.verifyFromSelf(null);

      expect(result.status).toBe('error');
      expect(result.result).toBe(false);
      expect(result.error_code).toBe('MISSING_FIELDS');
    });

    it('returns error when proof is missing', async () => {
      const result = await service.verifyFromSelf({
        attestationId: 'id',
        publicSignals: ['sig'],
        userContextData: VALID_WALLET,
      });

      expect(result.status).toBe('error');
      expect(result.error_code).toBe('MISSING_FIELDS');
    });

    it('returns error when publicSignals is missing', async () => {
      const result = await service.verifyFromSelf({
        attestationId: 'id',
        proof: { a: '1' },
        userContextData: VALID_WALLET,
      });

      expect(result.status).toBe('error');
      expect(result.error_code).toBe('MISSING_FIELDS');
    });

    it('returns error when attestationId is missing', async () => {
      const result = await service.verifyFromSelf({
        proof: { a: '1' },
        publicSignals: ['sig'],
        userContextData: VALID_WALLET,
      });

      expect(result.status).toBe('error');
      expect(result.error_code).toBe('MISSING_FIELDS');
    });

    it('returns error when userContextData is missing', async () => {
      const result = await service.verifyFromSelf({
        attestationId: 'id',
        proof: { a: '1' },
        publicSignals: ['sig'],
      });

      expect(result.status).toBe('error');
      expect(result.error_code).toBe('MISSING_FIELDS');
    });
  });

  // -------------------------------------------------------------------------
  // verifyFromSelf — verifier.verify throws
  // -------------------------------------------------------------------------

  describe('verifyFromSelf — verifier.verify throws', () => {
    it('returns error when verifier.verify throws an exception', async () => {
      mockVerifier.verify.mockRejectedValue(new Error('ZK proof invalid'));

      const result = await service.verifyFromSelf({
        attestationId: 'id',
        proof: { a: '1' },
        publicSignals: ['sig'],
        userContextData: VALID_WALLET,
      });

      expect(result.status).toBe('error');
      expect(result.result).toBe(false);
      expect(result.reason).toBe('ZK proof invalid');
      expect(result.error_code).toBe('VERIFY_EXCEPTION');
    });

    it('includes the first issue type in error_code when issues array is present', async () => {
      const err: any = new Error('Schema mismatch');
      err.issues = [{ type: 'SCHEMA_MISMATCH' }];
      mockVerifier.verify.mockRejectedValue(err);

      const result = await service.verifyFromSelf({
        attestationId: 'id',
        proof: { a: '1' },
        publicSignals: ['sig'],
        userContextData: VALID_WALLET,
      });

      expect(result.error_code).toBe('SCHEMA_MISMATCH');
    });
  });

  // -------------------------------------------------------------------------
  // verifyFromSelf — proof is invalid (isValid: false)
  // -------------------------------------------------------------------------

  describe('verifyFromSelf — verification fails', () => {
    it('returns error when isValid is false', async () => {
      mockVerifier.verify.mockResolvedValue({
        isValidDetails: { isValid: false, reason: 'age check failed' },
        discloseOutput: null,
      });

      const result = await service.verifyFromSelf({
        attestationId: 'id',
        proof: { a: '1' },
        publicSignals: ['sig'],
        userContextData: VALID_WALLET,
      });

      expect(result.status).toBe('error');
      expect(result.result).toBe(false);
      expect(result.error_code).toBe('VERIFICATION_FAILED');
    });
  });

  // -------------------------------------------------------------------------
  // verifyFromSelf — valid proof, no matching user
  // -------------------------------------------------------------------------

  describe('verifyFromSelf — valid proof but no User in DB', () => {
    it('returns success without syncing user data when wallet not found', async () => {
      mockVerifier.verify.mockResolvedValue(makeVerifyResult());
      userRepo.findOne.mockResolvedValue(null);

      const result = await service.verifyFromSelf({
        attestationId: 'id',
        proof: { a: '1' },
        publicSignals: ['sig'],
        userContextData: VALID_WALLET,
      });

      expect(result.status).toBe('success');
      expect(result.result).toBe(true);
      expect(userRepo.save).not.toHaveBeenCalled();
      expect(selfRepo.save).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // verifyFromSelf — valid proof, unrecognizable wallet in userContextData
  // -------------------------------------------------------------------------

  describe('verifyFromSelf — unrecognizable userContextData wallet', () => {
    it('returns success without syncing when userContextData is not a valid wallet', async () => {
      mockVerifier.verify.mockResolvedValue(makeVerifyResult());

      const result = await service.verifyFromSelf({
        attestationId: 'id',
        proof: { a: '1' },
        publicSignals: ['sig'],
        userContextData: 'not-a-wallet',
      });

      expect(result.status).toBe('success');
      expect(result.result).toBe(true);
      expect(userRepo.findOne).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // verifyFromSelf — valid proof, user found, new SelfVerification
  // -------------------------------------------------------------------------

  describe('verifyFromSelf — creates new SelfVerification', () => {
    it('saves user fields and creates a new SelfVerification record', async () => {
      const user = makeUser();
      mockVerifier.verify.mockResolvedValue(makeVerifyResult());
      userRepo.findOne.mockResolvedValue(user);
      selfRepo.findOne.mockResolvedValue(null); // no existing record
      selfRepo.create.mockImplementation((dto: any) => dto);
      selfRepo.save.mockImplementation((rec: any) => Promise.resolve(rec));
      userRepo.save.mockResolvedValue(user);

      const result = await service.verifyFromSelf({
        attestationId: 'id',
        proof: { a: '1' },
        publicSignals: ['sig'],
        userContextData: VALID_WALLET,
      });

      expect(result.status).toBe('success');
      expect(result.result).toBe(true);

      // User fields must have been updated
      expect(userRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          firstName: 'Ana',
          lastName: 'Lopez',
          birthdate: '1995-06-15',
          nationality: 'ARG',
          documentType: 'PASSPORT',
          documentNumber: 'AAA111222',
        }),
      );

      // A new SelfVerification must have been created
      expect(selfRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: user.id,
          walletAddress: VALID_WALLET,
          verified: true,
        }),
      );
      expect(selfRepo.save).toHaveBeenCalled();
    });

    it('strips null characters (\\u0000) from string payload fields', async () => {
      const payloadWithNulls = {
        isValidDetails: { isValid: true },
        discloseOutput: {
          name: { given_name: 'An\u0000a', family_name: 'Lo\u0000pez' },
          nationality: 'ARG',
        },
      };
      mockVerifier.verify.mockResolvedValue(payloadWithNulls);

      const user = makeUser();
      userRepo.findOne.mockResolvedValue(user);
      selfRepo.findOne.mockResolvedValue(null);
      selfRepo.create.mockImplementation((dto: any) => dto);
      selfRepo.save.mockResolvedValue({});
      userRepo.save.mockResolvedValue(user);

      await service.verifyFromSelf({
        attestationId: 'id',
        proof: { a: '1' },
        publicSignals: ['sig'],
        userContextData: VALID_WALLET,
      });

      expect(userRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          firstName: 'Ana',
          lastName: 'Lopez',
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // verifyFromSelf — valid proof, existing SelfVerification (update path)
  // -------------------------------------------------------------------------

  describe('verifyFromSelf — updates existing SelfVerification', () => {
    it('updates the existing record instead of creating a new one', async () => {
      const user = makeUser();
      const existing = makeSelfVerification({ verified: false });

      mockVerifier.verify.mockResolvedValue(makeVerifyResult());
      userRepo.findOne.mockResolvedValue(user);
      selfRepo.findOne.mockResolvedValue(existing);
      selfRepo.save.mockImplementation((rec: any) => Promise.resolve(rec));
      userRepo.save.mockResolvedValue(user);

      await service.verifyFromSelf({
        attestationId: 'id',
        proof: { a: '1' },
        publicSignals: ['sig'],
        userContextData: VALID_WALLET,
      });

      // create() must NOT be called (we're updating, not creating)
      expect(selfRepo.create).not.toHaveBeenCalled();

      // The existing record must have been saved with verified: true
      expect(selfRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ verified: true }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // verifyFromSelf — ABI-encoded wallet in userContextData
  // -------------------------------------------------------------------------

  describe('verifyFromSelf — ABI-encoded userContextData', () => {
    it('extracts wallet from ABI-encoded (128+ hex chars) userContextData', async () => {
      // ABI encoding: [chainId (32 bytes)][wallet (32 bytes, zero-padded left)]
      // chainId = 1, wallet = VALID_WALLET
      const chainIdHex =
        '0000000000000000000000000000000000000000000000000000000000000001';
      const walletHex = '000000000000000000000000' + VALID_WALLET.slice(2);
      const abiEncoded = '0x' + chainIdHex + walletHex;

      const user = makeUser();
      mockVerifier.verify.mockResolvedValue(makeVerifyResult());
      userRepo.findOne.mockResolvedValue(user);
      selfRepo.findOne.mockResolvedValue(null);
      selfRepo.create.mockImplementation((dto: any) => dto);
      selfRepo.save.mockResolvedValue({});
      userRepo.save.mockResolvedValue(user);

      const result = await service.verifyFromSelf({
        attestationId: 'id',
        proof: { a: '1' },
        publicSignals: ['sig'],
        userContextData: abiEncoded,
      });

      expect(result.status).toBe('success');
      expect(userRepo.findOne).toHaveBeenCalledWith({
        where: { walletAddress: VALID_WALLET },
      });
    });
  });

  // -------------------------------------------------------------------------
  // isUserSelfVerified
  // -------------------------------------------------------------------------

  describe('isUserSelfVerified', () => {
    it('returns true when a verified record exists for the userId', async () => {
      selfRepo.findOne.mockResolvedValue(
        makeSelfVerification({ verified: true }),
      );

      const result = await service.isUserSelfVerified(1);

      expect(result).toBe(true);
    });

    it('returns false when the record is not verified', async () => {
      selfRepo.findOne.mockResolvedValue(
        makeSelfVerification({ verified: false }),
      );

      const result = await service.isUserSelfVerified(1);

      expect(result).toBe(false);
    });

    it('returns false when no record exists', async () => {
      selfRepo.findOne.mockResolvedValue(null);

      const result = await service.isUserSelfVerified(1);

      expect(result).toBe(false);
    });

    it('returns false when userId is 0 (falsy)', async () => {
      const result = await service.isUserSelfVerified(0);

      expect(result).toBe(false);
      expect(selfRepo.findOne).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // getProfile
  // -------------------------------------------------------------------------

  describe('getProfile', () => {
    it('returns verified: false and null userId when no user exists for the wallet', async () => {
      userRepo.findOne.mockResolvedValue(null);

      const result = await service.getProfile(VALID_WALLET);

      expect(result).toEqual({
        walletAddress: VALID_WALLET,
        userId: null,
        verified: false,
        lastUpdatedAt: null,
        createdAt: null,
      });
    });

    it('returns verified: false when user exists but no SelfVerification record', async () => {
      userRepo.findOne.mockResolvedValue(makeUser());
      selfRepo.findOne.mockResolvedValue(null);

      const result = await service.getProfile(VALID_WALLET);

      expect(result.verified).toBe(false);
      expect(result.userId).toBe(1);
    });

    it('returns verified: true when user has a verified SelfVerification record', async () => {
      const user = makeUser();
      const record = makeSelfVerification({
        verified: true,
        createdAt: new Date('2026-02-01T00:00:00Z'),
        updatedAt: new Date('2026-03-01T00:00:00Z'),
      });

      userRepo.findOne.mockResolvedValue(user);
      selfRepo.findOne.mockResolvedValue(record);

      const result = await service.getProfile(VALID_WALLET);

      expect(result.verified).toBe(true);
      expect(result.userId).toBe(user.id);
      expect(result.walletAddress).toBe(VALID_WALLET);
      expect(result.createdAt).toEqual(record.createdAt);
      expect(result.lastUpdatedAt).toEqual(record.updatedAt);
    });

    it('normalizes the wallet address to lowercase', async () => {
      const mixedCaseWallet = '0xABCDEF1234567890ABCDEF1234567890ABCDEF12';
      userRepo.findOne.mockResolvedValue(null);

      const result = await service.getProfile(mixedCaseWallet);

      expect(result.walletAddress).toBe(mixedCaseWallet.toLowerCase());
    });

    it('throws BadRequestException for an invalid wallet address', async () => {
      await expect(service.getProfile('not-a-wallet')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // ensureSelfVerificationForPlatform
  // -------------------------------------------------------------------------

  describe('ensureSelfVerificationForPlatform', () => {
    it('throws BadRequestException when user is null', async () => {
      await expect(
        service.ensureSelfVerificationForPlatform(null as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('does nothing for a non-farcaster user even without a verification', async () => {
      const user = makeUser({ platform: 'lemon' });
      selfRepo.findOne.mockResolvedValue(null);

      await expect(
        service.ensureSelfVerificationForPlatform(user),
      ).resolves.toBeUndefined();
    });

    it('does nothing for a webapp user even without a verification', async () => {
      const user = makeUser({ platform: 'webapp' });
      selfRepo.findOne.mockResolvedValue(null);

      await expect(
        service.ensureSelfVerificationForPlatform(user),
      ).resolves.toBeUndefined();
    });

    it('throws 428 with SELF_VERIFICATION_REQUIRED_FOR_FARCASTER for unverified farcaster user', async () => {
      const user = makeUser({ platform: 'farcaster' });
      selfRepo.findOne.mockResolvedValue(null); // not verified

      await expect(
        service.ensureSelfVerificationForPlatform(user),
      ).rejects.toMatchObject({
        status: 428,
        response: expect.objectContaining({
          error_code: 'SELF_VERIFICATION_REQUIRED_FOR_FARCASTER',
        }),
      });
    });

    it('does nothing for a verified farcaster user', async () => {
      const user = makeUser({ platform: 'farcaster' });
      selfRepo.findOne.mockResolvedValue(
        makeSelfVerification({ verified: true }),
      );

      await expect(
        service.ensureSelfVerificationForPlatform(user),
      ).resolves.toBeUndefined();
    });
  });
});
