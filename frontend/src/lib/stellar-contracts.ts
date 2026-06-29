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

const DEFAULT_RPC_URL = "https://soroban-testnet.stellar.org";
const DEFAULT_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

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
