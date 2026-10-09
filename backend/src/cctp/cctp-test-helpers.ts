/**
 * Helpers de test del modulo CCTP — NO es un .spec: importar un spec desde
 * otro re-registra sus describes en el suite importador y los tests corren
 * duplicados (review PR #5).
 */
import { STELLAR_TESTNET } from './cctp-chains';
import {
  buildForwarderHookData,
  bytesToHex,
  contractAddressToBytes32,
} from './cctp-message';

export const TEST_G_ADDR = 'GDCZFUNJ7MXWBIQ6UUTJRGZIJF5EMRVJCSK73MA2U7K57GWMA4N3P6SL';
export const FORWARDER_32 = contractAddressToBytes32(STELLAR_TESTNET.cctpForwarder);

/** Arma un mensaje CCTP V2 sintético byte a byte (header 148 + body 228 + hook). */
export function buildTestMessage(over: {
  destinationDomain?: number;
  sourceDomain?: number;
  nonceByte?: number;
  mintRecipient?: Uint8Array;
  destinationCaller?: Uint8Array;
  amount?: bigint;
  hookData?: Uint8Array;
} = {}): string {
  const hook = over.hookData ?? buildForwarderHookData(TEST_G_ADDR);
  const msg = new Uint8Array(148 + 228 + hook.length);
  const view = new DataView(msg.buffer);
  // header
  view.setUint32(0, 1); // version
  view.setUint32(4, over.sourceDomain ?? 6); // Base Sepolia
  view.setUint32(8, over.destinationDomain ?? 27); // Stellar
  msg.fill(over.nonceByte ?? 0xab, 12, 44); // nonce
  msg.set(over.mintRecipient ?? FORWARDER_32, 76); // recipient (header)
  msg.set(over.destinationCaller ?? FORWARDER_32, 108);
  view.setUint32(140, 2000); // minFinalityThreshold
  view.setUint32(144, 2000); // finalityThresholdExecuted
  // body (arranca en 148)
  view.setUint32(148 + 0, 1); // body version
  msg.fill(0x11, 148 + 4, 148 + 36); // burnToken
  msg.set(over.mintRecipient ?? FORWARDER_32, 148 + 36); // mintRecipient
  const amount = over.amount ?? 5_000_000n; // 5 USDC en 6 dp
  for (let i = 0; i < 32; i += 1) {
    msg[148 + 68 + 31 - i] = Number((amount >> BigInt(8 * i)) & 0xffn);
  }
  msg.fill(0x22, 148 + 100, 148 + 132); // messageSender
  msg.set(hook, 148 + 228);
  return bytesToHex(msg);
}
