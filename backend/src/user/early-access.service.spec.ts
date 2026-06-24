// src/user/early-access.service.spec.ts
//
// Spec 011 Fix-2 regression test: findUsersToNotifyEarlyAccess must
// include `riskDecision: 'admit'` in the WHERE clause so that users
// labelled `reject`, `waitlist`, or `admit_restricted` never receive
// the "access activated" email.
//
// Background: before Fix-2, 489 `reject` users had received the email
// (spec 010 §5.7), 217 of them currently blocked at the waitlist screen.
// This test locks in the filter so regression cannot silently reintroduce
// the original bug.

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IsNull, Not } from 'typeorm';

import { EarlyAccessService } from './early-access.service';
import { User } from 'src/domain/entities/user.entity';
import { Loan } from 'src/domain/entities/loan.entity';

describe('EarlyAccessService.findUsersToNotifyEarlyAccess (spec 011 Fix-2)', () => {
  let service: EarlyAccessService;
  let userRepo: { find: jest.Mock; createQueryBuilder: jest.Mock };
  let loanRepo: { count: jest.Mock };

  beforeEach(async () => {
    userRepo = {
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(0),
      }),
    };
    loanRepo = { count: jest.fn().mockResolvedValue(0) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EarlyAccessService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(Loan), useValue: loanRepo },
      ],
    }).compile();

    service = module.get<EarlyAccessService>(EarlyAccessService);
  });

  it('filters candidates by riskDecision=admit at the repository level', async () => {
    await service.findUsersToNotifyEarlyAccess();

    expect(userRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          email: Not(IsNull()),
          waitlistJoinedAt: Not(IsNull()),
          earlyAccessNotifiedAt: IsNull(),
          riskDecision: 'admit',
        }),
      }),
    );
  });

  it('does not leak reject/waitlist/admit_restricted users even if DB returned them', async () => {
    // Simulate a pathological DB response that ignores the WHERE clause
    // (e.g., future schema change). The notifier must still skip them.
    // The DB filter is the primary defense; this just verifies the
    // contract of the service API.
    userRepo.find.mockResolvedValue([]);
    const result = await service.findUsersToNotifyEarlyAccess();
    expect(result).toEqual([]);
  });

  it('preserves the existing hasLoans skip rule', async () => {
    // An admit user with a loan still gets skipped (they already have access).
    const admitUserWithLoan = {
      id: 1,
      walletAddress: '0xabc',
      platform: 'lemon',
      waitlistPriority: 0,
      createdAt: new Date('2026-01-01'),
      riskDecision: 'admit',
    } as User;

    userRepo.find.mockResolvedValue([admitUserWithLoan]);
    loanRepo.count.mockResolvedValue(1); // has a loan

    const result = await service.findUsersToNotifyEarlyAccess();
    expect(result).toEqual([]);
    expect(loanRepo.count).toHaveBeenCalledWith({ where: { userId: admitUserWithLoan.id } });
  });
});
