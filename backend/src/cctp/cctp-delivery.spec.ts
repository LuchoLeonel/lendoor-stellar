import { BASE_SEPOLIA, FINALITY_STANDARD, STELLAR_TESTNET } from './cctp-chains';
import {
  buildForwarderHookData,
  bytesToHex,
  CctpMessageError,
  contractAddressToBytes32,
  parseForwarderHookData,
  hexToBytes,
} from './cctp-message';
import { buildBurnToStellar, TOKEN_MESSENGER_V2_IFACE, ERC20_IFACE } from './evm-burn';
import {
  depositFromScVals,
  planDelivery,
  usdc6ToStellar7,
} from './stellar-mint';
import { buildTestMessage } from './cctp-test-helpers';

const G_ADDR = 'GDCZFUNJ7MXWBIQ6UUTJRGZIJF5EMRVJCSK73MA2U7K57GWMA4N3P6SL';
const FORWARDER_32 = contractAddressToBytes32(STELLAR_TESTNET.cctpForwarder);

describe('buildBurnToStellar — el calldata que se firma en Base Sepolia', () => {
  const plan = buildBurnToStellar({
    config: BASE_SEPOLIA,
    stellarDomain: STELLAR_TESTNET.domain,
    forwarderContractId: STELLAR_TESTNET.cctpForwarder,
    forwardRecipient: G_ADDR,
    amountUsdc6: 5_000_000n,
  });

  it('el approve aprueba EXACTAMENTE el monto al TokenMessengerV2', () => {
    const [spender, amount] = ERC20_IFACE.decodeFunctionData('approve', plan.approveData);
    expect(spender).toBe(BASE_SEPOLIA.tokenMessengerV2);
    expect(amount).toBe(5_000_000n);
    expect(plan.usdc).toBe(BASE_SEPOLIA.usdc);
  });

  it('el burn decodea de vuelta con forwarder en AMBOS campos y el recipient en el hook', () => {
    const d = TOKEN_MESSENGER_V2_IFACE.decodeFunctionData('depositForBurnWithHook', plan.burnData);
    expect(d[0]).toBe(5_000_000n); // amount
    expect(Number(d[1])).toBe(27); // destinationDomain = Stellar
    expect(d[2]).toBe(bytesToHex(FORWARDER_32)); // mintRecipient
    expect(d[3]).toBe(BASE_SEPOLIA.usdc); // burnToken
    expect(d[4]).toBe(bytesToHex(FORWARDER_32)); // destinationCaller
    expect(d[5]).toBe(0n); // maxFee: Standard Transfer no cobra
    expect(Number(d[6])).toBe(FINALITY_STANDARD);
    const hook = parseForwarderHookData(hexToBytes(d[7] as string));
    expect(hook.forwardRecipient).toBe(G_ADDR);
  });

  it('monto cero o negativo ni siquiera encodea', () => {
    const args = {
      config: BASE_SEPOLIA,
      stellarDomain: 27,
      forwarderContractId: STELLAR_TESTNET.cctpForwarder,
      forwardRecipient: G_ADDR,
    };
    expect(() => buildBurnToStellar({ ...args, amountUsdc6: 0n })).toThrow(RangeError);
    expect(() => buildBurnToStellar({ ...args, amountUsdc6: -1n })).toThrow(RangeError);
  });

  it('recipient inválido tira antes de armar nada', () => {
    expect(() =>
      buildBurnToStellar({
        config: BASE_SEPOLIA,
        stellarDomain: 27,
        forwarderContractId: STELLAR_TESTNET.cctpForwarder,
        forwardRecipient: 'definitivamente-no',
        amountUsdc6: 1n,
      }),
    ).toThrow(CctpMessageError);
  });
});

describe('usdc6ToStellar7 — EL único rescale', () => {
  it('×10 exacto', () => {
    expect(usdc6ToStellar7(5_000_000n)).toBe(50_000_000n);
    expect(usdc6ToStellar7(1n)).toBe(10n); // ni el átomo se pierde
    expect(usdc6ToStellar7(0n)).toBe(0n);
  });
  it('negativo tira', () => {
    expect(() => usdc6ToStellar7(-1n)).toThrow(RangeError);
  });
});

describe('depositFromScVals', () => {
  it('payer/beneficiary como Address y assets como i128', () => {
    const vals = depositFromScVals(G_ADDR, G_ADDR, 50_000_000n);
    expect(vals).toHaveLength(3);
    expect(vals[0].switch().name).toBe('scvAddress');
    expect(vals[1].switch().name).toBe('scvAddress');
    expect(vals[2].switch().name).toBe('scvI128');
  });
});

describe('planDelivery — validar TODO antes de gastar un fee', () => {
  const ATT = '0x' + 'cd'.repeat(65);

  it('camino feliz: nonce, montos en 6 y 7, recipient y los 2 bytes-args', () => {
    const plan = planDelivery(buildTestMessage(), ATT, STELLAR_TESTNET);
    expect(plan.nonce).toBe(`0x${'ab'.repeat(32)}`);
    expect(plan.sourceDomain).toBe(6);
    expect(plan.amountUsdc6).toBe(5_000_000n);
    expect(plan.amount7).toBe(50_000_000n);
    expect(plan.forwardRecipient).toBe(G_ADDR);
    expect(plan.mintArgs).toHaveLength(2); // mint_and_forward(message, attestation)
    expect(plan.mintArgs[0].switch().name).toBe('scvBytes');
    expect(plan.mintArgs[1].switch().name).toBe('scvBytes');
  });

  it('destino que no es Stellar: rechazo (el mensaje no es para nosotros)', () => {
    expect(() =>
      planDelivery(buildTestMessage({ destinationDomain: 0 }), ATT, STELLAR_TESTNET),
    ).toThrow(/destination domain/);
  });

  it('mintRecipient que no es el forwarder: rechazo (fondos varados)', () => {
    const wrong = new Uint8Array(32).fill(9);
    expect(() =>
      planDelivery(buildTestMessage({ mintRecipient: wrong }), ATT, STELLAR_TESTNET),
    ).toThrow(/strand/);
  });

  it('destinationCaller (header) que no es el forwarder: mismo rechazo', () => {
    const wrong = new Uint8Array(32).fill(9);
    expect(() =>
      planDelivery(buildTestMessage({ destinationCaller: wrong }), ATT, STELLAR_TESTNET),
    ).toThrow(/strand/);
  });

  it('amount cero: rechazo (no se gasta fee en un mensaje absurdo)', () => {
    expect(() => planDelivery(buildTestMessage({ amount: 0n }), ATT, STELLAR_TESTNET)).toThrow(
      /zero/,
    );
  });

  it('hookData malformado: rechazo (no sabríamos de quién es la plata)', () => {
    expect(() =>
      planDelivery(buildTestMessage({ hookData: new Uint8Array(5) }), ATT, STELLAR_TESTNET),
    ).toThrow(CctpMessageError);
  });

  it('attestation vacía: rechazo (el sentinel de Iris no puede llegar hasta acá)', () => {
    expect(() => planDelivery(buildTestMessage(), '0x', STELLAR_TESTNET)).toThrow(/attestation/);
  });

  it('el hook puede llevar un recipient C… (depositar directo a un contrato)', () => {
    const hook = buildForwarderHookData(STELLAR_TESTNET.usdcSac);
    const plan = planDelivery(buildTestMessage({ hookData: hook }), ATT, STELLAR_TESTNET);
    expect(plan.forwardRecipient).toBe(STELLAR_TESTNET.usdcSac);
  });
});
