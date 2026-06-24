// src/config/contractConfig.ts
import {
  Contract,
  JsonRpcProvider,
  Wallet,
  parseUnits,
  Interface,
  type TransactionRequest,
  type FeeData,
} from 'ethers';
import { Logger } from '@nestjs/common';
import dotenv from 'dotenv';
dotenv.config();

const logger = new Logger('ContractConfig');

const RPC_URL = process.env.ETH_RPC_URL!;
export const CLM_ADDRESS = process.env.ETH_LOAN_MANAGER!;
const PRIVATE_KEY = process.env.ETH_PRIVATE_KEY!;

if (!RPC_URL) throw new Error('Missing ETH_RPC_URL');
if (!CLM_ADDRESS) throw new Error('Missing ETH_LOAN_MANAGER');
if (!PRIVATE_KEY) throw new Error('Missing ETH_PRIVATE_KEY');

export const provider = new JsonRpcProvider(RPC_URL);
export const signer = new Wallet(PRIVATE_KEY, provider);

// ---------------- Reads ----------------
const ABI_READS = [
  'function owner() view returns (address)',
  'function creditLimit(address) view returns (uint256)',
] as const;

// ---------------- Reads (extended) ----------------
const ABI_READS_EXTENDED = [
  ...ABI_READS,
  'function previewLoanWithLate(address borrower) view returns (uint256 principal, uint256 amountDueWithLate)',
  // Spec 024 A.3 — preflight reads
  'function loans(address borrower) view returns (uint128 principal, uint128 amountDue, uint64 start, uint64 due, uint16 feeBps, uint32 gracePeriod, bool active)',
  'function premiums(address borrower) view returns (uint128 premiumRatePerSecWad, uint128 lateRatePerSecWad)',
  'function isDefaulted(address borrower) view returns (bool)',
] as const;

const clmRead = new Contract(CLM_ADDRESS, ABI_READS_EXTENDED, provider);

// ---------------- Writes ----------------
const SIG_SET_USER_RISK = 'setUserRisk(address,uint16,bool,uint64,uint256)';
const SIG_SET_LOAN_OFFER = 'setLoanOffer(address,uint16,uint16,uint64,uint256)';
const SIG_SET_PREMIUM_CONFIG = 'setPremiumConfig(address,uint128,uint128)';
// Spec 024 A.3 — accrueLate is a write (onlyOwner) that materializes
// the accrued late fee into LoanManager storage.
const SIG_ACCRUE_LATE = 'accrueLate(address)';

const iface = new Interface([
  `function ${SIG_SET_USER_RISK}`,
  `function ${SIG_SET_LOAN_OFFER}`,
  `function ${SIG_SET_PREMIUM_CONFIG}`,
  `function ${SIG_ACCRUE_LATE}`,
  ...ABI_READS_EXTENDED,
]);

export function toUnits(v: string | number | bigint, decimals = 6): bigint {
  if (typeof v === 'bigint') return v;
  return BigInt(parseUnits(String(v), decimals).toString());
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function isHexAddress(addr: string) {
  return /^0x[0-9a-fA-F]{40}$/.test(addr);
}

// ============ CONFIG (ajustable por env) ============

// Auto-clear activado por default (como pediste).
// Si algún día querés apagarlo: CLM_AUTO_CLEAR_PENDING_NONCES=false
const AUTO_CLEAR_ENABLED =
  (process.env.CLM_AUTO_CLEAR_PENDING_NONCES ?? 'true').toLowerCase() !==
  'false';

// Máximo de nonces a cancelar en una sola pasada (evita loops infinitos)
const AUTO_CLEAR_MAX_STEPS = Number(
  process.env.CLM_AUTO_CLEAR_MAX_STEPS ?? 500,
);

// Timeouts
const TX_CONFIRM_TIMEOUT_MS = Number(
  process.env.CLM_TX_CONFIRM_TIMEOUT_MS ?? 60_000,
);
const CANCEL_CONFIRM_TIMEOUT_MS = Number(
  process.env.CLM_CANCEL_CONFIRM_TIMEOUT_MS ?? 60_000,
);

// Fee bump
const CANCEL_FEE_MULTIPLIER = BigInt(
  process.env.CLM_CANCEL_FEE_MULTIPLIER ?? 4,
); // x4 base
const CANCEL_FEE_MULTIPLIER_STEP = BigInt(
  process.env.CLM_CANCEL_FEE_MULTIPLIER_STEP ?? 2,
); // +x2 por retry

// Min priority (por si viene 0/null en algunos RPCs)
const MIN_PRIORITY_FEE_WEI = BigInt(
  process.env.CLM_MIN_PRIORITY_FEE_WEI ?? '2000000000',
); // 2 gwei

// ============ TX QUEUE (serializa todo, con prioridad) ============
// Spec 029: dos lanes en la misma cola. Tareas 'high' se procesan antes que
// 'low' pendientes; mismo signer / mismo nonce → sigue serializado (un tx
// a la vez). Una 'high' que llega no interrumpe la 'low' en curso, espera
// a que termine. Default 'low' = comportamiento legacy.

export type TxPriority = 'high' | 'low';

type QueuedTask = () => Promise<void>;
const highQueue: QueuedTask[] = [];
const lowQueue: QueuedTask[] = [];
let processing = false;

function dispatch(): void {
  if (processing) return;
  const next = highQueue.shift() ?? lowQueue.shift();
  if (!next) return;
  processing = true;
  next().finally(() => {
    processing = false;
    setImmediate(dispatch);
  });
}

function enqueue<T>(
  fn: () => Promise<T>,
  priority: TxPriority = 'low',
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const wrapped: QueuedTask = async () => {
      try {
        resolve(await fn());
      } catch (e) {
        reject(e);
      }
    };
    if (priority === 'high') highQueue.push(wrapped);
    else lowQueue.push(wrapped);
    setImmediate(dispatch);
  });
}

// ============ Helpers de estado del signer ============
async function signerState() {
  const addr = await signer.getAddress();
  const latest = await provider.getTransactionCount(addr, 'latest');
  const pending = await provider.getTransactionCount(addr, 'pending');
  const balance = await provider.getBalance(addr);
  return { addr, latest, pending, gap: pending - latest, balance };
}

async function logHeaderAndCheck(
  addr: string,
  label: 'borrower' | 'receiver' = 'borrower',
) {
  const { chainId } = await provider.getNetwork();
  const signerAddr = await signer.getAddress();

  logger.log(
    `rpc chainId=${chainId.toString()} clm=${CLM_ADDRESS} signer=${signerAddr} ${label}=${addr}`,
  );

  try {
    const owner: string = (await clmRead.owner()) as string;
    logger.log(`owner()=${owner}`);
  } catch {
    logger.log('owner(): <not exposed>');
  }
}

// ============ Fee helpers ============
function bumpMul(x: bigint, mul: bigint) {
  return x * mul;
}

async function feeOverridesFor(
  multiplier: bigint,
): Promise<Partial<TransactionRequest>> {
  const fee: FeeData = await provider.getFeeData();

  // EIP-1559
  if (fee.maxFeePerGas != null && fee.maxPriorityFeePerGas != null) {
    const prio =
      fee.maxPriorityFeePerGas > 0n
        ? fee.maxPriorityFeePerGas
        : MIN_PRIORITY_FEE_WEI;
    return {
      maxFeePerGas: bumpMul(fee.maxFeePerGas, multiplier),
      maxPriorityFeePerGas: bumpMul(prio, multiplier),
    };
  }

  // Legacy
  if (fee.gasPrice != null) {
    return { gasPrice: bumpMul(fee.gasPrice, multiplier) };
  }

  // fallback: dejar al provider resolver
  return {};
}

// ============ Receipt polling (no tx.wait infinito) ============
async function waitReceiptPolling(hash: string, timeoutMs: number) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await provider.getTransactionReceipt(hash);
    if (r) return r;
    await sleep(1500);
  }
  throw new Error(`TX_CONFIRM_TIMEOUT: ${hash} not mined in ${timeoutMs}ms`);
}

// ============ Auto-clear: cancela NONCE más viejo pending ============
async function cancelNonce(nonce: number) {
  const addr = await signer.getAddress();

  interface EthersError extends Error {
    shortMessage?: string;
  }
  let lastErr: EthersError | null = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const mult =
        CANCEL_FEE_MULTIPLIER +
        CANCEL_FEE_MULTIPLIER_STEP * BigInt(Math.max(0, attempt - 1));
      const fees = await feeOverridesFor(mult);

      const tx = await signer.sendTransaction({
        to: addr,
        value: 0n,
        gasLimit: 21_000n,
        nonce,
        ...fees,
      });

      logger.log(
        `[AUTO-CLEAR] cancel nonce=${nonce} hash=${tx.hash} (mult=${mult.toString()}x)`,
      );
      const receipt = await waitReceiptPolling(
        tx.hash,
        CANCEL_CONFIRM_TIMEOUT_MS,
      );
      logger.log(
        `[AUTO-CLEAR] mined nonce=${nonce} block=${receipt.blockNumber}`,
      );
      return;
    } catch (e: unknown) {
      lastErr = e as EthersError;
      const err = e as EthersError;
      const msg = String(err?.shortMessage ?? err?.message ?? e);
      logger.warn(
        `[AUTO-CLEAR] nonce=${nonce} attempt=${attempt} failed: ${msg}`,
      );
      await sleep(400 * attempt);
      continue;
    }
  }

  throw new Error(
    `AUTO_CLEAR_FAILED nonce=${nonce}: ${String(lastErr?.shortMessage ?? lastErr?.message ?? lastErr)}`,
  );
}

// ============ Auto-clear: limpia TODAS las pendientes hasta gap=0 ============
let autoClearInFlight: Promise<void> | null = null;

async function autoClearPendingNoncesIfNeeded() {
  const st = await signerState();
  if (st.gap <= 0) return;

  if (!AUTO_CLEAR_ENABLED) {
    throw new Error(
      `SIGNER_STUCK_PENDING_TX: addr=${st.addr} latest=${st.latest} pending=${st.pending} (gap=${st.gap}). ` +
        `Auto-clear desactivado (CLM_AUTO_CLEAR_PENDING_NONCES=false). Cancel/speedup nonce=${st.latest}.`,
    );
  }

  // Evita que dos requests disparen auto-clear a la vez
  if (autoClearInFlight) {
    await autoClearInFlight;
    return;
  }

  autoClearInFlight = (async () => {
    logger.warn(
      `[AUTO-CLEAR] signer stuck. addr=${st.addr} latest=${st.latest} pending=${st.pending} gap=${st.gap}. Clearing...`,
    );

    // Chequeo de balance básico (si está en 0, nunca va a minar)
    if (st.balance <= 0n) {
      throw new Error(
        `[AUTO-CLEAR] signer balance=0. No puede pagar gas para limpiar nonces.`,
      );
    }

    for (let i = 0; i < AUTO_CLEAR_MAX_STEPS; i++) {
      const cur = await signerState();
      if (cur.gap <= 0) {
        logger.log('[AUTO-CLEAR] done, gap=0');
        return;
      }

      // Cancelamos siempre el nonce más viejo pendiente (= latest)
      await cancelNonce(cur.latest);
    }

    const end = await signerState();
    throw new Error(
      `[AUTO-CLEAR] gave up after ${AUTO_CLEAR_MAX_STEPS} cancels. ` +
        `addr=${end.addr} latest=${end.latest} pending=${end.pending} gap=${end.gap}`,
    );
  })();

  try {
    await autoClearInFlight;
  } finally {
    autoClearInFlight = null;
  }
}

// ============ Estimación gas ============
async function tryEstimate(data: string) {
  try {
    const from = await signer.getAddress();
    return await provider.estimateGas({ to: CLM_ADDRESS, data, from });
  } catch {
    return null;
  }
}

// ============ Send tx (serializado + auto-clear previo + retry) ============

// Spec 021 §Phase 2: retry the whole sendContractTx on known transient
// errors. The main case is `AUTO_CLEAR_FAILED` — by the time we retry
// (2–6 s later), a prior in-flight tx has usually mined, `latest`
// equals `pending`, auto-clear is a no-op, and the send proceeds
// normally. If all attempts fail, emit a structured `[CHAIN-WRITE-FAILED]`
// log line so an operator can run 11-resync-users-to-chain.js later
// for the affected wallet.
export const RETRYABLE_ERROR_FRAGMENTS: readonly string[] = [
  'AUTO_CLEAR_FAILED',
  'nonce has already been used',
  'replacement transaction underpriced',
  'already known', // mempool race
];
export const MAX_SEND_ATTEMPTS = Number(
  process.env.CLM_SEND_MAX_ATTEMPTS ?? 3,
);

/** Exposed for unit tests + external inspection. Pure function. */
export function isRetryableChainError(err: unknown): boolean {
  const msg = String(
    (err as { message?: string })?.message ??
      (err as { shortMessage?: string })?.shortMessage ??
      err,
  );
  return RETRYABLE_ERROR_FRAGMENTS.some((f) => msg.includes(f));
}

/**
 * Retry-with-backoff wrapper for chain writes. Exposed for unit tests
 * — production uses it via `sendContractTx` below. Pure control-flow,
 * no ethers dependencies; the work happens inside `fn`.
 */
export async function withChainWriteRetry<T>(
  fn: () => Promise<T>,
  purpose: string,
  opts: {
    maxAttempts?: number;
    backoffMs?: (attempt: number) => number;
    waitFn?: (ms: number) => Promise<void>;
    onFinalFailure?: (err: unknown, attempts: number) => void;
    onRetry?: (err: unknown, attempt: number, maxAttempts: number, wait: number) => void;
  } = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? MAX_SEND_ATTEMPTS;
  const backoff = opts.backoffMs ?? ((attempt: number) => 2000 * attempt);
  const wait = opts.waitFn ?? sleep;

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = String(
        (e as { message?: string })?.message ??
          (e as { shortMessage?: string })?.shortMessage ??
          e,
      );
      if (attempt === maxAttempts || !isRetryableChainError(e)) {
        // Terminal failure — emit structured log for manual reconciliation.
        if (opts.onFinalFailure) opts.onFinalFailure(e, attempt);
        else
          logger.error(
            `[CHAIN-WRITE-FAILED] purpose=${purpose} attempts=${attempt} msg=${msg.slice(0, 200)}`,
          );
        throw e;
      }
      const ms = backoff(attempt);
      if (opts.onRetry) opts.onRetry(e, attempt, maxAttempts, ms);
      else
        logger.warn(
          `[${purpose}] attempt ${attempt}/${maxAttempts} failed (retryable): ${msg.slice(0, 120)}. Retrying in ${ms}ms`,
        );
      await wait(ms);
    }
  }
  // Safety net — should never hit because loop re-throws above.
  throw (
    lastErr ?? new Error(`${purpose} failed after ${maxAttempts} attempts`)
  );
}

async function sendContractTx(
  data: string,
  gasLimit: bigint,
  purpose: string,
  priority: TxPriority = 'low',
) {
  return withChainWriteRetry(
    () => sendContractTxOnce(data, gasLimit, purpose, priority),
    purpose,
  );
}

async function sendContractTxOnce(
  data: string,
  gasLimit: bigint,
  purpose: string,
  priority: TxPriority,
) {
  return enqueue(async () => {
    // si hay pendientes, auto-limpia primero
    await autoClearPendingNoncesIfNeeded();

    interface EthersError extends Error {
      shortMessage?: string;
    }

    // Phase 1: SEND with retry (only retry if send itself fails — never resend
    // after we already have a tx hash, that creates duplicate txs on different
    // nonces which both get mined).
    let tx: Awaited<ReturnType<typeof signer.sendTransaction>> | null = null;
    let sendErr: EthersError | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const fees = await feeOverridesFor(2n + BigInt(attempt)); // x3, x4, x5
        tx = await signer.sendTransaction({
          to: CLM_ADDRESS,
          data,
          gasLimit,
          ...fees,
        });
        break;
      } catch (e: unknown) {
        sendErr = e as EthersError;
        await sleep(350 * attempt);
      }
    }

    if (!tx) {
      throw new Error(
        `${purpose} send failed after retries: ${String(sendErr?.shortMessage ?? sendErr?.message ?? sendErr)}`,
      );
    }

    // Phase 2: WAIT for receipt (no retry — tx is already in mempool with a
    // specific nonce; sending another would just create a duplicate).
    logger.log(`[${purpose}] tx hash=${tx.hash}`);
    const receipt = await waitReceiptPolling(tx.hash, TX_CONFIRM_TIMEOUT_MS);
    logger.log(`[${purpose}] mined block=${receipt.blockNumber}`);
    return receipt;
  }, priority);
}

// ===================== PUBLIC API =====================

export async function readCreditLimitOnChain(
  borrower: string,
): Promise<bigint> {
  if (!isHexAddress(borrower)) throw new Error(`Invalid borrower: ${borrower}`);
  return (await clmRead.creditLimit(borrower)) as bigint;
}

export async function giveCreditScoreAndLimit(
  borrower: string,
  score: number = 1,
  limit: bigint = toUnits(1, 6),
  kycOk: boolean = true,
  validUntil?: number,
  priority: TxPriority = 'low',
) {
  if (!isHexAddress(borrower)) {
    throw new Error(`Invalid borrower: ${borrower}`);
  }

  // Clamp score to valid uint16 range accepted by the contract [1, 1000]
  if (!Number.isFinite(score) || score < 1 || score > 1000) {
    throw new Error(`Invalid score: ${score}. Must be between 1 and 1000.`);
  }

  const finalValidUntil =
    validUntil !== undefined
      ? validUntil
      : Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;

  await logHeaderAndCheck(borrower, 'borrower');

  logger.log(
    `[RISK] borrower=${borrower} score=${score} kycOk=${kycOk} validUntil=${finalValidUntil} limit=${limit.toString()} priority=${priority}`,
  );

  const data = iface.encodeFunctionData(SIG_SET_USER_RISK, [
    borrower,
    score,
    kycOk,
    BigInt(finalValidUntil),
    limit,
  ]);

  const gas = await tryEstimate(data);
  if (!gas) {
    throw new Error(
      'setUserRisk reverted on estimateGas — is CLM_ADDRESS correct? signer is owner?',
    );
  }

  const gasLimit = gas + gas / 5n; // +20%
  await sendContractTx(data, gasLimit, 'setUserRisk', priority);

  // Para compatibilidad con tu LoanService (espera 200)
  return 200;
}

export async function createLoanOfferBackend(
  amountHuman: string | number | bigint,
  borrower: string,
  tenorDays: number,
  feeBps = 300,
  usdcDecimals = 6,
  offerTtlSecs = 3 * 24 * 60 * 60,
  priority: TxPriority = 'low',
) {
  if (!isHexAddress(borrower)) {
    throw new Error(`Invalid borrower: ${borrower}`);
  }

  if (!Number.isInteger(tenorDays) || tenorDays <= 0 || tenorDays > 65535) {
    throw new Error(`Invalid tenorDays (uint16): ${tenorDays}`);
  }
  if (!Number.isInteger(feeBps) || feeBps <= 0 || feeBps > 65535) {
    throw new Error(`Invalid feeBps (uint16): ${feeBps}`);
  }

  await logHeaderAndCheck(borrower, 'borrower');

  const maxAmount = toUnits(amountHuman, usdcDecimals);
  const now = Math.floor(Date.now() / 1000);
  const validUntil = BigInt(now + offerTtlSecs);

  logger.log(
    `[OFFER] borrower=${borrower} amount=${String(amountHuman)} maxAmount=${maxAmount.toString()} tenorDays=${tenorDays} feeBps=${feeBps} validUntil=${validUntil.toString()}`,
  );

  const data = iface.encodeFunctionData(SIG_SET_LOAN_OFFER, [
    borrower,
    tenorDays,
    feeBps,
    validUntil,
    maxAmount,
  ]);

  const gas = await tryEstimate(data);
  if (!gas) {
    throw new Error(
      'setLoanOffer reverted on estimateGas — check signer is owner / params',
    );
  }

  const gasLimit = gas + gas / 5n; // +20%
  const receipt = await sendContractTx(data, gasLimit, 'setLoanOffer', priority);

  return {
    ok: true,
    feeBps,
    tenorDays,
    maxAmountBase: maxAmount.toString(),
    // txHash no lo tenemos acá porque lo resolvimos adentro; si lo querés, lo agrego
    minedBlock: receipt.blockNumber,
  };
}

/**
 * Activates late fees for a borrower by calling setPremiumConfig on LoanManager V3.
 * Must be called by the contract owner (signer).
 *
 * V3 signature: setPremiumConfig(address borrower, uint128 premiumRatePerSecWad, uint128 lateRatePerSecWad)
 * premiumRatePerSecWad = 0 (no premium/early fee)
 * lateRatePerSecWad = rate for late payments (e.g. 19290123457n for 5%/month per spec 024)
 *
 * @param borrower  - checksummed / lowercase hex address
 * @param lateRatePerSecWad - late fee rate in WAD per second
 */
export async function setPremiumConfig(
  borrower: string,
  lateRatePerSecWad: bigint,
  priority: TxPriority = 'low',
): Promise<void> {
  if (!isHexAddress(borrower)) {
    throw new Error(`Invalid borrower: ${borrower}`);
  }

  logger.log(
    `[PREMIUM] borrower=${borrower} premiumRate=0 lateRatePerSecWad=${lateRatePerSecWad.toString()}`,
  );

  const data = iface.encodeFunctionData(SIG_SET_PREMIUM_CONFIG, [
    borrower,
    0n,                  // premiumRatePerSecWad (no premium fee)
    lateRatePerSecWad,   // lateRatePerSecWad
  ]);

  const gas = await tryEstimate(data);
  if (!gas) {
    throw new Error(
      'setPremiumConfig reverted on estimateGas — check signer is owner / params',
    );
  }

  const gasLimit = gas + gas / 5n; // +20%
  await sendContractTx(data, gasLimit, 'setPremiumConfig', priority);
}

/**
 * Reads the current outstanding debt for a borrower including any accrued late fees.
 * Returns the amount in USDC base units (6 decimals).
 *
 * @param borrower - checksummed / lowercase hex address
 * @returns amountDue in USDC units (bigint), or null if the RPC call fails
 */
export async function previewLoanWithLate(
  borrower: string,
): Promise<bigint | null> {
  if (!isHexAddress(borrower)) {
    throw new Error(`Invalid borrower: ${borrower}`);
  }

  try {
    const result = (await clmRead.previewLoanWithLate(borrower)) as [
      bigint,
      bigint,
    ];
    const amountDueWithLate: bigint = result[1]; // second return value: amountDueWithLate
    return amountDueWithLate;
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    logger.warn(
      `[PREVIEW_LATE] previewLoanWithLate failed for ${borrower}: ${message}`,
    );
    return null;
  }
}

/**
 * Spec 024 A.3 — read the full loan struct from LoanManagerV3.
 * Returns the 7-field public getter shape (matches contract).
 */
export interface LoanFullState {
  principal: bigint;
  amountDue: bigint;
  start: bigint;
  due: bigint;
  feeBps: number;
  gracePeriod: number;
  active: boolean;
}

export async function readLoanFull(
  borrower: string,
): Promise<LoanFullState | null> {
  if (!isHexAddress(borrower)) {
    throw new Error(`Invalid borrower: ${borrower}`);
  }
  try {
    const r = (await clmRead.loans(borrower)) as [
      bigint, bigint, bigint, bigint, bigint, bigint, boolean,
    ];
    return {
      principal: r[0],
      amountDue: r[1],
      start: r[2],
      due: r[3],
      feeBps: Number(r[4]),
      gracePeriod: Number(r[5]),
      active: r[6],
    };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    logger.warn(`[LOANS] readLoanFull failed for ${borrower}: ${message}`);
    return null;
  }
}

/**
 * Spec 024 A.3 — read the per-borrower premium config.
 * Returns both fields of the PremiumConfig struct.
 */
export interface PremiumConfig {
  premiumRatePerSecWad: bigint;
  lateRatePerSecWad: bigint;
}

export async function readPremium(
  borrower: string,
): Promise<PremiumConfig | null> {
  if (!isHexAddress(borrower)) {
    throw new Error(`Invalid borrower: ${borrower}`);
  }
  try {
    const r = (await clmRead.premiums(borrower)) as [bigint, bigint];
    return {
      premiumRatePerSecWad: r[0],
      lateRatePerSecWad: r[1],
    };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    logger.warn(`[PREMIUMS] readPremium failed for ${borrower}: ${message}`);
    return null;
  }
}

/**
 * Spec 024 A.3 — read isDefaulted flag for a borrower.
 */
export async function readIsDefaulted(
  borrower: string,
): Promise<boolean | null> {
  if (!isHexAddress(borrower)) {
    throw new Error(`Invalid borrower: ${borrower}`);
  }
  try {
    return (await clmRead.isDefaulted(borrower)) as boolean;
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    logger.warn(`[IS_DEFAULTED] readIsDefaulted failed for ${borrower}: ${message}`);
    return null;
  }
}

/**
 * Spec 024 A.3 — get current chain block timestamp (seconds).
 * Used by preflight to compute lateStart / daysLate / daysToDefault
 * against chain time, NOT backend wall clock (avoids drift bugs).
 */
export async function getChainBlockTimestamp(): Promise<number | null> {
  try {
    const block = await provider.getBlock('latest');
    return block?.timestamp ?? null;
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    logger.warn(`[CHAIN_TS] getChainBlockTimestamp failed: ${message}`);
    return null;
  }
}

/**
 * Spec 024 A.3 — call accrueLate(borrower) on LoanManagerV3.
 *
 * Materializes the accrued late fee into L.amountDue storage so that
 * subsequent Borrowing.repay reads see the up-to-date value. This is
 * the missing call that caused the 2026-04-18 Lukas trap (see spec 024
 * §1.2): without accrueLate, previewLoanWithLate grew per second but
 * the contract's stored amountDue stayed at the old value, causing
 * any repay attempt with a freshly-previewed amount to revert.
 *
 * Idempotent: calling twice in a row with no time passing is a no-op
 * (the second call computes tLate=0 → extraLate=0 → unchanged storage).
 *
 * Serial via spec 021 signer queue (sendContractTx → enqueue).
 *
 * @param borrower - checksummed / lowercase hex address
 * @param priority - 'high' for user-facing repay flow, 'low' otherwise
 */
export async function accrueLate(
  borrower: string,
  priority: TxPriority = 'high',
): Promise<void> {
  if (!isHexAddress(borrower)) {
    throw new Error(`Invalid borrower: ${borrower}`);
  }
  logger.log(`[ACCRUE_LATE] borrower=${borrower}`);
  const data = iface.encodeFunctionData(SIG_ACCRUE_LATE, [borrower]);
  const gas = await tryEstimate(data);
  if (!gas) {
    throw new Error(
      'accrueLate reverted on estimateGas — likely loan inactive or no active premium config',
    );
  }
  const gasLimit = gas + gas / 5n; // +20%
  await sendContractTx(data, gasLimit, 'accrueLate', priority);
}
