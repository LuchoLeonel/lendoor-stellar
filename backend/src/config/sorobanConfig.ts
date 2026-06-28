import { Logger } from '@nestjs/common';
import dotenv from 'dotenv';
import { toUnits } from 'src/common/amount-units';
import { isValidStellarPublicKey } from 'src/common/stellar-strkey';
import { TxPriority } from 'src/domain/ports/outbound/blockchain-gateway.port';

dotenv.config();

type StellarSdk = typeof import('@stellar/stellar-sdk');
type StellarTransaction = import('@stellar/stellar-sdk').Transaction;
type StellarContractEvent = import('@stellar/stellar-sdk').xdr.ContractEvent;
type StellarScVal = import('@stellar/stellar-sdk').xdr.ScVal;

const logger = new Logger('SorobanConfig');

export const SOROBAN_RPC_URL =
  process.env.SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org';
export const SOROBAN_LOAN_MANAGER =
  process.env.SOROBAN_LOAN_MANAGER ??
  'CDBB3B6PZAV5OH7NACXQTL3YLZLJ3NNUMHCMFV54WIR6MDCO6GKGFSCJ';
export const SOROBAN_VAULT =
  process.env.SOROBAN_VAULT ??
  'CDVWUWSBHFVQGPCZGLBRTHDDIJBKWLXTVC2QIPXG6UJWNDFGZUP7S7KO';
export const SOROBAN_USDC_SAC =
  process.env.SOROBAN_USDC_SAC ??
  'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
export const NETWORK_PASSPHRASE =
  process.env.NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015';

const STELLAR_OPERATOR_SECRET = process.env.STELLAR_OPERATOR_SECRET;
const TX_CONFIRM_TIMEOUT_MS = positiveIntEnv(
  'CLM_TX_CONFIRM_TIMEOUT_MS',
  process.env.CLM_TX_CONFIRM_TIMEOUT_MS,
  60_000,
);
const MAX_SEND_ATTEMPTS = positiveIntEnv(
  'CLM_SEND_MAX_ATTEMPTS',
  process.env.CLM_SEND_MAX_ATTEMPTS,
  3,
);

type QueuedTask = () => Promise<void>;
const highQueue: QueuedTask[] = [];
const lowQueue: QueuedTask[] = [];
let processing = false;

let sdkCache: StellarSdk | null = null;

function stellar(): StellarSdk {
  if (!sdkCache) {
    sdkCache = require('@stellar/stellar-sdk') as StellarSdk;
  }
  return sdkCache;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function positiveIntEnv(
  name: string,
  raw: string | undefined,
  fallback: number,
) {
  const value = raw === undefined || raw.trim() === '' ? fallback : Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

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

export function enqueueSoroban<T>(
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

export { toUnits };

export function assertStellarAccount(address: string): void {
  if (!isValidStellarPublicKey(address)) {
    throw new Error(`Invalid Stellar account: ${address}`);
  }
}

export function assertSorobanContractId(
  contractId: string,
  label: string,
): void {
  if (!/^C[A-Z2-7]{55}$/.test(contractId)) {
    throw new Error(`Invalid ${label}: ${contractId}`);
  }
}

export function isLoanManagerContractEvent(
  event: StellarContractEvent,
): boolean {
  const contractId = event.contractId();
  if (!contractId) return false;
  return (
    Buffer.compare(
      Buffer.from(contractId as unknown as Uint8Array),
      stellar().StrKey.decodeContract(SOROBAN_LOAN_MANAGER),
    ) === 0
  );
}

function operatorSecret(): string {
  if (!STELLAR_OPERATOR_SECRET) {
    throw new Error('Missing STELLAR_OPERATOR_SECRET');
  }
  return STELLAR_OPERATOR_SECRET;
}

export function sorobanServer() {
  const { rpc } = stellar();
  return new rpc.Server(SOROBAN_RPC_URL);
}

export function operatorKeypair() {
  return stellar().Keypair.fromSecret(operatorSecret());
}

export function scAddress(address: string): StellarScVal {
  return new (stellar().Address)(address).toScVal();
}

export function scU32(value: number): StellarScVal {
  return stellar().nativeToScVal(value, { type: 'u32' });
}

export function scU64(value: number | bigint): StellarScVal {
  return stellar().nativeToScVal(BigInt(value), { type: 'u64' });
}

export function scI128(value: bigint): StellarScVal {
  return stellar().nativeToScVal(value, { type: 'i128' });
}

export function scBool(value: boolean): StellarScVal {
  return stellar().nativeToScVal(value);
}

export function scSymbol(value: string): StellarScVal {
  return stellar().nativeToScVal(value, { type: 'symbol' });
}

export function fromScVal<T = unknown>(value: StellarScVal): T {
  return stellar().scValToNative(value) as T;
}

function isSimulationError(sim: unknown): sim is { error: string } {
  return typeof (sim as { error?: unknown })?.error === 'string';
}

function isRetryableSorobanError(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message ?? err);
  return msg.includes('TRY_AGAIN_LATER') || msg.includes('timeout');
}

async function withSorobanWriteRetry<T>(
  fn: () => Promise<T>,
  purpose: string,
): Promise<T> {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt === MAX_SEND_ATTEMPTS || !isRetryableSorobanError(e)) {
        throw e;
      }
      const wait = 2000 * attempt;
      logger.warn(
        `[${purpose}] attempt ${attempt}/${MAX_SEND_ATTEMPTS} failed: ${String(
          (e as { message?: string })?.message ?? e,
        ).slice(0, 160)}. Retrying in ${wait}ms`,
      );
      await sleep(wait);
    }
  }
  throw lastErr ?? new Error(`${purpose} failed`);
}

async function waitForTransaction(hash: string) {
  const server = sorobanServer();
  const start = Date.now();
  while (Date.now() - start < TX_CONFIRM_TIMEOUT_MS) {
    const tx = await server.getTransaction(hash);
    if (tx.status === 'SUCCESS') return tx;
    if (tx.status === 'FAILED') {
      throw new Error(`Soroban tx failed: ${hash}`);
    }
    await sleep(1000);
  }
  throw new Error(
    `TX_CONFIRM_TIMEOUT: ${hash} not confirmed in ${TX_CONFIRM_TIMEOUT_MS}ms`,
  );
}

async function waitForTransactionWithRetry(hash: string, purpose: string) {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
    try {
      return await waitForTransaction(hash);
    } catch (e) {
      lastErr = e;
      if (attempt === MAX_SEND_ATTEMPTS || !isRetryableSorobanError(e)) {
        throw e;
      }
      const wait = 2000 * attempt;
      logger.warn(
        `[${purpose}] confirm attempt ${attempt}/${MAX_SEND_ATTEMPTS} failed for ${hash}: ${String(
          (e as { message?: string })?.message ?? e,
        ).slice(0, 160)}. Polling again in ${wait}ms`,
      );
      await sleep(wait);
    }
  }
  throw lastErr ?? new Error(`${purpose} confirmation failed for ${hash}`);
}

async function buildContractTransaction(
  method: string,
  args: StellarScVal[],
): Promise<StellarTransaction> {
  const sdk = stellar();
  const server = sorobanServer();
  const keypair = operatorKeypair();
  const account = await server.getAccount(keypair.publicKey());
  const contract = new sdk.Contract(SOROBAN_LOAN_MANAGER);

  return new sdk.TransactionBuilder(account, {
    fee: sdk.BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();
}

export async function simulateLoanManagerCall<T = unknown>(
  method: string,
  args: StellarScVal[],
): Promise<T> {
  assertSorobanContractId(SOROBAN_LOAN_MANAGER, 'SOROBAN_LOAN_MANAGER');
  const server = sorobanServer();
  const tx = await buildContractTransaction(method, args);
  const sim = await server.simulateTransaction(tx);
  if (isSimulationError(sim)) {
    throw new Error(`Soroban simulation failed for ${method}: ${sim.error}`);
  }
  const result = sim.result;
  if (!result) return null as T;
  return fromScVal<T>(result.retval);
}

export async function sendLoanManagerCall(
  method: string,
  args: StellarScVal[],
  purpose: string,
  priority: TxPriority = 'low',
) {
  assertSorobanContractId(SOROBAN_LOAN_MANAGER, 'SOROBAN_LOAN_MANAGER');
  return enqueueSoroban(async () => {
    const sent = await withSorobanWriteRetry(async () => {
      const server = sorobanServer();
      const keypair = operatorKeypair();
      const tx = await buildContractTransaction(method, args);
      const prepared = await server.prepareTransaction(tx);
      prepared.sign(keypair);

      const result = await server.sendTransaction(prepared);
      if (result.status === 'TRY_AGAIN_LATER') {
        throw new Error(`TRY_AGAIN_LATER ${result.hash}`);
      }
      if (result.status === 'ERROR') {
        throw new Error(`Soroban send failed for ${purpose}: ${result.hash}`);
      }
      return result;
    }, `${purpose}:send`);

    logger.log(`[${purpose}] tx hash=${sent.hash}`);
    const confirmed = await waitForTransactionWithRetry(sent.hash, purpose);
    logger.log(`[${purpose}] confirmed ledger=${confirmed.ledger}`);
    return confirmed;
  }, priority);
}
