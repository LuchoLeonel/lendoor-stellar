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

  it('replay sin datos nuevos es no-op; con patch es ACTUALIZACION de datos (review PR #4)', () => {
    const t = base({ state: 'delivered', mintTxHash: 'tx-1' });
    // sin patch: no-op identico (replay inocuo)
    expect(transition(t, 'delivered')).toBe(t);
    // con patch: los datos se actualizan sin cambiar el estado — antes se
    // descartaban en silencio y un diagnostico nuevo se perdia
    const updated = transition(t, 'delivered', { mintTxHash: 'tx-OTRA' });
    expect(updated.state).toBe('delivered');
    expect(updated.mintTxHash).toBe('tx-OTRA');
  });

  it('un submit fallido reintentable vuelve de submitting a attested', () => {
    let t = base({ state: 'submitting', attestation: '0xatt' });
    t = transition(t, 'attested', { lastError: 'tx timeout' });
    expect(t.state).toBe('attested');
    expect(LEGAL_TRANSITIONS.submitting).toContain('attested');
  });

  it('delivered es terminal; failed solo revive hacia delivered (verdad on-chain)', () => {
    expect(LEGAL_TRANSITIONS.delivered).toHaveLength(0);
    expect(LEGAL_TRANSITIONS.failed).toEqual(['delivered']);
  });

  it('resubmision: submitting→submitting con mintTxHash NUEVO lo aplica (review PR #3)', () => {
    const t = base({ state: 'submitting', mintTxHash: 'tx-A' });
    const re = transition(t, 'submitting', { mintTxHash: 'tx-B' });
    expect(re.mintTxHash).toBe('tx-B'); // el poller deja de mirar el tx muerto
  });

  it('avanzar limpia el lastError viejo (la entrega sana no queda "errada")', () => {
    const t = base({ state: 'attested', lastError: 'tx timeout' });
    const sub = transition(t, 'submitting');
    expect(sub.lastError).toBeUndefined();
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

  it('pending + iris pending = esperar, CONTANDO el intento (review PR #3)', () => {
    const t0 = base();
    const t1 = reconcile(t0, { kind: 'pending' }, false);
    expect(t1.state).toBe('pending');
    expect(t1.attempts).toBe(1); // la politica de retries por fin tiene datos
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


describe('contrato de Iris — las reglas que queman plata (review PR #3)', () => {
  it('200 con el sentinel "PENDING" NO es complete', () => {
    expect(irisStatusFromHttp(200, { attestation: 'PENDING', status: 'pending_confirmations' })).toEqual({
      kind: 'pending',
    });
  });

  it('200 con attestation null y status pending_confirmations = pending, jamas error', () => {
    expect(irisStatusFromHttp(200, { attestation: null, status: 'pending_confirmations' })).toEqual({
      kind: 'pending',
    });
  });

  it('401/403 (credencial NUESTRA vencida) = backoff, nunca terminal', () => {
    expect(irisStatusFromHttp(401).kind).toBe('backoff');
    expect(irisStatusFromHttp(403).kind).toBe('backoff');
  });

  it('429 honra Retry-After cuando el caller lo pasa', () => {
    expect(irisStatusFromHttp(429, undefined, 30)).toEqual({ kind: 'backoff', retryAfterMs: 30_000 });
  });

  it('un 4xx desconocido tampoco es terminal desde el polling', () => {
    expect(irisStatusFromHttp(418).kind).toBe('backoff');
  });
});

describe('chain-truth sobre failed y preservación de datos (review PR #3)', () => {
  it('failed + nonce consumido = delivered (la cadena manda sobre la DB)', () => {
    const t = reconcile(base({ state: 'failed', lastError: 'operador la marco mal' }), { kind: 'pending' }, true);
    expect(t.state).toBe('delivered');
    expect(t.lastError).toBeUndefined(); // la entrega sana no arrastra el error
  });

  it('el walk del chain-truth conserva la attestation que Iris trajo en el mismo poll', () => {
    const t = reconcile(base(), { kind: 'complete', attestation: '0xatt' }, true);
    expect(t.state).toBe('delivered');
    expect(t.attestation).toBe('0xatt');
  });
});
