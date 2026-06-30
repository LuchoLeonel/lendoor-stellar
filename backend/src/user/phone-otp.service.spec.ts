import { Repository } from 'typeorm';
import { User } from 'src/domain/entities/user.entity';
import { PhoneOtpService } from './phone-otp.service';

const WALLET = 'GAIRISXKPLOWZBMFRPU5XRGUUX3VMA3ZEWKBM5MSNRU3CHV6P4PYZ74D';

function makeRepo(overrides: Partial<Repository<User>> = {}) {
  return {
    update: jest.fn().mockResolvedValue(undefined),
    findOne: jest.fn(),
    ...overrides,
  } as unknown as Repository<User>;
}

describe('PhoneOtpService', () => {
  // No Kapso credentials in the test env → service uses the dev-log fallback,
  // so sendVerification never hits the network.
  beforeEach(() => {
    delete process.env.KAPSO_API_KEY;
    delete process.env.KAPSO_PHONE_NUMBER_ID;
  });

  describe('sendVerification', () => {
    it('persists a fresh 6-digit code with a ~10 min expiry', async () => {
      const repo = makeRepo();
      const service = new PhoneOtpService(repo);

      const before = Date.now();
      await service.sendVerification('+5491122334455', 'whatsapp', WALLET);

      expect(repo.update).toHaveBeenCalledTimes(1);
      const [where, patch] = (repo.update as jest.Mock).mock.calls[0];
      expect(where).toEqual({ walletAddress: WALLET });
      expect(patch.phoneOtpCode).toMatch(/^\d{6}$/);

      const expMs = (patch.phoneOtpExpiresAt as Date).getTime();
      // ~10 minutes out (allow scheduling slack).
      expect(expMs).toBeGreaterThan(before + 9 * 60_000);
      expect(expMs).toBeLessThan(before + 11 * 60_000);
    });
  });

  describe('checkVerification', () => {
    it('accepts a matching, unexpired code and then clears it', async () => {
      const repo = makeRepo({
        findOne: jest.fn().mockResolvedValue({
          walletAddress: WALLET,
          phoneOtpCode: '123456',
          phoneOtpExpiresAt: new Date(Date.now() + 5 * 60_000),
        }),
      });
      const service = new PhoneOtpService(repo);

      await expect(
        service.checkVerification('+549', '123456', WALLET),
      ).resolves.toBe(true);

      // On success the code is invalidated.
      expect(repo.update).toHaveBeenCalledWith(
        { walletAddress: WALLET },
        { phoneOtpCode: null, phoneOtpExpiresAt: null },
      );
    });

    it('rejects a wrong code (and does not clear)', async () => {
      const repo = makeRepo({
        findOne: jest.fn().mockResolvedValue({
          walletAddress: WALLET,
          phoneOtpCode: '123456',
          phoneOtpExpiresAt: new Date(Date.now() + 5 * 60_000),
        }),
      });
      const service = new PhoneOtpService(repo);

      await expect(
        service.checkVerification('+549', '000000', WALLET),
      ).resolves.toBe(false);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('rejects an expired code', async () => {
      const repo = makeRepo({
        findOne: jest.fn().mockResolvedValue({
          walletAddress: WALLET,
          phoneOtpCode: '123456',
          phoneOtpExpiresAt: new Date(Date.now() - 1_000),
        }),
      });
      const service = new PhoneOtpService(repo);

      await expect(
        service.checkVerification('+549', '123456', WALLET),
      ).resolves.toBe(false);
    });

    it('rejects when there is no stored code / no user', async () => {
      const repo = makeRepo({ findOne: jest.fn().mockResolvedValue(null) });
      const service = new PhoneOtpService(repo);

      await expect(
        service.checkVerification('+549', '123456', WALLET),
      ).resolves.toBe(false);
    });
  });
});
