import { HttpIrisClient } from './iris-client';
import { CCTP_DOMAINS } from './cctp-transfer';

function mockFetch(status: number, body?: unknown, headers: Record<string, string> = {}) {
  return (async () =>
    ({
      status,
      headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
      json: async () => body,
    }) as unknown as Response) as unknown as typeof fetch;
}

const D = CCTP_DOMAINS.BASE_SEPOLIA;

describe('HttpIrisClient (transporte; la semántica vive en irisStatusFromHttp)', () => {
  it('200 con message complete + attestation real = complete', async () => {
    const c = new HttpIrisClient('http://x', mockFetch(200, { messages: [{ status: 'complete', attestation: '0xabc' }] }));
    expect(await c.getAttestation(D, '0xburn')).toEqual({ kind: 'complete', attestation: '0xabc' });
  });

  it('200 con pending_confirmations / sentinel PENDING = pending, jamás complete', async () => {
    const c = new HttpIrisClient('http://x', mockFetch(200, { messages: [{ status: 'pending_confirmations', attestation: 'PENDING' }] }));
    expect((await c.getAttestation(D, '0xburn')).kind).toBe('pending');
  });

  it('elige el mensaje LISTO aunque no sea el primero', async () => {
    const c = new HttpIrisClient('http://x', mockFetch(200, { messages: [
      { status: 'pending_confirmations', attestation: null },
      { status: 'complete', attestation: '0xok' },
    ]}));
    expect(await c.getAttestation(D, '0xburn')).toEqual({ kind: 'complete', attestation: '0xok' });
  });

  it('404 = pending; 429 respeta Retry-After; 500 = pending', async () => {
    expect((await new HttpIrisClient('http://x', mockFetch(404)).getAttestation(D, 'h')).kind).toBe('pending');
    expect(await new HttpIrisClient('http://x', mockFetch(429, undefined, { 'retry-after': '30' })).getAttestation(D, 'h'))
      .toEqual({ kind: 'backoff', retryAfterMs: 30_000 });
    expect((await new HttpIrisClient('http://x', mockFetch(500)).getAttestation(D, 'h')).kind).toBe('pending');
  });

  it('red caída = backoff, nunca terminal', async () => {
    const boom = (async () => { throw new Error('ENOTFOUND'); }) as unknown as typeof fetch;
    expect((await new HttpIrisClient('http://x', boom).getAttestation(D, 'h')).kind).toBe('backoff');
  });
});
