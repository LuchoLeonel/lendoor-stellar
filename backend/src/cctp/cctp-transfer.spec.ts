import {
  CCTP_DOMAINS,
  CctpTransfer,
  IllegalCctpTransition,
  irisStatusFromHttp,
  LEGAL_TRANSITIONS,
  reconcile,
  transition,
} from './cctp-transfer';

const base = (over: Partial<CctpTransfer> = {}): CctpTransfer => ({
  nonce: 'nonce-1',
  sourceDomain: CCTP_DOMAINS.BASE_SEPOLIA,
  destinationDomain: CCTP_DOMAINS.STELLAR,
  burnTxHash: '0xburn',
  amountUsdc6: 5_000_000n, // 5 USDC en unidades del mensaje CCTP (6 dp)
  beneficiary: 'GDCZFUNJ7MXWBIQ6UUTJRGZIJF5EMRVJCSK73MA2U7K57GWMA4N3P6SL',
  state: 'pending',
  attempts: 0,
  ...over,
});

describe('cctp transfer state machine', () => {
  it('recorre el camino feliz por las aristas legales', () => {
    let t = base();
    t = transition(t, 'attested', { attestation: '0xatt' });
    t = transition(t, 'submitting');
    t = transition(t, 'delivered', { mintTxHash: 'stellar-tx' });
    expect(t.state).toBe('delivered');
    expect(t.attestation).toBe('0xatt');
    expect(t.mintTxHash).toBe('stellar-tx');
  });

  it('rechaza toda arista ilegal — nunca avanza en silencio', () => {
    expect(() => transition(base(), 'submitting')).toThrow(IllegalCctpTransition);
    expect(() => transition(base(), 'delivered')).toThrow(IllegalCctpTransition);
    expect(() => transition(base({ state: 'delivered' }), 'pending')).toThrow(
      IllegalCctpTransition,
    );
    expect(() => transition(base({ state: 'failed' }), 'attested')).toThrow(
      IllegalCctpTransition,
    );
  });

  it('reaplicar el mismo estado es un no-op (evento repetido = idempotente)', () => {
    const t = base({ state: 'delivered', mintTxHash: 'tx-1' });
    const again = transition(t, 'delivered', { mintTxHash: 'tx-OTRA' });
    expect(again).toBe(t); // ni siquiera pisa el patch: replay inocuo
    expect(again.mintTxHash).toBe('tx-1');
  });

  it('un submit fallido reintentable vuelve de submitting a attested', () => {
    let t = base({ state: 'submitting', attestation: '0xatt' });
    t = transition(t, 'attested', { lastError: 'tx timeout' });
    expect(t.state).toBe('attested');
    expect(LEGAL_TRANSITIONS.submitting).toContain('attested');
  });

  it('delivered y failed son terminales en la tabla', () => {
    expect(LEGAL_TRANSITIONS.delivered).toHaveLength(0);
    expect(LEGAL_TRANSITIONS.failed).toHaveLength(0);
  });
});

describe('contrato de Iris', () => {
  it('404 significa PENDIENTE, nunca error (la regla que rompe a los ingenuos)', () => {
    expect(irisStatusFromHttp(404)).toEqual({ kind: 'pending' });
  });

  it('200 con attestation = complete', () => {
    expect(irisStatusFromHttp(200, { attestation: '0xatt' })).toEqual({
      kind: 'complete',
      attestation: '0xatt',
    });
  });

  it('429 = backoff, 5xx = transitorio (pending), 400 = error real', () => {
    expect(irisStatusFromHttp(429).kind).toBe('backoff');
    expect(irisStatusFromHttp(503).kind).toBe('pending');
    expect(irisStatusFromHttp(400, { error: 'bad domain' })).toEqual({
      kind: 'error',
      message: 'bad domain',
    });
  });
});

describe('reconcile — idempotencia anclada en la cadena', () => {
  it('attestation completa mueve pending → attested', () => {
    const t = reconcile(base(), { kind: 'complete', attestation: '0xatt' }, false);
    expect(t.state).toBe('attested');
    expect(t.attestation).toBe('0xatt');
  });

  it('pending + iris pending = esperar, sin mutar', () => {
    const t0 = base();
    expect(reconcile(t0, { kind: 'pending' }, false)).toBe(t0);
  });

  it('error real de Iris mueve a failed con el motivo', () => {
    const t = reconcile(base(), { kind: 'error', message: 'unknown domain' }, false);
    expect(t.state).toBe('failed');
    expect(t.lastError).toBe('unknown domain');
  });

  it('NONCE CONSUMIDO EN CADENA manda: delivered aunque la DB diga submitting', () => {
    // crash después de enviar el mint y antes de registrarlo: la cadena es la verdad
    const t = reconcile(
      base({ state: 'submitting', attestation: '0xatt' }),
      { kind: 'pending' },
      true,
    );
    expect(t.state).toBe('delivered');
  });

  it('nonce consumido con DB en pending también termina en delivered (mint externo)', () => {
    const t = reconcile(base(), { kind: 'pending' }, true);
    expect(t.state).toBe('delivered');
  });

  it('nonce consumido sobre un delivered es no-op (replay del replay)', () => {
    const t0 = base({ state: 'delivered' });
    expect(reconcile(t0, { kind: 'pending' }, true)).toBe(t0);
  });
});
