// @vitest-environment node
/**
 * El supuesto más riesgoso de D1.2, probado SIN Privy: que una firma ed25519
 * cruda sobre tx.hash() — que es lo único que Privy sabe hacer en Stellar —
 * ensamblada por nuestro puente, produce un sobre que la red aceptaría.
 * Acá "Privy" es un Keypair local que firma el hash crudo, igual que
 * signRawHash; la verificación es la del propio SDK (Keypair.verify y la
 * DecoratedSignature del sobre), no un mock nuestro.
 */
import { describe, expect, it } from "vitest";
import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { Buffer } from "buffer";
import { createHash } from "node:crypto";
import {
  attachRawSignature,
  hashHexForPrivy,
  makePrivyAuthMessageSigner,
  makePrivySigner,
  normalizeRawSignature,
  sep53MessageHashHexForPrivy,
} from "../privy-signer";

const PASSPHRASE = Networks.TESTNET;

function buildTx(source: Keypair): Transaction {
  const account = new Account(source.publicKey(), "0");
  return new TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(
      Operation.payment({
        destination: source.publicKey(),
        asset: Asset.native(),
        amount: "1",
      }),
    )
    .setTimeout(300)
    .build();
}

/** Simula signRawHash de Privy: firma los 32 bytes crudos y devuelve 0x-hex. */
function privyOracle(kp: Keypair) {
  return async (hashHex0x: string) => {
    expect(hashHex0x.startsWith("0x")).toBe(true); // el gotcha del prefijo
    const hash = Buffer.from(hashHex0x.slice(2), "hex");
    expect(hash.length).toBe(32);
    return "0x" + kp.sign(hash).toString("hex");
  };
}

describe("normalizeRawSignature", () => {
  const kp = Keypair.random();
  const sig = kp.sign(Buffer.alloc(32, 7));

  it("acepta 0x-hex (lo que devuelve Privy), hex pelado, base64 y bytes", () => {
    for (const form of [
      "0x" + sig.toString("hex"),
      sig.toString("hex"),
      sig.toString("base64"),
      new Uint8Array(sig),
    ]) {
      // comparación por CONTENIDO: en este repo conviven dos clases de Buffer
      // (polyfill del navegador vs la del SDK) y .equals() exige su propia clase
      // — la misma trampa de realms que rompió todas las firmas de Geko-Mobile.
      expect(new Uint8Array(normalizeRawSignature(form))).toEqual(new Uint8Array(sig));
    }
  });

  it("revienta con longitudes que no son 64 bytes, acá y no en la red", () => {
    expect(() => normalizeRawSignature("0xdeadbeef")).toThrow(/64 bytes/);
    expect(() => normalizeRawSignature(Buffer.alloc(32))).toThrow(/64 bytes/);
  });
});

describe("attachRawSignature", () => {
  it("la firma cruda ensamblada verifica contra el hash del sobre y lleva el hint correcto", () => {
    const kp = Keypair.random();
    const tx = buildTx(kp);
    const raw = kp.sign(tx.hash());

    attachRawSignature(tx, kp.publicKey(), "0x" + raw.toString("hex"));

    expect(tx.signatures).toHaveLength(1);
    const decorated = tx.signatures[0];
    // el hint son los últimos 4 bytes de la clave pública
    expect(new Uint8Array(decorated.hint())).toEqual(new Uint8Array(kp.signatureHint()));
    // y la firma es ed25519 válida sobre el hash del sobre — verificada por el SDK
    expect(
      kp.verify(tx.hash(), decorated.signature() as Buffer),
    ).toBe(true);
  });
});

describe("makePrivySigner — la misma interfaz que el firmante de Freighter", () => {
  it("firma un sobre real de punta a punta y el XDR resultante verifica", async () => {
    const kp = Keypair.random();
    const tx = buildTx(kp);

    const signer = makePrivySigner({
      address: kp.publicKey(),
      signRawHash: privyOracle(kp),
      networkPassphrase: PASSPHRASE,
    });

    const { signedTxXdr } = await signer.signTransaction(tx.toXDR());
    const roundTripped = TransactionBuilder.fromXDR(
      signedTxXdr,
      PASSPHRASE,
    ) as Transaction;

    expect(roundTripped.signatures).toHaveLength(1);
    expect(
      kp.verify(
        roundTripped.hash(),
        roundTripped.signatures[0].signature() as Buffer,
      ),
    ).toBe(true);
  });

  it("respeta el networkPassphrase del opt, como hace el seam de Freighter", async () => {
    const kp = Keypair.random();
    const account = new Account(kp.publicKey(), "0");
    const tx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: Networks.PUBLIC,
    })
      .addOperation(
        Operation.payment({
          destination: kp.publicKey(),
          asset: Asset.native(),
          amount: "1",
        }),
      )
      .setTimeout(300)
      .build();

    const signer = makePrivySigner({
      address: kp.publicKey(),
      signRawHash: privyOracle(kp),
      networkPassphrase: PASSPHRASE, // default equivocado a propósito
    });
    const { signedTxXdr } = await signer.signTransaction(tx.toXDR(), {
      networkPassphrase: Networks.PUBLIC,
    });
    const back = TransactionBuilder.fromXDR(
      signedTxXdr,
      Networks.PUBLIC,
    ) as Transaction;
    expect(kp.verify(back.hash(), back.signatures[0].signature() as Buffer)).toBe(
      true,
    );
  });
});

describe("firma de mensajes de auth (SEP-53) con Privy", () => {
  it("paridad con el backend: misma construccion de hash que auth.service.ts", () => {
    const message = "lendoor quiere verificar tu wallet\nnonce=abc123";
    // replica LITERAL de la verificacion del backend:
    //   sha256("Stellar Signed Message:\n" + mensaje utf8)
    const backendHash = createHash("sha256")
      .update("Stellar Signed Message:\n", "utf8")
      .update(Buffer.from(message, "utf8"))
      .digest();
    expect(sep53MessageHashHexForPrivy(message)).toBe(
      "0x" + backendHash.toString("hex"),
    );
  });

  it("la firma que produce verifica como la verifica el backend (ed25519 sobre el hash)", async () => {
    const kp = Keypair.random();
    const message = `auth wallet=${kp.publicKey()} nonce=zzz`;
    const backendHash = createHash("sha256")
      .update("Stellar Signed Message:\n", "utf8")
      .update(Buffer.from(message, "utf8"))
      .digest();

    // "Privy" = firmar el hash crudo y devolver 0x-hex, igual que signRawHash
    const signAuth = makePrivyAuthMessageSigner({
      signRawHash: async (hashHex0x) => {
        expect(hashHex0x).toBe("0x" + backendHash.toString("hex"));
        return "0x" + kp.sign(backendHash).toString("hex");
      },
    });

    const signatureB64 = await signAuth(message);
    // base64 de 64 bytes — el formato que /auth/stellar/verify decodifica
    const sig = Buffer.from(signatureB64, "base64");
    expect(sig.length).toBe(64);
    expect(kp.verify(backendHash, sig)).toBe(true);
  });
});
