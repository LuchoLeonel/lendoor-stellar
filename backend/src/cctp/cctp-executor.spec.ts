import { Keypair, xdr } from '@stellar/stellar-sdk';

import { STELLAR_TESTNET } from './cctp-chains';
import { buildForwarderHookData } from './cctp-message';
import { CctpExecutor, nonceScVal, SorobanSubmitter, NonceOracle } from './cctp-executor';
import { CCTP_DOMAINS, CctpTransfer, IrisClient } from './cctp-transfer';
import { buildTestMessage } from './cctp-message.spec';

const BENEFICIARY = 'GDCZFUNJ7MXWBIQ6UUTJRGZIJF5EMRVJCSK73MA2U7K57GWMA4N3P6SL';
// G distinta y válida para el relayer (issuer USDC testnet de Circle)
const RELAYER = STELLAR_TESTNET.usdcIssuer;
const VAULT_C = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
const NONCE = `0x${'ab'.repeat(32)}` as const;
const ATT = '0x' + 'cd'.repeat(65);

class FakeSoroban implements SorobanSubmitter {
  calls: Array<{ contractId: string; method: string; args: xdr.ScVal[] }> = [];
  async submit(contractId: string, method: string, args: xdr.ScVal[]) {
    this.calls.push({ contractId, method, args });
    return { txHash: `tx-${this.calls.length}` };
  }
}

class FakeNonces implements NonceOracle {
  constructor(public used = false) {}
  async isNonceUsed() {
    return this.used;
  }
}

const neverIris: IrisClient = {
  getAttestation: async () => ({ kind: 'pending' }),
};

function makeRow(over: Partial<CctpTransfer> = {}): CctpTransfer {
  return {
    nonce: NONCE,
    sourceDomain: CCTP_DOMAINS.BASE_SEPOLIA,
    destinationDomain: CCTP_DOMAINS.STELLAR,
    burnTxHash: '0xburn',
    amountUsdc6: 5_000_000n,
    beneficiary: BENEFICIARY,
    state: 'attested',
    attestation: ATT,
    message: buildTestMessage(),
    attempts: 0,
    ...over,
  };
}

function makeExecutor(over: { soroban?: FakeSoroban; nonces?: FakeNonces; iris?: IrisClient } = {}) {
  const soroban = over.soroban ?? new FakeSoroban();
  return {
    soroban,
    exec: new CctpExecutor({
      iris: over.iris ?? neverIris,
      soroban,
      nonces: over.nonces ?? new FakeNonces(),
      config: STELLAR_TESTNET,
      relayerAddress: RELAYER,
      vaultContractId: VAULT_C,
    }),
  };
}

describe('CctpExecutor.deliver — modo DIRECTO (recipient = beneficiary)', () => {
  it('un solo submit (mint_and_forward al forwarder) y delivered', async () => {
    const { soroban, exec } = makeExecutor();
    const out = await exec.deliver(makeRow());
    expect(out.state).toBe('delivered');
    expect(out.mintTxHash).toBe('tx-1');
    expect(soroban.calls).toHaveLength(1);
    expect(soroban.calls[0].contractId).toBe(STELLAR_TESTNET.cctpForwarder);
    expect(soroban.calls[0].method).toBe('mint_and_forward');
    expect(soroban.calls[0].args).toHaveLength(2);
  });
});

describe('CctpExecutor.deliver — modo VAULT (recipient = relayer)', () => {
  it('mint + deposit_from(relayer, beneficiary, amount7) y delivered', async () => {
    const { soroban, exec } = makeExecutor();
    const row = makeRow({
      message: buildTestMessage({ hookData: buildForwarderHookData(RELAYER) }),
    });
    const out = await exec.deliver(row);
    expect(out.state).toBe('delivered');
    expect(soroban.calls).toHaveLength(2);
    expect(soroban.calls[1].contractId).toBe(VAULT_C);
    expect(soroban.calls[1].method).toBe('deposit_from');
    // el i128 del tercer arg es el monto RESCALADO a 7 decimales
    expect(soroban.calls[1].args[2].switch().name).toBe('scvI128');
  });
});

describe('CctpExecutor.deliver — rechazos ANTES de gastar fee', () => {
  it('recipient que no es ni beneficiary ni relayer → failed, cero submits', async () => {
    const stranger = Keypair.random().publicKey(); // válida pero ajena
    const { soroban, exec } = makeExecutor();
    const out = await exec.deliver(
      makeRow({ message: buildTestMessage({ hookData: buildForwarderHookData(stranger) }) }),
    );
    expect(out.state).toBe('failed');
    expect(out.lastError).toMatch(/neither/);
    expect(soroban.calls).toHaveLength(0);
  });

  it('nonce del mensaje ≠ nonce de la fila → failed (integridad fila↔mensaje)', async () => {
    const { soroban, exec } = makeExecutor();
    const out = await exec.deliver(
      makeRow({ message: buildTestMessage({ nonceByte: 0xee }) }),
    );
    expect(out.state).toBe('failed');
    expect(out.lastError).toMatch(/nonce/);
    expect(soroban.calls).toHaveLength(0);
  });

  it('mensaje con destino que no es Stellar → failed con el motivo del plan', async () => {
    const { soroban, exec } = makeExecutor();
    const out = await exec.deliver(
      makeRow({ message: buildTestMessage({ destinationDomain: 0 }) }),
    );
    expect(out.state).toBe('failed');
    expect(out.lastError).toMatch(/destination domain/);
    expect(soroban.calls).toHaveLength(0);
  });

  it('nonce YA consumido on-chain → delivered sin gastar (otro lo minteó)', async () => {
    const { soroban, exec } = makeExecutor({ nonces: new FakeNonces(true) });
    const out = await exec.deliver(makeRow());
    expect(out.state).toBe('delivered');
    expect(soroban.calls).toHaveLength(0);
  });

  it('fila sin message o sin attestation: error de programación, no failed', async () => {
    const { exec } = makeExecutor();
    await expect(exec.deliver(makeRow({ message: undefined }))).rejects.toThrow(/message/);
    await expect(
      exec.deliver(makeRow({ state: 'pending', attestation: undefined })),
    ).rejects.toThrow(/attested/);
  });
});

describe('CctpExecutor.poll', () => {
  it('iris complete guarda attestation Y message en la fila (para deliver)', async () => {
    const msg = buildTestMessage();
    const iris: IrisClient = {
      getAttestation: async () => ({ kind: 'complete', attestation: ATT, message: msg }),
    };
    const { exec } = makeExecutor({ iris });
    const out = await exec.poll(makeRow({ state: 'pending', attestation: undefined, message: undefined }));
    expect(out.state).toBe('attested');
    expect(out.attestation).toBe(ATT);
    expect(out.message).toBe(msg);
  });

  it('nonce consumido on-chain gana aunque iris siga pending', async () => {
    const { exec } = makeExecutor({ nonces: new FakeNonces(true) });
    const out = await exec.poll(makeRow({ state: 'pending', attestation: undefined }));
    expect(out.state).toBe('delivered');
  });
});

describe('nonceScVal', () => {
  it('32 bytes exactos → scvBytes; otra cosa tira', () => {
    expect(nonceScVal(NONCE).switch().name).toBe('scvBytes');
    expect(() => nonceScVal('0x1234')).toThrow(RangeError);
  });
});
