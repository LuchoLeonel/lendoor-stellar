// src/domain/ports/outbound/blockchain-gateway.port.ts

export const BLOCKCHAIN_GATEWAY = Symbol('BLOCKCHAIN_GATEWAY');

/**
 * Port for all on-chain interactions with the LoanManager contract.
 *
 * Method signatures are derived from the functions actually called across
 * loan.service.ts and notification.service.ts (via contractConfig.ts).
 */

/**
 * Spec 029 — priority lane for the backend signer queue. 'high' is for
 * user-facing operations the user is actively waiting for (post-repay
 * credit update, new-borrow offer creation). 'low' is for background
 * tasks (chain-sync reconciliation, validUntil renewals, batch recalcs).
 * Default 'low' = legacy FIFO behavior.
 */
export type TxPriority = 'high' | 'low';

export interface BlockchainGatewayPort {
  /**
   * Reads the current on-chain credit limit for a borrower.
   * Returns 0n if no credit line exists or if it has expired.
   *
   * @param borrower - normalized wallet address
   */
  readCreditLimitOnChain(borrower: string): Promise<bigint>;

  /**
   * Sets (or refreshes) the on-chain credit score and credit limit for a borrower.
   * Also sets validUntil to 30 days from now unless overridden.
   *
   * @param borrower    - normalized wallet address
   * @param score       - credit score in [1, 1000]
   * @param limit       - credit limit in USDC base units (6 decimals)
   * @param kycOk       - whether KYC is approved (default true)
   * @param validUntil  - Unix timestamp; defaults to now + 30 days
   * @returns 200 on success (matches legacy contractConfig behaviour)
   */
  giveCreditScoreAndLimit(
    borrower: string,
    score: number,
    limit: bigint,
    kycOk?: boolean,
    validUntil?: number,
    priority?: TxPriority,
  ): Promise<number>;

  /**
   * Creates a loan offer on-chain via setLoanOffer.
   * Returns offer metadata including feeBps and mined block number.
   *
   * @param amountHuman  - human-readable USDC amount (e.g. "50" = 50 USDC)
   * @param borrower     - normalized wallet address
   * @param tenorDays    - loan duration in days (must be 7, 14, or 21)
   * @param feeBps       - fee in basis points
   */
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
  }>;

  /**
   * Activates late fees for a borrower by calling setPremiumConfig.
   * Typically called after a loan offer is created.
   *
   * @param borrower           - normalized wallet address
   * @param lateRatePerSecWad  - late fee rate in WAD per second
   */
  setPremiumConfig(
    borrower: string,
    lateRatePerSecWad: bigint,
    priority?: TxPriority,
  ): Promise<void>;

  /**
   * Reads the current outstanding debt for a borrower including accrued late fees.
   * Returns the amount in USDC base units (6 decimals), or null if the RPC call fails.
   *
   * @param borrower - normalized wallet address
   */
  previewLoanWithLate(borrower: string): Promise<bigint | null>;

  /**
   * Reads the on-chain loan state for a borrower.
   * Returns { active, principal, amountDue } or null if RPC fails.
   */
  readLoanOnChain(borrower: string): Promise<{
    active: boolean;
    principal: bigint;
    amountDue: bigint;
  } | null>;

  /**
   * Spec 024 A.3 — reads the FULL loan struct (7 fields).
   * Used by preflightRepayment to compute lateStart, daysLate,
   * daysToDefault. Returns null if RPC fails.
   */
  readLoanFull(borrower: string): Promise<{
    principal: bigint;
    amountDue: bigint;
    start: bigint;
    due: bigint;
    feeBps: number;
    gracePeriod: number;
    active: boolean;
  } | null>;

  /**
   * Spec 024 A.3 — reads the per-borrower premium config (mora rate).
   * Returns null if RPC fails. lateRatePerSecWad=0 means mora is
   * disabled for this wallet (default for new borrows pre-spec-024).
   */
  readPremium(borrower: string): Promise<{
    premiumRatePerSecWad: bigint;
    lateRatePerSecWad: bigint;
  } | null>;

  /**
   * Spec 024 A.3 — reads the on-chain `isDefaulted` flag.
   * Returns null if RPC fails. isDefaulted=true is set by markDefault
   * (spec 023) and cleared by closeLoan on a successful repay.
   */
  readIsDefaulted(borrower: string): Promise<boolean | null>;

  /**
   * Spec 024 A.3 — reads the latest block.timestamp from chain (seconds).
   * Used by preflight to compute lateStart / daysLate against chain time
   * (NOT backend wall clock — avoids drift bugs that affect markDefault
   * timing per spec 023 §6 risk #4).
   */
  getChainBlockTimestamp(): Promise<number | null>;

  /**
   * Spec 024 A.3 — call accrueLate(borrower) on LoanManagerV3.
   * Materializes the accrued late fee into L.amountDue storage. Serial
   * via spec 021 signer queue. onlyOwner — revert if signer is not the
   * LoanManager owner. Idempotent (tLate=0 → no-op).
   */
  accrueLate(borrower: string, priority?: TxPriority): Promise<void>;

  /**
   * Verifies a repayment via tx receipt + LoanClosed event (spec 026).
   * Faster + safer than readLoanOnChain (no state cache race).
   *
   * - verified=true            → receipt found, status=1, LoanClosed
   *                              event matches borrower
   * - verified=false / no_receipt → RPC didn't propagate yet; caller
   *                                 should fall back to state-based read
   * - verified=false / reverted   → tx reverted on-chain; hard fail
   * - verified=false / no_match   → tx receipt OK but no LoanClosed for
   *                                 this borrower (wrong txHash); hard fail
   * - verified=false / rpc_error  → RPC threw; caller should fall back
   */
  verifyRepayByTxHash(
    txHash: string,
    borrower: string,
  ): Promise<{
    verified: boolean;
    reason?: 'no_receipt' | 'reverted' | 'no_match' | 'rpc_error';
    blockNumber?: number;
    /**
     * Spec 074 fix — value the contract actually pulled from the user,
     * decoded from the LoanClosed(paid) event. Authoritative for the
     * DB `amountPaid` column. Only set when `verified=true`.
     */
    paidUnits?: bigint;
  }>;
}
