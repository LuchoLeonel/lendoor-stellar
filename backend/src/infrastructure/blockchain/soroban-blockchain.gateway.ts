import { Injectable } from '@nestjs/common';
import {
  BlockchainGatewayPort,
  ChainLoanClosedEvent,
  ChainLoanOpenedEvent,
  TxPriority,
} from 'src/domain/ports/outbound/blockchain-gateway.port';
import {
  assertStellarAccount,
  fromScVal,
  isLoanManagerContractEvent,
  scAddress,
  scBool,
  scI128,
  scSymbol,
  scU32,
  scU64,
  sendLoanManagerCall,
  simulateLoanManagerCall,
  sorobanServer,
  SOROBAN_LOAN_MANAGER,
  toUnits,
} from 'src/config/sorobanConfig';

type SorobanLoan = {
  principal?: bigint;
  amount_due?: bigint;
  amountDue?: bigint;
  start?: bigint;
  due?: bigint;
  fee_bps?: number;
  feeBps?: number;
  grace_period?: bigint | number;
  gracePeriod?: bigint | number;
  active?: boolean;
};

type SorobanEventResponse = Awaited<
  ReturnType<ReturnType<typeof sorobanServer>['getEvents']>
>['events'][number];

type SorobanPremium = {
  premium_rate_per_sec_wad?: bigint;
  premiumRatePerSecWad?: bigint;
  late_rate_per_sec_wad?: bigint;
  lateRatePerSecWad?: bigint;
};

type SorobanUserRisk = {
  score?: number;
  valid_until?: bigint | number;
  validUntil?: bigint | number;
  limit?: bigint;
};

function nowPlus(seconds: number): number {
  return Math.floor(Date.now() / 1000) + seconds;
}

function eventTimestamp(ledgerClosedAt: string): number {
  const parsed = Date.parse(ledgerClosedAt);
  return Number.isFinite(parsed)
    ? Math.floor(parsed / 1000)
    : Math.floor(Date.now() / 1000);
}

function eventTopic(value: string): string {
  return scSymbol(value).toXDR('base64');
}

async function getContractEvents(
  startLedger: number,
  endLedger: number,
  topics: string[][],
): Promise<SorobanEventResponse[]> {
  const filters = [
    {
      type: 'contract' as const,
      contractIds: [SOROBAN_LOAN_MANAGER],
      topics,
    },
  ];
  const limit = 1000;
  const events: SorobanEventResponse[] = [];
  let cursor: string | null = null;

  do {
    const response = await sorobanServer().getEvents(
      cursor
        ? { filters, cursor, limit }
        : { filters, startLedger, endLedger, limit },
    );
    events.push(...response.events);
    if (!response.cursor || response.cursor === cursor) break;
    cursor = response.events.length === limit ? response.cursor : null;
  } while (cursor);

  return events;
}

function normalizeLoan(loan: SorobanLoan): {
  principal: bigint;
  amountDue: bigint;
  start: bigint;
  due: bigint;
  feeBps: number;
  gracePeriod: number;
  active: boolean;
} {
  const amountDue = loan.amount_due ?? loan.amountDue ?? 0n;
  const feeBps = loan.fee_bps ?? loan.feeBps ?? 0;
  const gracePeriod = loan.grace_period ?? loan.gracePeriod ?? 0;
  return {
    principal: loan.principal ?? 0n,
    amountDue,
    start: loan.start ?? 0n,
    due: loan.due ?? 0n,
    feeBps: Number(feeBps),
    gracePeriod: Number(gracePeriod),
    active: loan.active ?? false,
  };
}

function normalizePremium(premium: SorobanPremium): {
  premiumRatePerSecWad: bigint;
  lateRatePerSecWad: bigint;
} {
  return {
    premiumRatePerSecWad:
      premium.premium_rate_per_sec_wad ?? premium.premiumRatePerSecWad ?? 0n,
    lateRatePerSecWad:
      premium.late_rate_per_sec_wad ?? premium.lateRatePerSecWad ?? 0n,
  };
}

@Injectable()
export class SorobanBlockchainGateway implements BlockchainGatewayPort {
  async readCreditLimitOnChain(borrower: string): Promise<bigint> {
    assertStellarAccount(borrower);
    const value = await simulateLoanManagerCall<bigint>('credit_limit', [
      scAddress(borrower),
    ]);
    return value ?? 0n;
  }

  async giveCreditScoreAndLimit(
    borrower: string,
    score: number = 1,
    limit: bigint = toUnits(1, 6),
    kycOk: boolean = true,
    validUntil?: number,
    priority: TxPriority = 'low',
  ): Promise<number> {
    assertStellarAccount(borrower);
    if (!Number.isFinite(score) || score < 1 || score > 1000) {
      throw new Error(`Invalid score: ${score}. Must be between 1 and 1000.`);
    }

    const finalValidUntil = validUntil ?? nowPlus(30 * 24 * 60 * 60);
    if (limit < 0n) {
      throw new Error(`Invalid limit: ${limit}`);
    }
    await sendLoanManagerCall(
      'set_user_risk',
      [
        scAddress(borrower),
        scU32(score),
        scBool(kycOk),
        scU64(finalValidUntil),
        scI128(limit),
      ],
      'set_user_risk',
      priority,
    );
    return 200;
  }

  async createLoanOfferBackend(
    amountHuman: string | number | bigint,
    borrower: string,
    tenorDays: number,
    feeBps: number = 300,
    priority: TxPriority = 'low',
  ): Promise<{
    ok: boolean;
    feeBps: number;
    tenorDays: number;
    maxAmountBase: string;
    minedBlock: number;
  }> {
    assertStellarAccount(borrower);
    if (!Number.isInteger(tenorDays) || tenorDays <= 0) {
      throw new Error(`Invalid tenorDays: ${tenorDays}`);
    }
    if (!Number.isInteger(feeBps) || feeBps <= 0) {
      throw new Error(`Invalid feeBps: ${feeBps}`);
    }

    const maxAmount = toUnits(amountHuman, 6);
    if (maxAmount <= 0n) {
      throw new Error(`Invalid amountHuman: ${amountHuman}`);
    }
    const validUntil = nowPlus(3 * 24 * 60 * 60);
    const tx = await sendLoanManagerCall(
      'set_loan_offer',
      [
        scAddress(borrower),
        scU32(tenorDays),
        scU32(feeBps),
        scU64(validUntil),
        scI128(maxAmount),
      ],
      'set_loan_offer',
      priority,
    );

    return {
      ok: true,
      feeBps,
      tenorDays,
      maxAmountBase: maxAmount.toString(),
      minedBlock: tx.ledger,
    };
  }

  async setPremiumConfig(
    borrower: string,
    lateRatePerSecWad: bigint,
    priority: TxPriority = 'low',
  ): Promise<void> {
    assertStellarAccount(borrower);
    if (lateRatePerSecWad < 0n) {
      throw new Error(`Invalid lateRatePerSecWad: ${lateRatePerSecWad}`);
    }
    await sendLoanManagerCall(
      'set_premium_config',
      [scAddress(borrower), scI128(0n), scI128(lateRatePerSecWad)],
      'set_premium_config',
      priority,
    );
  }

  async previewLoanWithLate(borrower: string): Promise<bigint | null> {
    assertStellarAccount(borrower);
    try {
      const result = await simulateLoanManagerCall<[bigint, bigint]>(
        'preview_loan_with_late',
        [scAddress(borrower)],
      );
      return result?.[1] ?? null;
    } catch {
      return null;
    }
  }

  async readLoanOnChain(borrower: string): Promise<{
    active: boolean;
    principal: bigint;
    amountDue: bigint;
  } | null> {
    const loan = await this.readLoanFull(borrower);
    if (!loan) return null;
    return {
      active: loan.active,
      principal: loan.principal,
      amountDue: loan.amountDue,
    };
  }

  async readLoanFull(borrower: string): Promise<{
    principal: bigint;
    amountDue: bigint;
    start: bigint;
    due: bigint;
    feeBps: number;
    gracePeriod: number;
    active: boolean;
  } | null> {
    assertStellarAccount(borrower);
    try {
      const result = await simulateLoanManagerCall<SorobanLoan>('get_loan', [
        scAddress(borrower),
      ]);
      return normalizeLoan(result ?? {});
    } catch {
      return null;
    }
  }

  async readPremium(borrower: string): Promise<{
    premiumRatePerSecWad: bigint;
    lateRatePerSecWad: bigint;
  } | null> {
    assertStellarAccount(borrower);
    try {
      const result = await simulateLoanManagerCall<SorobanPremium>(
        'get_premium',
        [scAddress(borrower)],
      );
      return normalizePremium(result ?? {});
    } catch {
      return null;
    }
  }

  async readIsDefaulted(borrower: string): Promise<boolean | null> {
    assertStellarAccount(borrower);
    try {
      return await simulateLoanManagerCall<boolean>('is_defaulted', [
        scAddress(borrower),
      ]);
    } catch {
      return null;
    }
  }

  async getChainBlockTimestamp(): Promise<number | null> {
    try {
      const ledger = await sorobanServer().getLatestLedger();
      const numeric = Number(ledger.closeTime);
      if (Number.isFinite(numeric)) return numeric;
      const parsed = Date.parse(ledger.closeTime);
      return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
    } catch {
      return null;
    }
  }

  async getLatestLedger(): Promise<number> {
    const ledger = await sorobanServer().getLatestLedger();
    return ledger.sequence;
  }

  async readUserRisk(borrower: string): Promise<{
    score: number;
    validUntil: number;
    limit: bigint;
  } | null> {
    assertStellarAccount(borrower);
    try {
      const result = await simulateLoanManagerCall<SorobanUserRisk>(
        'get_user_risk',
        [scAddress(borrower)],
      );
      const validUntil = result.valid_until ?? result.validUntil ?? 0;
      return {
        score: Number(result.score ?? 0),
        validUntil: Number(validUntil),
        limit: result.limit ?? 0n,
      };
    } catch {
      return null;
    }
  }

  async getLoanOpenedEvents(
    fromLedger: number,
    toLedger: number,
  ): Promise<ChainLoanOpenedEvent[]> {
    const events = await getContractEvents(fromLedger, toLedger, [
      [eventTopic('loanopen')],
    ]);

    return events
      .filter((event) => event.inSuccessfulContractCall)
      .map((event) => {
        const topics = event.topic.map((topic) => fromScVal(topic));
        const [principal, amountDue, due] = fromScVal<[bigint, bigint, bigint]>(
          event.value,
        );
        const borrower = String(topics[1]);
        const feeBps =
          principal > 0n
            ? Number(((amountDue - principal) * 10000n) / principal)
            : 0;
        return {
          borrower,
          principal,
          amountDue,
          due: Number(due),
          feeBps,
          ledger: event.ledger,
          txHash: event.txHash,
          timestamp: eventTimestamp(event.ledgerClosedAt),
        };
      });
  }

  async findLoanClosedEvent(
    borrower: string,
    loanStartAt: Date,
    currentLedger: number,
  ): Promise<ChainLoanClosedEvent | null> {
    assertStellarAccount(borrower);
    const loanStartUnix = Math.floor(loanStartAt.getTime() / 1000);
    const startLedger = Math.max(0, currentLedger - 100_000);
    const events = await getContractEvents(startLedger, currentLedger, [
      [eventTopic('loanclos')],
      [scAddress(borrower).toXDR('base64')],
    ]);

    const matches = events
      .filter((event) => event.inSuccessfulContractCall)
      .map((event) => ({
        event,
        timestamp: eventTimestamp(event.ledgerClosedAt),
      }))
      .filter(({ timestamp }) => timestamp >= loanStartUnix)
      .sort(
        (a, b) => b.timestamp - a.timestamp || b.event.ledger - a.event.ledger,
      );

    const match = matches[0];
    if (!match) return null;
    return {
      borrower,
      amountPaid: fromScVal<bigint>(match.event.value),
      txHash: match.event.txHash,
      ledger: match.event.ledger,
      timestamp: match.timestamp,
    };
  }

  async verifyLoanOpenedByTxHash(
    txHash: string,
    borrower: string,
  ): Promise<boolean> {
    assertStellarAccount(borrower);
    let tx: Awaited<
      ReturnType<ReturnType<typeof sorobanServer>['getTransaction']>
    > | null = null;
    for (let attempt = 1; attempt <= 10; attempt++) {
      tx = await sorobanServer().getTransaction(txHash);
      if (tx.status !== 'NOT_FOUND') break;
      if (attempt < 10) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    if (!tx) return false;
    if (tx.status !== 'SUCCESS') return false;

    for (const group of tx.events?.contractEventsXdr ?? []) {
      for (const event of group) {
        if (!isLoanManagerContractEvent(event)) continue;
        const body = event.body().v0();
        const topics = body.topics().map((topic) => fromScVal(topic));
        if (topics[0] === 'loanopen' && topics[1] === borrower) return true;
      }
    }
    return false;
  }

  async accrueLate(
    borrower: string,
    priority: TxPriority = 'high',
  ): Promise<void> {
    assertStellarAccount(borrower);
    await sendLoanManagerCall(
      'accrue_late',
      [scAddress(borrower)],
      'accrue_late',
      priority,
    );
  }

  async verifyRepayByTxHash(
    txHash: string,
    borrower: string,
  ): Promise<{
    verified: boolean;
    reason?: 'no_receipt' | 'reverted' | 'no_match' | 'rpc_error';
    blockNumber?: number;
    paidUnits?: bigint;
  }> {
    assertStellarAccount(borrower);
    try {
      let tx: Awaited<
        ReturnType<ReturnType<typeof sorobanServer>['getTransaction']>
      > | null = null;
      for (let attempt = 1; attempt <= 10; attempt++) {
        tx = await sorobanServer().getTransaction(txHash);
        if (tx.status !== 'NOT_FOUND') break;
        if (attempt < 10) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }

      if (!tx) return { verified: false, reason: 'no_receipt' };
      if (tx.status === 'NOT_FOUND') {
        return { verified: false, reason: 'no_receipt' };
      }
      if (tx.status === 'FAILED') {
        return { verified: false, reason: 'reverted' };
      }

      for (const group of tx.events?.contractEventsXdr ?? []) {
        for (const event of group) {
          if (!isLoanManagerContractEvent(event)) continue;
          const body = event.body().v0();
          const topics = body.topics().map((topic) => fromScVal(topic));
          if (topics[0] !== 'loanclos' || topics[1] !== borrower) continue;
          const paid = fromScVal<bigint>(body.data());
          return {
            verified: true,
            blockNumber: tx.ledger,
            paidUnits: paid,
          };
        }
      }

      return { verified: false, reason: 'no_match', blockNumber: tx.ledger };
    } catch {
      return { verified: false, reason: 'rpc_error' };
    }
  }
}
