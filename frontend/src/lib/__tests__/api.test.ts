import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LendoorApi, ApiError, AuthError, NetworkError } from '../api';

// Mock the auth module so we don't depend on localStorage/token logic in these tests
vi.mock('@/lib/auth', () => ({
  fetchWithAuthRetry: vi.fn(),
}));

// Mock constants to avoid import.meta.env issues
vi.mock('@/lib/constants', () => ({
  BACKEND_URL: 'https://api.test.lendoor.xyz',
}));

import { fetchWithAuthRetry } from '@/lib/auth';

const mockFetchWithAuthRetry = fetchWithAuthRetry as ReturnType<typeof vi.fn>;

function makeJsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as unknown as Response;
}

function makeErrorResponse(status: number, body = 'error'): Response {
  return {
    ok: false,
    status,
    json: () => Promise.reject(new Error('no json')),
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('Error classes', () => {
  it('ApiError has correct name and properties', () => {
    const err = new ApiError(404, 'Not found');
    expect(err.name).toBe('ApiError');
    expect(err.status).toBe(404);
    expect(err.body).toBe('Not found');
    expect(err.message).toBe('Not found');
    expect(err).toBeInstanceOf(Error);
  });

  it('ApiError falls back to HTTP status in message when body is empty', () => {
    const err = new ApiError(500, '');
    expect(err.message).toBe('HTTP 500');
  });

  it('AuthError has correct name', () => {
    const err = new AuthError();
    expect(err.name).toBe('AuthError');
    expect(err.message).toBe('Authentication failed');
    expect(err).toBeInstanceOf(Error);
  });

  it('AuthError accepts custom message', () => {
    const err = new AuthError('Token expired');
    expect(err.message).toBe('Token expired');
  });

  it('NetworkError has correct name', () => {
    const err = new NetworkError();
    expect(err.name).toBe('NetworkError');
    expect(err.message).toBe('Network error');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('LendoorApi', () => {
  let api: LendoorApi;
  const refreshFn = vi.fn().mockResolvedValue('fresh-token');

  beforeEach(() => {
    api = new LendoorApi(refreshFn);
    vi.clearAllMocks();
    // Default: successful auth fetch
    mockFetchWithAuthRetry.mockResolvedValue({
      res: makeJsonResponse({ nonce: 'abc' }),
      authFailed: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getNonce', () => {
    it('calls fetch POST /auth/nonce and returns response', async () => {
      // getNonce uses raw fetch (no auth), so mock global fetch
      const fetchMock = vi.fn().mockResolvedValue(makeJsonResponse({ nonce: 'xyz123' }));
      vi.stubGlobal('fetch', fetchMock);

      const result = await api.getNonce();

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.test.lendoor.xyz/auth/nonce');
      expect(options.method).toBe('POST');
      expect(result).toEqual({ nonce: 'xyz123' });
    });

    it('throws ApiError when nonce endpoint returns non-ok status', async () => {
      const fetchMock = vi.fn().mockResolvedValue(makeErrorResponse(500, 'Internal error'));
      vi.stubGlobal('fetch', fetchMock);

      await expect(api.getNonce()).rejects.toThrow(ApiError);
    });
  });

  describe('verifySiwe', () => {
    it('calls POST /auth/verify with siwe body', async () => {
      const body = { message: 'sign this', signature: '0xabc', wallet: '0x123' };
      const fetchMock = vi.fn().mockResolvedValue(makeJsonResponse({ accessToken: 'tok' }));
      vi.stubGlobal('fetch', fetchMock);

      await api.verifySiwe(body);

      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.test.lendoor.xyz/auth/verify');
      expect(options.method).toBe('POST');
      expect(JSON.parse(options.body as string)).toEqual(body);
    });
  });

  describe('getUser', () => {
    it('calls authed GET /user/:wallet', async () => {
      mockFetchWithAuthRetry.mockResolvedValue({
        res: makeJsonResponse({ step: 'verified' }),
        authFailed: false,
      });

      const result = await api.getUser('0xABC');

      expect(mockFetchWithAuthRetry).toHaveBeenCalledOnce();
      const [url, opts] = mockFetchWithAuthRetry.mock.calls[0] as [string, object];
      expect(url).toBe('https://api.test.lendoor.xyz/user/0xABC');
      expect((opts as { method: string }).method).toBe('GET');
      expect(result).toEqual({ step: 'verified' });
    });

    it('appends platform query param when provided', async () => {
      mockFetchWithAuthRetry.mockResolvedValue({
        res: makeJsonResponse({ step: 'verified' }),
        authFailed: false,
      });

      await api.getUser('0xABC', 'farcaster');

      const [url] = mockFetchWithAuthRetry.mock.calls[0] as [string, object];
      expect(url).toContain('?platform=farcaster');
    });

    it('throws AuthError when authFailed is true', async () => {
      mockFetchWithAuthRetry.mockResolvedValue({ res: null, authFailed: true });

      await expect(api.getUser('0xABC')).rejects.toThrow(AuthError);
    });

    it('throws NetworkError when res is null and authFailed is false', async () => {
      mockFetchWithAuthRetry.mockResolvedValue({ res: null, authFailed: false });

      await expect(api.getUser('0xABC')).rejects.toThrow(NetworkError);
    });

    it('throws ApiError when response is not ok', async () => {
      mockFetchWithAuthRetry.mockResolvedValue({
        res: makeErrorResponse(404, 'Not found'),
        authFailed: false,
      });

      await expect(api.getUser('0xABC')).rejects.toThrow(ApiError);
    });
  });

  describe('acceptTerms', () => {
    it('calls authed POST /user/accept-terms with body', async () => {
      mockFetchWithAuthRetry.mockResolvedValue({
        res: makeJsonResponse({ step: 'terms_accepted' }),
        authFailed: false,
      });

      const body = { walletAddress: '0xABC' };
      const result = await api.acceptTerms(body);

      const [url, opts] = mockFetchWithAuthRetry.mock.calls[0] as [string, { method: string; body: string }];
      expect(url).toBe('https://api.test.lendoor.xyz/user/accept-terms');
      expect(opts.method).toBe('POST');
      expect(JSON.parse(opts.body)).toEqual(body);
      expect(result).toEqual({ step: 'terms_accepted' });
    });
  });

  describe('getLoanTerms', () => {
    it('calls authed POST /loan/loan-terms', async () => {
      mockFetchWithAuthRetry.mockResolvedValue({
        res: makeJsonResponse({ interestRate: 5 }),
        authFailed: false,
      });

      const body = { walletAddress: '0xABC', amount: '100', termDays: 30 };
      await api.getLoanTerms(body);

      const [url] = mockFetchWithAuthRetry.mock.calls[0] as [string, object];
      expect(url).toBe('https://api.test.lendoor.xyz/loan/loan-terms');
    });
  });

  describe('selfProfile', () => {
    it('appends walletAddress as query param', async () => {
      mockFetchWithAuthRetry.mockResolvedValue({
        res: makeJsonResponse({ verified: true }),
        authFailed: false,
      });

      await api.selfProfile('0xDEF');

      const [url] = mockFetchWithAuthRetry.mock.calls[0] as [string, object];
      expect(url).toContain('/self/profile?walletAddress=0xDEF');
    });
  });

  describe('rawAuthedPost', () => {
    it('returns res and authFailed directly', async () => {
      const mockRes = makeJsonResponse({ ok: true });
      mockFetchWithAuthRetry.mockResolvedValue({ res: mockRes, authFailed: false });

      const result = await api.rawAuthedPost('/some/path', { data: 1 });

      expect(result.authFailed).toBe(false);
      expect(result.res).toBe(mockRes);
    });
  });

  describe('rawAuthedGet', () => {
    it('returns res and authFailed directly', async () => {
      const mockRes = makeJsonResponse({ ok: true });
      mockFetchWithAuthRetry.mockResolvedValue({ res: mockRes, authFailed: false });

      const result = await api.rawAuthedGet('/some/path');

      expect(result.authFailed).toBe(false);
      expect(result.res).toBe(mockRes);
    });
  });
});
