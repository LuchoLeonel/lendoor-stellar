// src/infrastructure/blockchain/ethers-blockchain.gateway.ts
import { Injectable } from '@nestjs/common';
import { Contract, id, getAddress, zeroPadValue } from 'ethers';
import {
  BlockchainGatewayPort,
  TxPriority,
} from 'src/domain/ports/outbound/blockchain-gateway.port';
import {
  readCreditLimitOnChain,
  giveCreditScoreAndLimit,
  createLoanOfferBackend,
  setPremiumConfig,
  previewLoanWithLate,
  readLoanFull,
  readPremium,
  readIsDefaulted,
  getChainBlockTimestamp,
  accrueLate,
  provider,
  CLM_ADDRESS,
} from 'src/config/contractConfig';

@Injectable()
export class EthersBlockchainGateway implements BlockchainGatewayPort {
  readCreditLimitOnChain(borrower: string): Promise<bigint> {
    return readCreditLimitOnChain(borrower);
  }

  giveCreditScoreAndLimit(
    borrower: string,
    score: number,
    limit: bigint,
    kycOk?: boolean,
    validUntil?: number,
    priority?: TxPriority,
  ): Promise<number> {
    return giveCreditScoreAndLimit(
      borrower,
      score,
      limit,
      kycOk,
      validUntil,
      priority,
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
    return createLoanOfferBackend(
      amountHuman,
      borrower,
      tenorDays,
      feeBps,
      undefined,
      undefined,
      priority,
    );
  }

  setPremiumConfig(
    borrower: string,
    lateRatePerSecWad: bigint,
    priority?: TxPriority,
  ): Promise<void> {
    return setPremiumConfig(borrower, lateRatePerSecWad, priority);
  }

  previewLoanWithLate(borrower: string): Promise<bigint | null> {
    return previewLoanWithLate(borrower);
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
    return readLoanFull(borrower);
  }

  readPremium(borrower: string): Promise<{
    premiumRatePerSecWad: bigint;
    lateRatePerSecWad: bigint;
  } | null> {
    return readPremium(borrower);
  }

  readIsDefaulted(borrower: string): Promise<boolean | null> {
    return readIsDefaulted(borrower);
  }

  getChainBlockTimestamp(): Promise<number | null> {
    return getChainBlockTimestamp();
  }

  accrueLate(borrower: string, priority?: TxPriority): Promise<void> {
    return accrueLate(borrower, priority);
  }

  async readLoanOnChain(borrower: string): Promise<{
    active: boolean;
    principal: bigint;
    amountDue: bigint;
  } | null> {
    try {
      // Spec 030 follow-up: was using dynamic `await import('src/...')`
      // which Node can't resolve at runtime (TS path alias only rewrites
      // static imports). That made this function silently fail with
      // "Cannot find module" → caught here → return null → state-based
      // check downstream interpreted null as "loan still active" → 503.
      // Now uses the static imports at the top of the file.
      const clm = new Contract(CLM_ADDRESS, [
        'function loans(address) view returns (uint128 principal, uint128 amountDue, uint64 start, uint64 due, uint16 feeBps, uint32 gracePeriod, bool active)',
      ], provider);
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
      // Spec 030 follow-up: was using `await import('src/config/contractConfig')`
      // which Node can't resolve (TS path alias rewrite only applies to static
      // imports). Result: this function silently threw "Cannot find module" on
      // every call → caught → returned 'rpc_error' → fallback state-based →
      // 503 in 8ms. Now uses static imports.

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
      if (receipt.status !== 1)
        return { verified: false, reason: 'reverted' };

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
