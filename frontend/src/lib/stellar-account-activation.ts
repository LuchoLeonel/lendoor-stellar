// src/lib/stellar-account-activation.ts
/**
 * Activación de una wallet Stellar nueva en TESTNET (onboarding Privy, D1.2).
 *
 * Una wallet embebida recién creada no existe on-chain (sin XLM no puede
 * firmar nada) y no tiene trustline de USDC (el vault no le puede transferir
 * el préstamo). Esto la deja operable sin pasos manuales:
 *   1. si la cuenta no existe → friendbot (XLM de testnet);
 *   2. si no tiene trustline de USDC → changeTrust firmado por el usuario.
 *
 * Solo corre con la passphrase de testnet: en mainnet no hay friendbot y la
 * trustline la decide el usuario.
 */
import {
  Account,
  Asset,
  BASE_FEE,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

export const TESTNET_HORIZON_URL = "https://horizon-testnet.stellar.org";
export const TESTNET_FRIENDBOT_URL = "https://friendbot.stellar.org";
/** USDC de Circle en testnet (el settlement asset del vault). */
export const TESTNET_USDC_ISSUER =
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

type HorizonBalance = {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
};
type HorizonAccount = { sequence: string; balances: HorizonBalance[] };

export type ActivationResult =
  | { kind: "skipped"; reason: string }
  | { kind: "ready"; funded: boolean; trustlineAdded: boolean };

export type ActivationDeps = {
  address: string;
  networkPassphrase: string;
  /** Firma un XDR con la wallet del usuario y devuelve el XDR firmado. */
  signTransaction: (xdr: string) => Promise<string>;
  horizonUrl?: string;
  friendbotUrl?: string;
  usdcCode?: string;
  usdcIssuer?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

async function loadAccount(
  f: typeof fetch,
  horizon: string,
  address: string,
): Promise<HorizonAccount | null> {
  const res = await f(`${horizon}/accounts/${address}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Horizon ${res.status} al leer la cuenta`);
  return (await res.json()) as HorizonAccount;
}

export async function ensureTestnetAccountReady(
  deps: ActivationDeps,
): Promise<ActivationResult> {
  if (deps.networkPassphrase !== Networks.TESTNET) {
    return { kind: "skipped", reason: "no es testnet" };
  }
  const f = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const horizon = deps.horizonUrl ?? TESTNET_HORIZON_URL;
  const usdcCode = deps.usdcCode ?? "USDC";
  const usdcIssuer = deps.usdcIssuer ?? TESTNET_USDC_ISSUER;

  let account = await loadAccount(f, horizon, deps.address);
  let funded = false;
  if (!account) {
    const fb = await f(
      `${deps.friendbotUrl ?? TESTNET_FRIENDBOT_URL}/?addr=${encodeURIComponent(deps.address)}`,
    );
    // 400 de friendbot = "ya existe" (carrera con otra pestaña): seguimos.
    if (!fb.ok && fb.status !== 400) {
      throw new Error(`friendbot respondió ${fb.status}`);
    }
    funded = true;
    for (let i = 0; i < 10 && !account; i++) {
      await sleep(1_500);
      account = await loadAccount(f, horizon, deps.address);
    }
    if (!account) throw new Error("la cuenta no apareció en Horizon tras friendbot");
  }

  const hasTrustline = account.balances.some(
    (b) => b.asset_code === usdcCode && b.asset_issuer === usdcIssuer,
  );
  if (hasTrustline) return { kind: "ready", funded, trustlineAdded: false };

  const tx = new TransactionBuilder(new Account(deps.address, account.sequence), {
    fee: BASE_FEE,
    networkPassphrase: deps.networkPassphrase,
  })
    .addOperation(Operation.changeTrust({ asset: new Asset(usdcCode, usdcIssuer) }))
    .setTimeout(180)
    .build();

  const signed = await deps.signTransaction(tx.toXDR());
  const sub = await f(`${horizon}/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `tx=${encodeURIComponent(signed)}`,
  });
  if (!sub.ok) {
    const body = await sub.text().catch(() => "");
    throw new Error(`changeTrust rechazado por Horizon (${sub.status}): ${body.slice(0, 200)}`);
  }
  return { kind: "ready", funded, trustlineAdded: true };
}
