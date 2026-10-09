import {
  assertForwarderFields,
  buildForwarderHookData,
  bytesToHex,
  CctpMessageError,
  contractAddressToBytes32,
  hexToBytes,
  parseCctpMessage,
  parseForwarderHookData,
} from './cctp-message';
import { STELLAR_TESTNET } from './cctp-chains';

const FORWARDER_32 = contractAddressToBytes32(STELLAR_TESTNET.cctpForwarder);
const G_ADDR = 'GDCZFUNJ7MXWBIQ6UUTJRGZIJF5EMRVJCSK73MA2U7K57GWMA4N3P6SL';

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
  const hook = over.hookData ?? buildForwarderHookData(G_ADDR);
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

describe('parseCctpMessage — layout V2 de Circle', () => {
  it('round-trip: lo que se arma es lo que se parsea', () => {
    const parsed = parseCctpMessage(buildTestMessage());
    expect(parsed.header.sourceDomain).toBe(6);
    expect(parsed.header.destinationDomain).toBe(27);
    expect(parsed.header.nonce).toBe(`0x${'ab'.repeat(32)}`);
    expect(parsed.body.amount).toBe(5_000_000n);
    expect(bytesToHex(parsed.body.mintRecipient)).toBe(bytesToHex(FORWARDER_32));
    const hook = parseForwarderHookData(parsed.body.hookData);
    expect(hook.forwardRecipient).toBe(G_ADDR);
  });

  it('un u32 con el bit alto encendido parsea POSITIVO (fix sobre la referencia)', () => {
    // 0x80000001 como destinationDomain: el OR de JS sin >>> 0 daría negativo
    const raw = hexToBytes(buildTestMessage());
    raw[8] = 0x80;
    raw[9] = 0x00;
    raw[10] = 0x00;
    raw[11] = 0x01;
    const parsed = parseCctpMessage(bytesToHex(raw));
    expect(parsed.header.destinationDomain).toBe(0x80000001);
    expect(parsed.header.destinationDomain).toBeGreaterThan(0);
  });

  it('mensaje corto o hex inválido tiran CctpMessageError, nunca basura', () => {
    expect(() => parseCctpMessage('0x1234')).toThrow(CctpMessageError);
    expect(() => parseCctpMessage('0xzz')).toThrow(CctpMessageError);
    expect(() => parseCctpMessage('0x123')).toThrow(CctpMessageError); // impar
  });
});

describe('hook data del forwarder', () => {
  it('round-trip con payload', () => {
    const payload = new Uint8Array([1, 2, 3]);
    const hook = parseForwarderHookData(buildForwarderHookData(G_ADDR, payload));
    expect(hook.version).toBe(0);
    expect(hook.forwardRecipient).toBe(G_ADDR);
    expect(Array.from(hook.payload)).toEqual([1, 2, 3]);
  });

  it('acepta contract address (C…) como recipient', () => {
    const hook = parseForwarderHookData(buildForwarderHookData(STELLAR_TESTNET.usdcSac));
    expect(hook.forwardRecipient).toBe(STELLAR_TESTNET.usdcSac);
  });

  it('recipient que no es G/C/M válido tira al ARMAR, no al enviar', () => {
    expect(() => buildForwarderHookData('not-an-address')).toThrow(CctpMessageError);
    expect(() => buildForwarderHookData('0x036CbD53842c5426634e7929541eC2318f3dCF7e')).toThrow(
      CctpMessageError,
    );
  });

  it('length prefix que excede los datos tira (hook truncado en tránsito)', () => {
    const good = buildForwarderHookData(G_ADDR);
    expect(() => parseForwarderHookData(good.slice(0, 40))).toThrow(CctpMessageError);
  });
});

describe('assertForwarderFields — la guarda anti-fondos-varados', () => {
  it('pasa cuando ambos campos son el forwarder', () => {
    expect(() =>
      assertForwarderFields(
        { mintRecipient: FORWARDER_32, destinationCaller: FORWARDER_32 },
        STELLAR_TESTNET.cctpForwarder,
      ),
    ).not.toThrow();
  });

  it('tira si mintRecipient o destinationCaller son OTRA cosa', () => {
    const wrong = new Uint8Array(32).fill(7);
    expect(() =>
      assertForwarderFields(
        { mintRecipient: wrong, destinationCaller: FORWARDER_32 },
        STELLAR_TESTNET.cctpForwarder,
      ),
    ).toThrow(/strand/);
    expect(() =>
      assertForwarderFields(
        { mintRecipient: FORWARDER_32, destinationCaller: wrong },
        STELLAR_TESTNET.cctpForwarder,
      ),
    ).toThrow(/strand/);
  });
});
