import {
  Client as VaultClient,
  networks as vaultNetworks,
} from "../../../packages/vault-client/src/index";
import {
  Client as LoanManagerClient,
  networks as loanManagerNetworks,
  type Loan,
  type PremiumConfig,
  type UserRisk,
} from "../../../packages/loan-manager-client/src/index";
import { signFreighterTransaction } from "@/lib/stellar-wallet";
import {
  Address,
  BASE_FEE,
  Contract,
  TransactionBuilder,
  scValToNative,
  rpc as StellarRpc,
} from "@stellar/stellar-sdk";

const DEFAULT_RPC_URL = "https://soroban-testnet.stellar.org";
const DEFAULT_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
// Token usado como "USDC" por el vault (SAC nativo de XLM en testnet por defecto).
// El contract id es público (no secreto); se puede sobreescribir con VITE_SOROBAN_USDC.
const DEFAULT_USDC_SAC =
  "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

function envString(name: string): string | null {
  const value = (import.meta.env[name] as string | undefined)?.trim();
  return value || null;
}

function stellarConfig() {
  const rpcUrl =
    envString("VITE_STELLAR_RPC_URL") ??
    envString("VITE_SOROBAN_RPC_URL") ??
    DEFAULT_RPC_URL;
  const networkPassphrase =
    envString("VITE_STELLAR_NETWORK_PASSPHRASE") ??
    envString("VITE_SOROBAN_NETWORK_PASSPHRASE") ??
    vaultNetworks.testnet.networkPassphrase ??
    DEFAULT_NETWORK_PASSPHRASE;
  const vaultContractId =
    envString("VITE_SOROBAN_VAULT") ??
    envString("VITE_STELLAR_VAULT_CONTRACT_ID") ??
    vaultNetworks.testnet.contractId;
  const loanManagerContractId =
    envString("VITE_SOROBAN_LOAN_MANAGER") ??
    envString("VITE_STELLAR_LOAN_MANAGER_CONTRACT_ID") ??
    loanManagerNetworks.testnet.contractId;

  return {
    rpcUrl,
    networkPassphrase,
    vaultContractId,
    loanManagerContractId,
    allowHttp: rpcUrl.startsWith("http://"),
  };
}

function loanManagerClient(publicKey: string): LoanManagerClient {
  const config = stellarConfig();
  return new LoanManagerClient({
    contractId: config.loanManagerContractId,
    networkPassphrase: config.networkPassphrase,
    rpcUrl: config.rpcUrl,
    publicKey,
    allowHttp: config.allowHttp,
  });
}

export type StellarCreditLineRead = {
  limit: bigint;
  loan: Loan;
  userRisk: UserRisk;
  nextBorrow: bigint;
  latePreview: readonly [bigint, bigint];
  premium: PremiumConfig;
};

export async function stellarReadCreditLine(
  borrower: string,
): Promise<StellarCreditLineRead> {
  const client = loanManagerClient(borrower);
  const options = { timeoutInSeconds: 20 };

  const [limit, loan, userRisk, nextBorrow, latePreview, premium] =
    await Promise.all([
      client.credit_limit({ account: borrower }, options),
      client.get_loan({ borrower }, options),
      client.get_user_risk({ account: borrower }, options),
      client.next_borrow_time({ account: borrower }, options),
      client.preview_loan_with_late({ borrower }, options),
      client.get_premium({ account: borrower }, options),
    ]);

  return {
    limit: limit.result,
    loan: loan.result,
    userRisk: userRisk.result,
    nextBorrow: nextBorrow.result,
    latePreview: latePreview.result,
    premium: premium.result,
  };
}

export async function stellarBorrowWithTerm(params: {
  borrower: string;
  amount: bigint;
  tenorDays: number;
  feeBps: number;
}): Promise<string> {
  const config = stellarConfig();
  const client = new VaultClient({
    contractId: config.vaultContractId,
    networkPassphrase: config.networkPassphrase,
    rpcUrl: config.rpcUrl,
    publicKey: params.borrower,
    allowHttp: config.allowHttp,
    signTransaction: async (xdr, opts) => ({
      signedTxXdr: await signFreighterTransaction(xdr, {
        address: opts?.address ?? params.borrower,
        networkPassphrase: opts?.networkPassphrase ?? config.networkPassphrase,
      }),
    }),
  });

  const assembled = await client.borrow_with_term(
    {
      borrower: params.borrower,
      amount: params.amount,
      tenor_days: params.tenorDays,
      fee_bps: params.feeBps,
    },
    { timeoutInSeconds: 60 },
  );
  const sent = await assembled.signAndSend();
  const hash =
    sent.getTransactionResponse?.txHash ?? sent.sendTransactionResponse?.hash;
  if (!hash) {
    throw new Error("Stellar transaction submitted without a transaction hash");
  }
  return hash;
}

export async function stellarRepay(params: {
  payer: string;
  borrower?: string;
}): Promise<string> {
  const config = stellarConfig();
  const client = new VaultClient({
    contractId: config.vaultContractId,
    networkPassphrase: config.networkPassphrase,
    rpcUrl: config.rpcUrl,
    publicKey: params.payer,
    allowHttp: config.allowHttp,
    signTransaction: async (xdr, opts) => ({
      signedTxXdr: await signFreighterTransaction(xdr, {
        address: opts?.address ?? params.payer,
        networkPassphrase: opts?.networkPassphrase ?? config.networkPassphrase,
      }),
    }),
  });

  const assembled = await client.repay(
    {
      payer: params.payer,
      borrower: params.borrower ?? params.payer,
    },
    { timeoutInSeconds: 60 },
  );
  const sent = await assembled.signAndSend();
  const hash =
    sent.getTransactionResponse?.txHash ?? sent.sendTransactionResponse?.hash;
  if (!hash) {
    throw new Error("Stellar transaction submitted without a transaction hash");
  }
  return hash;
}

/** Vault client wired to sign with Freighter (for deposit/withdraw writes). */
function signingVaultClient(publicKey: string): VaultClient {
  const config = stellarConfig();
  return new VaultClient({
    contractId: config.vaultContractId,
    networkPassphrase: config.networkPassphrase,
    rpcUrl: config.rpcUrl,
    publicKey,
    allowHttp: config.allowHttp,
    signTransaction: async (xdr, opts) => ({
      signedTxXdr: await signFreighterTransaction(xdr, {
        address: opts?.address ?? publicKey,
        networkPassphrase: opts?.networkPassphrase ?? config.networkPassphrase,
      }),
    }),
  });
}

function vaultTxHash(sent: {
  getTransactionResponse?: { txHash?: string };
  sendTransactionResponse?: { hash?: string };
}): string {
  const hash =
    sent.getTransactionResponse?.txHash ?? sent.sendTransactionResponse?.hash;
  if (!hash) {
    throw new Error("Stellar transaction submitted without a transaction hash");
  }
  return hash;
}

function usdcSacId(): string {
  return (
    envString("VITE_SOROBAN_USDC") ??
    envString("VITE_STELLAR_USDC") ??
    DEFAULT_USDC_SAC
  );
}

/**
 * Balance del token "USDC" (SAC) en la wallet del user — units crudas (que la
 * app trata como USDC de 6 decimales). Es el "Disponible" gastable: cuando el
 * user toma un loan, los fondos caen acá. Se lee simulando `balance(account)`
 * sobre el contrato del token. Devuelve 0 si la cuenta no existe / no fondeada.
 */
export async function stellarReadWalletUsdc(account: string): Promise<bigint> {
  const config = stellarConfig();
  const server = new StellarRpc.Server(config.rpcUrl, {
    allowHttp: config.allowHttp,
  });
  let source;
  try {
    source = await server.getAccount(account);
  } catch {
    return 0n; // cuenta inexistente / sin fondear
  }
  const contract = new Contract(usdcSacId());
  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(contract.call("balance", new Address(account).toScVal()))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (StellarRpc.Api.isSimulationError(sim)) return 0n;
  const retval = sim.result?.retval;
  if (!retval) return 0n;
  const val = scValToNative(retval) as unknown;
  return typeof val === "bigint" ? val : BigInt((val as number | string) ?? 0);
}

export type StellarVaultBalance = {
  shares: bigint;
  assets: bigint;
  totalAssets: bigint;
  totalSupply: bigint;
};

/**
 * User's vault position: shares held plus their USDC value (assets), derived
 * from the live share price (total_assets / total_supply). Also returns the
 * vault totals (TVL + supply) so the lend market can show TVL and share price.
 */
export async function stellarReadVaultBalance(
  account: string,
): Promise<StellarVaultBalance> {
  const config = stellarConfig();
  const client = new VaultClient({
    contractId: config.vaultContractId,
    networkPassphrase: config.networkPassphrase,
    rpcUrl: config.rpcUrl,
    publicKey: account,
    allowHttp: config.allowHttp,
  });
  const options = { timeoutInSeconds: 20 };
  const [shares, totalAssets, totalSupply] = await Promise.all([
    client.balance_of({ account }, options),
    client.total_assets(options),
    client.total_supply(options),
  ]);
  const s = shares.result;
  const ta = totalAssets.result;
  const ts = totalSupply.result;
  const assets = ts > 0n ? (s * ta) / ts : 0n;
  return { shares: s, assets, totalAssets: ta, totalSupply: ts };
}

/** Deposit `assets` USDC into the vault from the user's wallet (Freighter-signed). */
export async function stellarDeposit(params: {
  from: string;
  assets: bigint;
}): Promise<string> {
  const client = signingVaultClient(params.from);
  const assembled = await client.deposit(
    { from: params.from, assets: params.assets },
    { timeoutInSeconds: 60 },
  );
  const sent = await assembled.signAndSend();
  return vaultTxHash(sent);
}

/** Withdraw an EXACT `assets` USDC amount from the vault (Freighter-signed). */
export async function stellarWithdraw(params: {
  from: string;
  assets: bigint;
}): Promise<string> {
  const client = signingVaultClient(params.from);
  const assembled = await client.withdraw(
    { from: params.from, assets: params.assets },
    { timeoutInSeconds: 60 },
  );
  const sent = await assembled.signAndSend();
  return vaultTxHash(sent);
}
