/**
 * Parser del mensaje CCTP V2 + hook data del CctpForwarder — D1.1.
 *
 * Adaptado de lumenline-labs/lumenline (Apache-2.0),
 * packages/sdk/src/rails/usdc-cctp/message.ts. El layout viene de la guía
 * técnica de Circle (developers.circle.com/cctp/references/technical-guide) y
 * ellos lo cruzaron contra el `decodedMessage` de burns reales en mainnet.
 *
 * Header (148 bytes): version u32 | sourceDomain u32 | destinationDomain u32 |
 *   nonce 32 | sender 32 | recipient 32 | destinationCaller 32 |
 *   minFinalityThreshold u32 | finalityThresholdExecuted u32 | body…
 * BurnMessage body (228 bytes + hookData): version u32 | burnToken 32 |
 *   mintRecipient 32 | amount u256 | messageSender 32 | maxFee u256 |
 *   feeExecuted u256 | expirationBlock u256 | hookData…
 *
 * De acá salen las tres cosas que la máquina de estados necesita y que JAMÁS
 * se toman de un input del usuario: el nonce (LA clave de idempotencia), el
 * amount (unidades de 6 decimales, siempre — el rescale a 7 pasa en
 * stellar-mint.ts y en ningún otro lado) y el forwardRecipient del hook.
 */
import { StrKey } from '@stellar/stellar-sdk';

export class CctpMessageError extends Error {}

export interface CctpMessageHeader {
  readonly version: number;
  readonly sourceDomain: number;
  readonly destinationDomain: number;
  readonly nonce: `0x${string}`;
  readonly sender: Uint8Array;
  readonly recipient: Uint8Array;
  readonly destinationCaller: Uint8Array;
  readonly minFinalityThreshold: number;
  readonly finalityThresholdExecuted: number;
}

export interface CctpBurnBody {
  readonly version: number;
  readonly burnToken: Uint8Array;
  readonly mintRecipient: Uint8Array;
  /** Unidades USDC de 6 decimales SIEMPRE (Circle: "six-decimal subunits"). */
  readonly amount: bigint;
  readonly messageSender: Uint8Array;
  readonly maxFee: bigint;
  readonly feeExecuted: bigint;
  readonly expirationBlock: bigint;
  readonly hookData: Uint8Array;
}

const HEADER_BYTES = 148;
const BODY_FIXED_BYTES = 228;

function u32(bytes: Uint8Array, offset: number): number {
  return (
    (((bytes[offset] ?? 0) << 24) |
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0)) >>>
    0 // sin el >>> 0, un byte alto >= 0x80 da un u32 NEGATIVO en JS
  );
}

function u256(bytes: Uint8Array, offset: number): bigint {
  let value = 0n;
  for (let i = 0; i < 32; i += 1) {
    value = (value << 8n) | BigInt(bytes[offset + i] ?? 0);
  }
  return value;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) {
    throw new CctpMessageError('message is not valid hex');
  }
  return new Uint8Array(Buffer.from(clean, 'hex'));
}

export function bytesToHex(bytes: Uint8Array): `0x${string}` {
  return `0x${Buffer.from(bytes).toString('hex')}`;
}

export function parseCctpBurnBody(body: Uint8Array): CctpBurnBody {
  if (body.length < BODY_FIXED_BYTES) {
    throw new CctpMessageError(
      `burn message body is ${body.length} bytes, expected at least ${BODY_FIXED_BYTES}`,
    );
  }
  return {
    version: u32(body, 0),
    burnToken: body.slice(4, 36),
    mintRecipient: body.slice(36, 68),
    amount: u256(body, 68),
    messageSender: body.slice(100, 132),
    maxFee: u256(body, 132),
    feeExecuted: u256(body, 164),
    expirationBlock: u256(body, 196),
    hookData: body.slice(BODY_FIXED_BYTES),
  };
}

export function parseCctpMessage(messageHex: string): {
  header: CctpMessageHeader;
  body: CctpBurnBody;
} {
  const bytes = hexToBytes(messageHex);
  if (bytes.length < HEADER_BYTES) {
    throw new CctpMessageError(
      `message is ${bytes.length} bytes, expected at least ${HEADER_BYTES}`,
    );
  }
  return {
    header: {
      version: u32(bytes, 0),
      sourceDomain: u32(bytes, 4),
      destinationDomain: u32(bytes, 8),
      nonce: bytesToHex(bytes.slice(12, 44)),
      sender: bytes.slice(44, 76),
      recipient: bytes.slice(76, 108),
      destinationCaller: bytes.slice(108, 140),
      minFinalityThreshold: u32(bytes, 140),
      finalityThresholdExecuted: u32(bytes, 144),
    },
    body: parseCctpBurnBody(bytes.slice(HEADER_BYTES)),
  };
}

/**
 * Hook data del CctpForwarder (referencia de Circle para Stellar, confirmado
 * por lumenline contra mensajes reales inbound en mainnet):
 *   bytes 0-23 en cero (reservado Circle) | u32 version = 0 | u32 L |
 *   forwardRecipient strkey como UTF-8 | payload opcional
 * El recipient REAL del mint viaja acá — nunca en mintRecipient, que tiene
 * que ser el forwarder.
 */
export const HOOK_MAGIC_BYTES = 24;
export const HOOK_VERSION = 0;
const HOOK_HEADER_BYTES = 32;

function assertStellarAddress(addr: string): void {
  if (
    !StrKey.isValidEd25519PublicKey(addr) &&
    !StrKey.isValidContract(addr) &&
    !StrKey.isValidMed25519PublicKey(addr)
  ) {
    throw new CctpMessageError(`not a valid Stellar address (G/C/M): ${addr}`);
  }
}

export function buildForwarderHookData(
  forwardRecipient: string,
  payload: Uint8Array = new Uint8Array(0),
): Uint8Array {
  assertStellarAddress(forwardRecipient);
  const recipientBytes = new TextEncoder().encode(forwardRecipient);
  const out = new Uint8Array(HOOK_HEADER_BYTES + recipientBytes.length + payload.length);
  const view = new DataView(out.buffer);
  view.setUint32(HOOK_MAGIC_BYTES, HOOK_VERSION);
  view.setUint32(HOOK_MAGIC_BYTES + 4, recipientBytes.length);
  out.set(recipientBytes, HOOK_HEADER_BYTES);
  out.set(payload, HOOK_HEADER_BYTES + recipientBytes.length);
  return out;
}

export interface ForwarderHookData {
  readonly version: number;
  readonly forwardRecipient: string;
  readonly payload: Uint8Array;
}

export function parseForwarderHookData(hookData: Uint8Array): ForwarderHookData {
  if (hookData.length < HOOK_HEADER_BYTES) {
    throw new CctpMessageError(
      `hook data is ${hookData.length} bytes, expected at least ${HOOK_HEADER_BYTES}`,
    );
  }
  const view = new DataView(hookData.buffer, hookData.byteOffset, hookData.byteLength);
  const version = view.getUint32(HOOK_MAGIC_BYTES);
  const length = view.getUint32(HOOK_MAGIC_BYTES + 4);
  if (HOOK_HEADER_BYTES + length > hookData.length) {
    throw new CctpMessageError('hook data length prefix exceeds the data');
  }
  const forwardRecipient = new TextDecoder().decode(
    hookData.slice(HOOK_HEADER_BYTES, HOOK_HEADER_BYTES + length),
  );
  assertStellarAddress(forwardRecipient);
  return { version, forwardRecipient, payload: hookData.slice(HOOK_HEADER_BYTES + length) };
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Contract id (C…) → los 32 bytes crudos que viajan en el mensaje CCTP. */
export function contractAddressToBytes32(contractId: string): Uint8Array {
  if (!StrKey.isValidContract(contractId)) {
    throw new CctpMessageError(`not a valid contract address: ${contractId}`);
  }
  return new Uint8Array(StrKey.decodeContract(contractId));
}

/**
 * LA guarda anti-fondos-varados. Para cualquier burn con destino Stellar,
 * mintRecipient Y destinationCaller tienen que ser el contract id del
 * CctpForwarder (Circle: si no, los fondos quedan "permanently stuck and
 * cannot be recovered"). Se valida ANTES de armar el burn en EVM y también al
 * recibir el mensaje de Iris — las dos puntas, porque un burn armado por otro
 * puede llegar igual a nuestro poller.
 */
export function assertForwarderFields(
  fields: { mintRecipient: Uint8Array; destinationCaller: Uint8Array },
  forwarderContractId: string,
): void {
  const forwarder = contractAddressToBytes32(forwarderContractId);
  if (!equalBytes(fields.mintRecipient, forwarder)) {
    throw new CctpMessageError(
      `mintRecipient must be the CctpForwarder contract id ${forwarderContractId}; refusing to build a burn that would strand funds`,
    );
  }
  if (!equalBytes(fields.destinationCaller, forwarder)) {
    throw new CctpMessageError(
      `destinationCaller must be the CctpForwarder contract id ${forwarderContractId}; refusing to build a burn that would strand funds`,
    );
  }
}
