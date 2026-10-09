/**
 * Lado Stellar de la entrega CCTP — D1.1.
 *
 * Adaptado de lumenline-labs/lumenline (Apache-2.0),
 * packages/sdk/src/rails/usdc-cctp/stellar.ts: el forwarder expone
 * `mint_and_forward(message: Bytes, attestation: Bytes)` — dos blobs
 * posicionales, verbatim del dump de la interfaz mainnet. El recipient real
 * NUNCA es un argumento del call: viaja dentro del hookData del message y el
 * forwarder lo resuelve on-chain.
 *
 * `planDelivery` es la función PURA que el executor usa: valida todo lo que
 * puede romperse (dominio, forwarder, hook) ANTES de gastar un fee, y
 * devuelve el plan con el nonce (idempotencia), los montos en 6 y 7
 * decimales y los args listos para armar la tx.
 */
import { Address, nativeToScVal, xdr } from '@stellar/stellar-sdk';

import { StellarCctpConfig } from './cctp-chains';
import {
  assertForwarderFields,
  CctpMessageError,
  hexToBytes,
  parseCctpMessage,
  parseForwarderHookData,
} from './cctp-message';

/** Orden de argumentos de CctpForwarder.mint_and_forward, verbatim. */
export const MINT_AND_FORWARD_ARGS = ['message', 'attestation'] as const;

export function mintAndForwardScVals(message: Uint8Array, attestation: Uint8Array): xdr.ScVal[] {
  return [
    nativeToScVal(Buffer.from(message), { type: 'bytes' }),
    nativeToScVal(Buffer.from(attestation), { type: 'bytes' }),
  ];
}

/**
 * EL único punto de rescale 6 → 7 decimales de todo el backend (el contrato
 * que la máquina de estados documenta en CctpTransfer.amountUsdc6). El
 * mensaje CCTP siempre habla en 6; el SAC de Stellar en 7. ×10 exacto,
 * nunca puede perder precisión en esta dirección.
 */
export function usdc6ToStellar7(amountUsdc6: bigint): bigint {
  if (amountUsdc6 < 0n) throw new RangeError(`negative amount: ${amountUsdc6}`);
  return amountUsdc6 * 10n;
}

/**
 * Args de vault.deposit_from(payer, beneficiary, assets) — la entrada que el
 * vault tiene EXACTAMENTE para esto: el relayer (que recibió el USDC
 * minteado como forwardRecipient) deposita y las shares se acreditan al
 * beneficiary. assets en subunidades de 7 decimales.
 */
export function depositFromScVals(
  payer: string,
  beneficiary: string,
  assets7: bigint,
): xdr.ScVal[] {
  return [
    new Address(payer).toScVal(),
    new Address(beneficiary).toScVal(),
    nativeToScVal(assets7, { type: 'i128' }),
  ];
}

export interface DeliveryPlan {
  /** nonce del header CCTP — LA clave de idempotencia de la fila. */
  readonly nonce: `0x${string}`;
  readonly sourceDomain: number;
  /** unidades del mensaje (6 decimales) — lo que guarda CctpTransfer. */
  readonly amountUsdc6: bigint;
  /** subunidades Stellar (7 decimales) — lo que pide deposit_from. */
  readonly amount7: bigint;
  /** a quién forwardea el forwarder (del hookData) — G/C/M. */
  readonly forwardRecipient: string;
  /** args listos para la invocación mint_and_forward. */
  readonly mintArgs: xdr.ScVal[];
}

/**
 * Valida un (message, attestation) de Iris y devuelve el plan de entrega.
 * Tira CctpMessageError ante CUALQUIER cosa que haría perder fondos o
 * entregar mal:
 * - destino que no es nuestro dominio Stellar;
 * - mintRecipient/destinationCaller que no son el forwarder (fondos varados);
 * - hookData ausente o malformado (no sabríamos de quién es la plata);
 * - amount cero (mensaje absurdo, no gastamos fee en él).
 */
export function planDelivery(
  messageHex: string,
  attestationHex: string,
  config: StellarCctpConfig,
): DeliveryPlan {
  const { header, body } = parseCctpMessage(messageHex);
  if (header.destinationDomain !== config.domain) {
    throw new CctpMessageError(
      `message destination domain is ${header.destinationDomain}, expected Stellar (${config.domain})`,
    );
  }
  // mintRecipient vive en el BODY; destinationCaller en el HEADER — pasarle
  // el body entero compila en ts-jest (transpile-only) y revienta en runtime.
  assertForwarderFields(
    { mintRecipient: body.mintRecipient, destinationCaller: header.destinationCaller },
    config.cctpForwarder,
  );
  if (body.amount <= 0n) {
    throw new CctpMessageError('burn amount is zero; refusing to submit a mint for it');
  }
  const hook = parseForwarderHookData(body.hookData);
  const message = hexToBytes(messageHex);
  const attestation = hexToBytes(attestationHex);
  if (attestation.length === 0) {
    throw new CctpMessageError('empty attestation; Iris sentinel leaked past the client');
  }
  return {
    nonce: header.nonce,
    sourceDomain: header.sourceDomain,
    amountUsdc6: body.amount,
    amount7: usdc6ToStellar7(body.amount),
    forwardRecipient: hook.forwardRecipient,
    mintArgs: mintAndForwardScVals(message, attestation),
  };
}
