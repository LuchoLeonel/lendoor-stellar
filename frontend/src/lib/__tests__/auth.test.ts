import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchWithAuthRetry } from '../auth';

// Helper that builds a minimal Response-like object
function makeResponse(status: number, body: string = 'ok'): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(JSON.parse(body)),
  } as unknown as Response;
}

// These are recreated each test via beforeEach so clearAllMocks doesn't
// strip the implementation.
let noopRefresh: ReturnType<typeof vi.fn>;
let refreshWithToken: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  noopRefresh = vi.fn().mockResolvedValue(null);
  refreshWithToken = vi.fn().mockResolvedValue('new-token');
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---- no token in storage: unauthenticated path ------------------------------

describe('fetchWithAuthRetry — no token in storage', () => {
  it('calls refreshAccessToken before the first fetch when no token exists', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse(200));
    vi.stubGlobal('fetch', fetchMock);

    await fetchWithAuthRetry('https://api.test/data', {
      refreshAccessToken: noopRefresh,
    });

    expect(noopRefresh).toHaveBeenCalledOnce();
  });

  it('makes an unauthenticated request when refreshAccessToken returns null', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse(200));
    vi.stubGlobal('fetch', fetchMock);

    await fetchWithAuthRetry('https://api.test/data', {
      refreshAccessToken: noopRefresh,
    });

    // Called without an Authorization header
    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = opts.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it('returns authFailed:false when refresh returns null and response is successful', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(200)));

    const result = await fetchWithAuthRetry('https://api.test/data', {
      refreshAccessToken: noopRefresh,
    });

    expect(result.authFailed).toBe(false);
    expect(result.res).not.toBeNull();
  });

  it('uses the fresh token from refresh in the Authorization header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse(200));
    vi.stubGlobal('fetch', fetchMock);

    await fetchWithAuthRetry('https://api.test/data', {
      refreshAccessToken: refreshWithToken,
    });

    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = opts.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer new-token');
  });
});

// ---- token present in storage: happy path -----------------------------------

describe('fetchWithAuthRetry — token in storage', () => {
  beforeEach(() => {
    localStorage.setItem('lendoor:accessToken', 'stored-token');
  });

  it('does NOT call refreshAccessToken on the first request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(200)));

    await fetchWithAuthRetry('https://api.test/data', {
      refreshAccessToken: refreshWithToken,
    });

    expect(refreshWithToken).not.toHaveBeenCalled();
  });

  it('sends the stored token in the Authorization header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse(200));
    vi.stubGlobal('fetch', fetchMock);

    await fetchWithAuthRetry('https://api.test/data', {
      refreshAccessToken: noopRefresh,
    });

    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = opts.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer stored-token');
  });

  it('returns authFailed:false and the response for a 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(200)));

    const result = await fetchWithAuthRetry('https://api.test/data', {
      refreshAccessToken: noopRefresh,
    });

    expect(result.authFailed).toBe(false);
    expect(result.res?.status).toBe(200);
  });

  it('returns authFailed:false for 403 (business error, not auth error)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(403)));

    const result = await fetchWithAuthRetry('https://api.test/data', {
      refreshAccessToken: noopRefresh,
    });

    expect(result.authFailed).toBe(false);
    expect(result.res?.status).toBe(403);
  });

  it('preserves additional headers passed by the caller', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse(200));
    vi.stubGlobal('fetch', fetchMock);

    await fetchWithAuthRetry('https://api.test/data', {
      refreshAccessToken: noopRefresh,
      headers: { 'Content-Type': 'application/json', 'X-Custom': 'yes' },
    });

    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = opts.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['X-Custom']).toBe('yes');
  });
});

// ---- 401 handling and token refresh -----------------------------------------

describe('fetchWithAuthRetry — 401 retry logic', () => {
  beforeEach(() => {
    localStorage.setItem('lendoor:accessToken', 'expired-token');
  });

  it('calls refreshAccessToken after receiving a 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce(makeResponse(401))
        .mockResolvedValueOnce(makeResponse(200)),
    );

    await fetchWithAuthRetry('https://api.test/data', {
      refreshAccessToken: refreshWithToken,
    });

    expect(refreshWithToken).toHaveBeenCalledOnce();
  });

  it('retries the request with the fresh token after a 401', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeResponse(401))
      .mockResolvedValueOnce(makeResponse(200));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchWithAuthRetry('https://api.test/data', {
      refreshAccessToken: refreshWithToken,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.authFailed).toBe(false);
    expect(result.res?.status).toBe(200);
  });

  it('returns authFailed:false when refresh returns null after 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(401)));

    const result = await fetchWithAuthRetry('https://api.test/data', {
      refreshAccessToken: noopRefresh,
    });

    // Caller sees the 401 as a business error, not an auth hard failure
    expect(result.authFailed).toBe(false);
    expect(result.res?.status).toBe(401);
  });

  it('returns authFailed:true when 401 persists after a successful token refresh', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce(makeResponse(401))
        .mockResolvedValueOnce(makeResponse(401)),
    );

    const result = await fetchWithAuthRetry('https://api.test/data', {
      refreshAccessToken: refreshWithToken,
    });

    expect(result.authFailed).toBe(true);
    expect(result.res?.status).toBe(401);
  });
});

// ---- network errors (fetch throws) ------------------------------------------

describe('fetchWithAuthRetry — network errors', () => {
  beforeEach(() => {
    localStorage.setItem('lendoor:accessToken', 'stored-token');
  });

  it('returns { res: null, authFailed: false } when fetch throws a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network failure')));

    const result = await fetchWithAuthRetry('https://api.test/data', {
      refreshAccessToken: noopRefresh,
    });

    expect(result.res).toBeNull();
    expect(result.authFailed).toBe(false);
  });
});

// ---- Headers object support -------------------------------------------------

describe('fetchWithAuthRetry — Headers object support', () => {
  beforeEach(() => {
    localStorage.setItem('lendoor:accessToken', 'stored-token');
  });

  it('correctly merges a Headers instance with the auth header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse(200));
    vi.stubGlobal('fetch', fetchMock);

    const headersObj = new Headers({ 'X-From-Headers-Class': 'true' });

    await fetchWithAuthRetry('https://api.test/data', {
      refreshAccessToken: noopRefresh,
      headers: headersObj,
    });

    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = opts.headers as Record<string, string>;
    expect(headers['x-from-headers-class']).toBe('true');
    expect(headers.Authorization).toBe('Bearer stored-token');
  });
});
