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
import { buildTestMessage } from './cctp-test-helpers';
import { STELLAR_TESTNET } from './cctp-chains';

const FORWARDER_32 = contractAddressToBytes32(STELLAR_TESTNET.cctpForwarder);
const G_ADDR = 'GDCZFUNJ7MXWBIQ6UUTJRGZIJF5EMRVJCSK73MA2U7K57GWMA4N3P6SL';


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
