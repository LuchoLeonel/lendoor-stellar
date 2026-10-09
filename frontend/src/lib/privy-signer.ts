/**
 * Privy → Soroban signing bridge (D1.2).
 *
 * Privy's Stellar support is "Tier 2": the only primitive it exposes is
 * signing a RAW 32-byte hash with ed25519 (`useSignRawHash`,
 * `chainType: 'stellar'`). That is exactly what a Stellar signature is — for
 * the envelope it's ed25519 over `tx.hash()` — so a full wallet integration
 * reduces to: hash the tx, have Privy sign the hash, wrap the raw signature
 * in a DecoratedSignature with the account's hint, re-attach, re-encode.
 *
 * Assembly shape adapted from pollar-xyz/pollar (Apache-2.0,
 * packages/privy-server-adapter/src/stellar.ts — same SCF #45 round), with
 * two local gotchas handled here and nowhere else:
 *   - Privy returns the signature as 0x-prefixed HEX, while Stellar tooling
 *     (and our backend's SEP-53 verify) speaks base64. `normalizeRawSignature`
 *     accepts both plus raw bytes, and always yields the 64-byte form.
 *   - Privy expects the hash it signs to be 0x-prefixed hex
 *     (`hashHexForPrivy`), per Yield2Pay's working flow.
 *
 * The exported `makePrivySigner` matches the exact seam the generated
 * contract clients use (see stellar-contracts.ts): an async
 * `(xdr, opts) => ({ signedTxXdr })`, so Privy plugs in BESIDE Freighter —
 * the adapter pattern — instead of replacing it.
 */
import {
  Keypair,
  Transaction,
  TransactionBuilder,
  xdr as stellarXdr,
} from "@stellar/stellar-sdk";
import { Buffer } from "buffer";

const SIGNATURE_BYTES = 64;

/** `'0x' + hex` del hash del sobre — la forma que `signRawHash` de Privy espera. */
export function hashHexForPrivy(tx: Transaction): string {
  return "0x" + tx.hash().toString("hex");
}

/**
 * Acepta la firma cruda en 0x-hex (Privy), hex pelado, base64 o bytes, y
 * devuelve SIEMPRE los 64 bytes. Cualquier otra longitud es un error de
 * integración y revienta acá, no en la red.
 */
export function normalizeRawSignature(sig: string | Uint8Array): Buffer {
  let buf: Buffer;
  if (typeof sig !== "string") {
    buf = Buffer.from(sig);
  } else if (/^0x[0-9a-fA-F]+$/.test(sig)) {
    buf = Buffer.from(sig.slice(2), "hex");
  } else if (/^[0-9a-fA-F]+$/.test(sig) && sig.length === SIGNATURE_BYTES * 2) {
    buf = Buffer.from(sig, "hex");
  } else {
    buf = Buffer.from(sig, "base64");
  }
  if (buf.length !== SIGNATURE_BYTES) {
    throw new Error(
      `raw ed25519 signature must be ${SIGNATURE_BYTES} bytes, got ${buf.length}`,
    );
  }
  return buf;
}

/**
 * Envuelve la firma cruda en la DecoratedSignature que el sobre espera:
 * hint (últimos 4 bytes de la clave pública) + los 64 bytes.
 */
export function attachRawSignature(
  tx: Transaction,
  signerAddress: string,
  rawSignature: string | Uint8Array,
): Transaction {
  const signature = normalizeRawSignature(rawSignature);
  const hint = Keypair.fromPublicKey(signerAddress).signatureHint();
  tx.signatures.push(
    new stellarXdr.DecoratedSignature({ hint, signature }),
  );
  return tx;
}

/** La función que Privy provee (envuelta por el caller del hook). */
export type RawHashSigner = (hashHex0x: string) => Promise<string | Uint8Array>;

/**
 * Fabrica el firmante con la MISMA interfaz que el de Freighter en
 * stellar-contracts.ts, para enchufarlo al lado sin tocar los call sites:
 * `signTransaction: async (xdr, opts) => ({ signedTxXdr })`.
 */
export function makePrivySigner(options: {
  address: string;
  signRawHash: RawHashSigner;
  networkPassphrase: string;
}) {
  const { address, signRawHash, networkPassphrase } = options;
  return {
    address,
    signTransaction: async (
      xdrBase64: string,
      opts?: { networkPassphrase?: string | null },
    ): Promise<{ signedTxXdr: string }> => {
      const passphrase = opts?.networkPassphrase ?? networkPassphrase;
      const tx = TransactionBuilder.fromXDR(xdrBase64, passphrase);
      if (!(tx instanceof Transaction)) {
        // Los fee-bump se firman por el sponsor en su propio camino (D1.2
        // sponsorship); el usuario firma siempre el sobre interno.
        throw new Error("privy signer only signs plain transaction envelopes");
      }
      const rawSig = await signRawHash(hashHexForPrivy(tx));
      attachRawSignature(tx, address, rawSig);
      return { signedTxXdr: tx.toXDR() };
    },
  };
}
