// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";

import {
  ensureTestnetAccountReady,
  TESTNET_USDC_ISSUER,
} from "@/lib/stellar-account-activation";

const kp = Keypair.random();
const address = kp.publicKey();

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

const noSleep = () => Promise.resolve();

describe("ensureTestnetAccountReady", () => {
  it("no hace nada fuera de testnet", async () => {
    const fetchImpl = vi.fn();
    const r = await ensureTestnetAccountReady({
      address,
      networkPassphrase: Networks.PUBLIC,
      signTransaction: vi.fn(),
      fetchImpl,
    });
    expect(r).toEqual({ kind: "skipped", reason: "no es testnet" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("cuenta lista con trustline: no fondea ni firma", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      json(200, {
        sequence: "1",
        balances: [
          { asset_type: "native" },
          { asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: TESTNET_USDC_ISSUER },
        ],
      }),
    );
    const sign = vi.fn();
    const r = await ensureTestnetAccountReady({
      address,
      networkPassphrase: Networks.TESTNET,
      signTransaction: sign,
      fetchImpl,
    });
    expect(r).toEqual({ kind: "ready", funded: false, trustlineAdded: false });
    expect(sign).not.toHaveBeenCalled();
  });

  it("cuenta nueva: friendbot y después changeTrust firmado por el usuario", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.includes("friendbot")) return json(200, {});
      if (url.endsWith("/transactions")) return json(200, { successful: true });
      // 1ra lectura: no existe; después de friendbot: existe sin trustline.
      return calls.filter((c) => c.includes("/accounts/")).length === 1
        ? json(404, {})
        : json(200, { sequence: "7", balances: [{ asset_type: "native" }] });
    });
    const sign = vi.fn(async (xdr: string) => {
      const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
      tx.sign(kp);
      return tx.toXDR();
    });

    const r = await ensureTestnetAccountReady({
      address,
      networkPassphrase: Networks.TESTNET,
      signTransaction: sign,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });

    expect(r).toEqual({ kind: "ready", funded: true, trustlineAdded: true });
    expect(calls.some((c) => c.includes("friendbot"))).toBe(true);
    expect(sign).toHaveBeenCalledTimes(1);
    const signedXdr = await sign.mock.results[0].value;
    const tx = TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET);
    expect("operations" in tx && tx.operations[0].type).toBe("changeTrust");
    expect(calls.at(-1)).toMatch(/^POST .*\/transactions$/);
  });

  it("propaga el error si Horizon rechaza el changeTrust", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith("/transactions")
        ? json(400, { extras: { result_codes: { transaction: "tx_bad_seq" } } })
        : json(200, { sequence: "1", balances: [{ asset_type: "native" }] }),
    );
    await expect(
      ensureTestnetAccountReady({
        address,
        networkPassphrase: Networks.TESTNET,
        signTransaction: async (x) => x,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/changeTrust rechazado/);
  });
});
