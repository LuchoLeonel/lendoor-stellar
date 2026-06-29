// src/infrastructure/blockchain/ethers-blockchain.gateway.ts
import { Injectable } from '@nestjs/common';
import {
  Contract,
  EventLog,
  getAddress,
  Interface,
  id,
  zeroPadValue,
} from 'ethers';
import {
  BlockchainGatewayPort,
  ChainLoanClosedEvent,
  ChainLoanOpenedEvent,
  TxPriority,
} from 'src/domain/ports/outbound/blockchain-gateway.port';
import LoanManagerAbi from '../../abi/LoanManagerV3.abi.json';

async function contractConfig() {
  return import('../../config/contractConfig');
}

const USDC_DECIMALS = 6;
const CELO_BLOCK_TIME_SEC = 1;
const MAX_BLOCK_RANGE = 10_000;
const LOAN_MANAGER_IFACE = new Interface(LoanManagerAbi);
const LOAN_OPENED_TOPIC =
  LOAN_MANAGER_IFACE.getEvent('LoanOpened')!.topicHash.toLowerCase();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class EthersBlockchainGateway implements BlockchainGatewayPort {
  readCreditLimitOnChain(borrower: string): Promise<bigint> {
    return contractConfig().then((c) => c.readCreditLimitOnChain(borrower));
  }

  giveCreditScoreAndLimit(
    borrower: string,
    score: number,
    limit: bigint,
    kycOk?: boolean,
    validUntil?: number,
    priority?: TxPriority,
  ): Promise<number> {
    return contractConfig().then((c) =>
      c.giveCreditScoreAndLimit(
        borrower,
        score,
        limit,
        kycOk,
        validUntil,
        priority,
      ),
    );
  }

  createLoanOfferBackend(
    amountHuman: string | number | bigint,
    borrower: string,
    tenorDays: number,
    feeBps: number,
    priority?: TxPriority,
  ): Promise<{
    ok: boolean;
    feeBps: number;
    tenorDays: number;
    maxAmountBase: string;
    minedBlock: number;
  }> {
    return contractConfig().then((c) =>
      c.createLoanOfferBackend(
        amountHuman,
        borrower,
        tenorDays,
        feeBps,
        undefined,
        undefined,
        priority,
      ),
    );
  }

  setPremiumConfig(
    borrower: string,
    lateRatePerSecWad: bigint,
    priority?: TxPriority,
  ): Promise<void> {
    return contractConfig().then((c) =>
      c.setPremiumConfig(borrower, lateRatePerSecWad, priority),
    );
  }

  previewLoanWithLate(borrower: string): Promise<bigint | null> {
    return contractConfig().then((c) => c.previewLoanWithLate(borrower));
  }

  // Spec 024 A.3 — preflight reads + accrueLate
  readLoanFull(borrower: string): Promise<{
    principal: bigint;
    amountDue: bigint;
    start: bigint;
    due: bigint;
    feeBps: number;
    gracePeriod: number;
    active: boolean;
  } | null> {
    return contractConfig().then((c) => c.readLoanFull(borrower));
  }

  readPremium(borrower: string): Promise<{
    premiumRatePerSecWad: bigint;
    lateRatePerSecWad: bigint;
  } | null> {
    return contractConfig().then((c) => c.readPremium(borrower));
  }

  readIsDefaulted(borrower: string): Promise<boolean | null> {
    return contractConfig().then((c) => c.readIsDefaulted(borrower));
  }

  getChainBlockTimestamp(): Promise<number | null> {
    return contractConfig().then((c) => c.getChainBlockTimestamp());
  }

  async getLatestLedger(): Promise<number> {
    const { provider } = await contractConfig();
    return provider.getBlockNumber();
  }

  async readUserRisk(borrower: string): Promise<{
    score: number;
    validUntil: number;
    limit: bigint;
  } | null> {
    try {
      const { provider, CLM_ADDRESS } = await contractConfig();
      const clm = new Contract(
        CLM_ADDRESS,
        [
          'function users(address) view returns (uint16 score, bool kycOk, uint64 validUntil, uint64 lastUpdated, uint128 limit)',
        ],
        provider,
      );
      const user = await clm.users(borrower);
      return {
        score: Number(user[0]),
        validUntil: Number(user[2]),
        limit: BigInt(user[4]),
      };
    } catch {
      return null;
    }
  }

  async getLoanOpenedEvents(
    fromLedger: number,
    toLedger: number,
  ): Promise<ChainLoanOpenedEvent[]> {
    const { provider, CLM_ADDRESS } = await contractConfig();
    const contract = new Contract(CLM_ADDRESS, LoanManagerAbi, provider);
    const events = await contract.queryFilter(
      contract.filters.LoanOpened(),
      fromLedger,
      toLedger,
    );

    const result: ChainLoanOpenedEvent[] = [];
    for (const event of events) {
      const e = event as EventLog;
      const block = await provider.getBlock(e.blockNumber);
      if (!block) continue;
      result.push({
        borrower: String(e.args[0]).toLowerCase(),
        principal: BigInt(e.args[1]),
        amountDue: BigInt(e.args[2]),
        due: Number(e.args[3]),
        feeBps: Number(e.args[4]),
        ledger: e.blockNumber,
        txHash: e.transactionHash,
        timestamp: block.timestamp,
      });
    }
    return result;
  }

  async findLoanClosedEvent(
    borrower: string,
    loanStartAt: Date,
    currentLedger: number,
  ): Promise<ChainLoanClosedEvent | null> {
    const { provider, CLM_ADDRESS } = await contractConfig();
    const contract = new Contract(CLM_ADDRESS, LoanManagerAbi, provider);
    const loanStartUnix = Math.floor(loanStartAt.getTime() / 1000);
    const nowUnix = Math.floor(Date.now() / 1000);
    const blocksSinceStart = Math.ceil(
      (nowUnix - loanStartUnix) / CELO_BLOCK_TIME_SEC,
    );
    const fromBlock = Math.max(0, currentLedger - blocksSinceStart - 2000);
    const filter = contract.filters.LoanClosed(borrower);

    for (let to = currentLedger; to >= fromBlock; to -= MAX_BLOCK_RANGE) {
      const from = Math.max(to - MAX_BLOCK_RANGE + 1, fromBlock);
      const events = await contract.queryFilter(filter, from, to);
      if (events.length > 0) {
        for (let i = events.length - 1; i >= 0; i--) {
          const event = events[i] as EventLog;
          const block = await provider.getBlock(event.blockNumber);
          const eventTimestamp = block?.timestamp ?? nowUnix;
          if (eventTimestamp < loanStartUnix) return null;
          return {
            borrower,
            amountPaid: BigInt(event.args[1]),
            txHash: event.transactionHash,
            ledger: event.blockNumber,
            timestamp: eventTimestamp,
          };
        }
      }
      if (to - MAX_BLOCK_RANGE >= fromBlock) await sleep(200);
    }
    return null;
  }

  async verifyLoanOpenedByTxHash(
    txHash: string,
    borrower: string,
  ): Promise<boolean> {
    const { provider, CLM_ADDRESS } = await contractConfig();
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) return false;
    if (receipt.status !== 1) return false;

    const expectedTopicUser = zeroPadValue(
      getAddress(borrower) as `0x${string}`,
      32,
    ).toLowerCase();
    const clmLower = CLM_ADDRESS.toLowerCase();

    return receipt.logs.some(
      (log) =>
        log.address.toLowerCase() === clmLower &&
        log.topics[0]?.toLowerCase() === LOAN_OPENED_TOPIC &&
        log.topics[1]?.toLowerCase() === expectedTopicUser,
    );
  }

  accrueLate(borrower: string, priority?: TxPriority): Promise<void> {
    return contractConfig().then((c) => c.accrueLate(borrower, priority));
  }

  async readLoanOnChain(borrower: string): Promise<{
    active: boolean;
    principal: bigint;
    amountDue: bigint;
  } | null> {
    try {
      // Use a relative dynamic import so selecting the Soroban gateway does
      // not require EVM env vars at module-load time.
      const { provider, CLM_ADDRESS } = await contractConfig();
      const clm = new Contract(
        CLM_ADDRESS,
        [
          'function loans(address) view returns (uint128 principal, uint128 amountDue, uint64 start, uint64 due, uint16 feeBps, uint32 gracePeriod, bool active)',
        ],
        provider,
      );
      const loan = await clm.loans(borrower);
      return {
        active: loan.active,
        principal: loan.principal,
        amountDue: loan.amountDue,
      };
    } catch {
      return null;
    }
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
    try {
      // Use a relative dynamic import so selecting the Soroban gateway does
      // not require EVM env vars at module-load time.

      const { provider, CLM_ADDRESS } = await contractConfig();
      // Spec 029 — receipt may not have propagated to our RPC node yet
      // (typically 1-3s after Lemon reports SUCCESS). Retry briefly so the
      // fast-path succeeds even when inform-repayment is called immediately
      // after the on-chain tx mines, instead of falling back to the slower
      // state-based check.
      // Spec 030 — bumped from 5×1s to 10×1s after observing real repays
      // where the receipt hadn't propagated within 5s and fell back to
      // state-based 503s. 10s covers virtually all observed cases.
      let receipt: Awaited<
        ReturnType<typeof provider.getTransactionReceipt>
      > | null = null;
      for (let attempt = 1; attempt <= 10; attempt++) {
        receipt = await provider.getTransactionReceipt(txHash);
        if (receipt) break;
        if (attempt < 10) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
      if (!receipt) return { verified: false, reason: 'no_receipt' };
      if (receipt.status !== 1) return { verified: false, reason: 'reverted' };

      const TOPIC_LOAN_CLOSED = id('LoanClosed(address,uint256)').toLowerCase();
      const expectedTopicUser = zeroPadValue(
        getAddress(borrower) as `0x${string}`,
        32,
      ).toLowerCase();
      const clmLower = CLM_ADDRESS.toLowerCase();

      // Spec 074 fix — also decode the `paid` field from the matched
      // LoanClosed event so the caller can use the chain-truth amount
      // (not the value the frontend reported, which can diverge if the
      // user's wallet UI pre-computed mora that the contract didn't
      // accrue before pulling).
      const matchedLog = receipt.logs.find(
        (log) =>
          log.address.toLowerCase() === clmLower &&
          log.topics[0]?.toLowerCase() === TOPIC_LOAN_CLOSED &&
          log.topics[1]?.toLowerCase() === expectedTopicUser,
      );

      if (!matchedLog) return { verified: false, reason: 'no_match' };
      // LoanClosed(address indexed user, uint256 paid) — `paid` is the
      // only non-indexed field, so log.data is exactly that uint256.
      const paidUnits = BigInt(matchedLog.data);
      return {
        verified: true,
        blockNumber: receipt.blockNumber,
        paidUnits,
      };
    } catch {
      return { verified: false, reason: 'rpc_error' };
    }
  }
}
