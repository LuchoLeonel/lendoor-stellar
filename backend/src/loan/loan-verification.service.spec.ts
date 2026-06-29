import { ForbiddenException } from '@nestjs/common';
import { Repository } from 'typeorm';

import { User } from 'src/domain/entities/user.entity';
import { BlockchainGatewayPort } from 'src/domain/ports/outbound/blockchain-gateway.port';
import { CreditPolicyService } from 'src/domain/services/credit-policy.service';
import { SelfService } from 'src/self/self.service';
import { UserService } from 'src/user/user.service';
import { LoanVerificationService } from './loan-verification.service';

describe('LoanVerificationService.verify', () => {
  const wallet = '0x0000000000000000000000000000000000000001';

  let userRepo: Pick<Repository<User>, 'findOne' | 'update'>;
  let userService: Pick<UserService, 'getUserUntilWaitlist' | 'isEarlyUser'>;
  let creditPolicy: Pick<CreditPolicyService, 'getStepForScore'>;
  let selfService: Pick<SelfService, 'ensureSelfVerificationForPlatform'>;
  let blockchain: Pick<
    BlockchainGatewayPort,
    'readCreditLimitOnChain' | 'giveCreditScoreAndLimit'
  >;
  let service: LoanVerificationService;

  function makeUser(overrides: Partial<User> = {}): User {
    return {
      id: 1,
      walletAddress: wallet,
      email: 'user@example.com',
      workType: 'employee',
      platform: 'webapp',
      termsAcceptedAt: new Date('2026-06-28T00:00:00Z'),
      createdAt: new Date('2026-06-28T00:00:00Z'),
      waitlistPriority: 0,
      score: null,
      creditLimit: null,
      ...overrides,
    } as User;
  }

  beforeEach(() => {
    userRepo = {
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
    };
    userService = {
      getUserUntilWaitlist: jest.fn().mockResolvedValue(0),
      isEarlyUser: jest.fn().mockResolvedValue(false),
    };
    creditPolicy = {
      getStepForScore: jest.fn().mockReturnValue({ limitUsdc: 1 }),
    };
    selfService = {
      ensureSelfVerificationForPlatform: jest.fn().mockResolvedValue(undefined),
    };
    blockchain = {
      readCreditLimitOnChain: jest.fn().mockResolvedValue(0n),
      giveCreditScoreAndLimit: jest.fn().mockResolvedValue(200),
    };

    service = new LoanVerificationService(
      userRepo as Repository<User>,
      userService as UserService,
      creditPolicy as CreditPolicyService,
      selfService as SelfService,
      blockchain as BlockchainGatewayPort,
    );
  });

  it('allows credit setup when waitlist access is disabled even if badge check is false', async () => {
    const user = makeUser();
    (userRepo.findOne as jest.Mock)
      .mockResolvedValueOnce(user)
      .mockResolvedValueOnce({ ...user, score: 1, creditLimit: 1 });

    await expect(
      service.verify({ walletAddress: wallet, platform: 'webapp' }),
    ).resolves.toMatchObject({
      verified: true,
      user: {
        id: user.id,
        walletAddress: wallet,
        score: 1,
        creditLimit: 1,
      },
    });

    expect(userService.getUserUntilWaitlist).toHaveBeenCalledWith('webapp');
    expect(userService.isEarlyUser).not.toHaveBeenCalled();
    expect(blockchain.giveCreditScoreAndLimit).toHaveBeenCalled();
  });

  it('rejects credit setup when a waitlist limit exists and the user is not early', async () => {
    const user = makeUser();
    (userRepo.findOne as jest.Mock).mockResolvedValue(user);
    (userService.getUserUntilWaitlist as jest.Mock).mockResolvedValue(1000);

    await expect(
      service.verify({ walletAddress: wallet, platform: 'webapp' }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(userService.isEarlyUser).toHaveBeenCalledWith(user, 'webapp');
    expect(blockchain.giveCreditScoreAndLimit).not.toHaveBeenCalled();
  });
});
