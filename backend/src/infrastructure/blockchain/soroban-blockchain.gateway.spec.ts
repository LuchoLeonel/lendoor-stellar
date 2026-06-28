const getEvents = jest.fn();
const getTransaction = jest.fn();
const fromScVal = jest.fn((value: unknown) => value);
const scAddress = jest.fn((address: string) => ({
  toXDR: () => `addr:${address}`,
}));
const scSymbol = jest.fn((value: string) => ({
  toXDR: () => `sym:${value}`,
}));

jest.mock('src/config/sorobanConfig', () => ({
  SOROBAN_LOAN_MANAGER: 'CLOANMANAGER',
  assertStellarAccount: jest.fn(),
  fromScVal,
  isLoanManagerContractEvent: jest.fn(() => true),
  scAddress,
  scBool: jest.fn(),
  scI128: jest.fn(),
  scSymbol,
  scU32: jest.fn(),
  scU64: jest.fn(),
  sendLoanManagerCall: jest.fn(),
  simulateLoanManagerCall: jest.fn(),
  sorobanServer: jest.fn(() => ({ getEvents, getTransaction })),
  toUnits: jest.fn((value: string | number | bigint) => BigInt(value)),
}));

import { SorobanBlockchainGateway } from './soroban-blockchain.gateway';

describe('SorobanBlockchainGateway event scans', () => {
  let gateway: SorobanBlockchainGateway;

  beforeEach(() => {
    gateway = new SorobanBlockchainGateway();
    getEvents.mockReset();
    getTransaction.mockReset();
    fromScVal.mockImplementation((value: unknown) => value);
    scAddress.mockClear();
    scSymbol.mockClear();
  });

  it('filters loan close events by event topic and borrower topic positions', async () => {
    getEvents.mockResolvedValueOnce({
      events: [],
      cursor: '',
    });

    await gateway.findLoanClosedEvent(
      'GBORROWER',
      new Date('2026-01-01T00:00:00.000Z'),
      120_000,
    );

    expect(getEvents).toHaveBeenCalledWith({
      startLedger: 20_000,
      endLedger: 120_000,
      filters: [
        {
          type: 'contract',
          contractIds: ['CLOANMANAGER'],
          topics: [['sym:loanclos'], ['addr:GBORROWER']],
        },
      ],
      limit: 1000,
    });
  });

  it('continues getEvents scans with the returned cursor', async () => {
    const firstPage = Array.from({ length: 1000 }, (_, i) => ({
      inSuccessfulContractCall: false,
      topic: [],
      value: null,
      ledger: i,
      txHash: `tx-${i}`,
      ledgerClosedAt: '2026-01-01T00:00:00.000Z',
    }));
    getEvents
      .mockResolvedValueOnce({ events: firstPage, cursor: 'cursor-1' })
      .mockResolvedValueOnce({
        events: [
          {
            inSuccessfulContractCall: true,
            topic: ['loanopen', 'GBORROWER'],
            value: [100n, 110n, 999n],
            ledger: 42,
            txHash: 'tx-final',
            ledgerClosedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        cursor: 'cursor-2',
      });

    const events = await gateway.getLoanOpenedEvents(1, 2);

    expect(getEvents).toHaveBeenNthCalledWith(1, {
      startLedger: 1,
      endLedger: 2,
      filters: [
        {
          type: 'contract',
          contractIds: ['CLOANMANAGER'],
          topics: [['sym:loanopen']],
        },
      ],
      limit: 1000,
    });
    expect(getEvents).toHaveBeenNthCalledWith(2, {
      filters: [
        {
          type: 'contract',
          contractIds: ['CLOANMANAGER'],
          topics: [['sym:loanopen']],
        },
      ],
      cursor: 'cursor-1',
      limit: 1000,
    });
    expect(events).toEqual([
      {
        borrower: 'GBORROWER',
        principal: 100n,
        amountDue: 110n,
        due: 999,
        feeBps: 1000,
        ledger: 42,
        txHash: 'tx-final',
        timestamp: 1767225600,
      },
    ]);
  });

  it('returns false when loan-open transaction events are absent', async () => {
    getTransaction.mockResolvedValueOnce({
      status: 'SUCCESS',
      events: undefined,
    });

    await expect(
      gateway.verifyLoanOpenedByTxHash('tx-open', 'GBORROWER'),
    ).resolves.toBe(false);
  });

  it('propagates loan-open transaction polling failures', async () => {
    getTransaction.mockRejectedValueOnce(new Error('RPC timeout'));

    await expect(
      gateway.verifyLoanOpenedByTxHash('tx-open', 'GBORROWER'),
    ).rejects.toThrow('RPC timeout');
  });
});
