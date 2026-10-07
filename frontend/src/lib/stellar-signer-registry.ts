/**
 * Registro del firmante Stellar ACTIVO (D1.2, patrón adapter de Pollar).
 *
 * Los tres caminos de escritura (borrow, repay, deposit/withdraw) firmaban
 * llamando a Freighter directo. Para sumar Privy AL LADO — sin migrar ni
 * tocar la forma de los call sites — el firmante vigente vive acá: Freighter
 * es el default de siempre, y el provider de Privy lo reemplaza cuando el
 * usuario entra por email/social. Un solo punto de verdad, cero condicionales
 * repartidos por los call sites.
 */
import { signFreighterTransaction } from "./stellar-wallet";

export type StellarSignerKind = "freighter" | "privy";

export type StellarSigner = {
  kind: StellarSignerKind;
  /** Firma el XDR y devuelve el XDR firmado (mismo contrato que Freighter). */
  signTransaction: (
    xdr: string,
    opts: { address: string; networkPassphrase?: string | null },
  ) => Promise<string>;
};

const freighterSigner: StellarSigner = {
  kind: "freighter",
  signTransaction: (xdr, opts) => signFreighterTransaction(xdr, opts),
};

let active: StellarSigner = freighterSigner;

/** Pasar `null` restaura Freighter (p. ej. al desloguear de Privy). */
export function setActiveStellarSigner(signer: StellarSigner | null): void {
  active = signer ?? freighterSigner;
}

export function getActiveStellarSignerKind(): StellarSignerKind {
  return active.kind;
}

/** Lo que los call sites llaman en lugar de `signFreighterTransaction`. */
export function signActiveStellarTransaction(
  xdr: string,
  opts: { address: string; networkPassphrase?: string | null },
): Promise<string> {
  return active.signTransaction(xdr, opts);
}
