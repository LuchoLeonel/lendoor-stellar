import { fetchWithAuthRetry, type AuthFetchOptions } from "@/lib/auth";
import { BACKEND_URL } from "@/lib/constants";
import type {
  GetNonceResponse,
  VerifySiweRequest,
  VerifySiweResponse,
  UserJourneyResponse,
  VerifyEmailRequest,
  VerifyOtpRequest,
  AcceptTermsRequest,
  JoinWaitlistRequest,
  VerifyUserRequest,
  VerifyUserResponse,
  GetLoanTermsRequest,
  GetLoanTermsResponse,
  BorrowRequest,
  BorrowResponse,
  InformOpenRequest,
  InformOpenResponse,
  InformRepaymentRequest,
  InformRepaymentResponse,
  RepayPreflightRequest,
  RepayPreflightResponseWire,
  RepayPreflightPayload,
  SelfVerifyRequest,
  SelfVerifyResponse,
  SelfProfileResponse,
  LemonProfilePayload,
  LemonProfileResponse,
  Platform,
} from "@shared/types";

// ── Error classes ──

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(body || `HTTP ${status}`);
    this.name = "ApiError";
  }
}

export class AuthError extends Error {
  constructor(message = "Authentication failed") {
    super(message);
    this.name = "AuthError";
  }
}

export class NetworkError extends Error {
  constructor(message = "Network error") {
    super(message);
    this.name = "NetworkError";
  }
}

// ── Helpers ──

type RefreshFn = () => Promise<string | null>;

const JSON_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  Accept: "application/json",
};

// ── API client ──

export class LendoorApi {
  constructor(private refreshAccessToken: RefreshFn) {}

  // ── Internal ──

  private async authedGet<T>(path: string): Promise<T> {
    const url = `${BACKEND_URL}${path}`;
    const { res, authFailed } = await fetchWithAuthRetry(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      refreshAccessToken: this.refreshAccessToken,
    });

    if (authFailed) throw new AuthError();
    if (!res) throw new NetworkError();
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ApiError(res.status, text);
    }
    return res.json() as Promise<T>;
  }

  private async authedPost<T>(path: string, body?: unknown): Promise<T> {
    const url = `${BACKEND_URL}${path}`;
    const opts: AuthFetchOptions = {
      method: "POST",
      headers: JSON_HEADERS,
      refreshAccessToken: this.refreshAccessToken,
    };
    if (body !== undefined) {
      opts.body = JSON.stringify(body);
    }

    const { res, authFailed } = await fetchWithAuthRetry(url, opts);

    if (authFailed) throw new AuthError();
    if (!res) throw new NetworkError();
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ApiError(res.status, text);
    }
    return res.json() as Promise<T>;
  }

  /** POST without auth (for nonce/verify that happen before token exists) */
  private async post<T>(path: string, body?: unknown): Promise<T> {
    const url = `${BACKEND_URL}${path}`;
    const res = await fetch(url, {
      method: "POST",
      headers: JSON_HEADERS,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ApiError(res.status, text);
    }
    return res.json() as Promise<T>;
  }

  /** POST/GET con un Bearer EXPLÍCITO (el linkSession del companion, distinto
      al access-token de sesión). Spec 084. */
  private async postWithToken<T>(path: string, body: unknown, token?: string): Promise<T> {
    const url = `${BACKEND_URL}${path}`;
    const headers: Record<string, string> = { ...JSON_HEADERS };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    if (!res.ok) { const text = await res.text().catch(() => ""); throw new ApiError(res.status, text); }
    return res.json() as Promise<T>;
  }
  private async getWithToken<T>(path: string, token?: string): Promise<T> {
    const url = `${BACKEND_URL}${path}`;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(url, { method: "GET", headers });
    if (!res.ok) { const text = await res.text().catch(() => ""); throw new ApiError(res.status, text); }
    return res.json() as Promise<T>;
  }

  // ── Wallet Link (companion, spec 084) ──
  /** Envía OTP al email (siempre 200 — anti-enumeration). */
  walletLinkStart(body: { email: string }): Promise<{ ok: boolean; otpExpiresAt?: string }> {
    return this.post("/wallet-link/start", body);
  }
  /** Valida OTP → linkSession JWT (scope wallet_link). */
  walletLinkSession(body: { email: string; code: string }): Promise<{ linkSession: string; userId: number; email: string; lendoorAddress: string | null }> {
    return this.post("/wallet-link/session", body);
  }
  /** Nonce + mensaje SIWE completo (server-side) para firmar. */
  walletLinkNonce(body: { address: string; chainId: number }, linkSession: string): Promise<{ nonce: string; message: string; expiresAt: string }> {
    return this.postWithToken("/wallet-link/nonce", body, linkSession);
  }
  /** Verifica firma → vincula la wallet al user (server recupera el address). */
  walletLinkVerify(body: { address: string; chainId: number; message: string; signature: string }, linkSession: string): Promise<{ ok: boolean; wallet: { address: string; verifiedAt: string } }> {
    return this.postWithToken("/wallet-link/verify", body, linkSession);
  }
  /** Wallets ya vinculadas (para la web companion). */
  walletLinkWallets(linkSession: string): Promise<{ wallets: { address: string; chainId?: number; verifiedAt?: string; source?: string }[] }> {
    return this.getWithToken("/wallet-link/wallets", linkSession);
  }
  /** Estado de vinculación — lo pollea el MÓVIL con su access-token. */
  walletLinkStatus(): Promise<{ linkedCount: number; wallets: { address: string; verifiedAt?: string }[]; latestVerifiedAt?: string }> {
    return this.authedGet("/wallet-link/status");
  }

  /**
   * Raw authed POST returning { res, authFailed } for callers
   * that need fine-grained status handling (e.g. 428, 409).
   */
  async rawAuthedPost(
    path: string,
    body?: unknown,
  ): Promise<{ res: Response | null; authFailed: boolean }> {
    const url = `${BACKEND_URL}${path}`;
    return fetchWithAuthRetry(url, {
      method: "POST",
      headers: JSON_HEADERS,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      refreshAccessToken: this.refreshAccessToken,
    });
  }

  /**
   * Raw authed GET returning { res, authFailed } for callers
   * that need fine-grained status handling.
   */
  async rawAuthedGet(
    path: string,
  ): Promise<{ res: Response | null; authFailed: boolean }> {
    const url = `${BACKEND_URL}${path}`;
    return fetchWithAuthRetry(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      refreshAccessToken: this.refreshAccessToken,
    });
  }

  // ── Auth ──

  getNonce(): Promise<GetNonceResponse> {
    return this.post<GetNonceResponse>("/auth/nonce");
  }

  verifySiwe(body: VerifySiweRequest): Promise<VerifySiweResponse> {
    return this.post<VerifySiweResponse>("/auth/verify", body);
  }

  // ── User ──

  getUser(wallet: string, platform?: Platform): Promise<UserJourneyResponse> {
    const q = platform ? `?platform=${encodeURIComponent(platform)}` : "";
    return this.authedGet<UserJourneyResponse>(
      `/user/${encodeURIComponent(wallet)}${q}`,
    );
  }

  acceptTerms(body: AcceptTermsRequest): Promise<UserJourneyResponse> {
    return this.authedPost<UserJourneyResponse>("/user/accept-terms", body);
  }

  joinWaitlist(body: JoinWaitlistRequest): Promise<UserJourneyResponse> {
    return this.authedPost<UserJourneyResponse>("/user/join-waitlist", body);
  }

  verifyEmail(body: VerifyEmailRequest): Promise<UserJourneyResponse> {
    return this.authedPost<UserJourneyResponse>("/user/verify-email", body);
  }

  verifyOtp(body: VerifyOtpRequest): Promise<UserJourneyResponse> {
    return this.authedPost<UserJourneyResponse>("/user/verify-otp", body);
  }

  resendOtp(body: { walletAddress: string }): Promise<void> {
    return this.authedPost<void>("/user/resend-otp", body);
  }

  // ── Loan ──

  verifyUser(body: VerifyUserRequest): Promise<VerifyUserResponse> {
    return this.authedPost<VerifyUserResponse>("/loan/verify", body);
  }

  getLoanTerms(body: GetLoanTermsRequest): Promise<GetLoanTermsResponse> {
    return this.authedPost<GetLoanTermsResponse>("/loan/loan-terms", body);
  }

  borrow(body: BorrowRequest): Promise<BorrowResponse> {
    return this.authedPost<BorrowResponse>("/loan/borrow", body);
  }

  informOpen(body: InformOpenRequest): Promise<InformOpenResponse> {
    return this.authedPost<InformOpenResponse>("/loan/inform-open", body);
  }

  informRepayment(
    body: InformRepaymentRequest,
  ): Promise<InformRepaymentResponse> {
    return this.authedPost<InformRepaymentResponse>(
      "/loan/inform-repayment",
      body,
    );
  }

  /**
   * Spec 024 B.2 — repay preflight client.
   *
   * Calls POST /loan/repay/preflight (spec 024 A.4). The backend reads
   * on-chain state, calls accrueLate() serially when the loan is past
   * grace + has a non-zero rate, and returns the payload that powers
   * the live ticker UI.
   *
   * BigInt fields (principal, storedAmountDueBefore, accruedAmountDue,
   * ratePerSecWad) come over the wire as decimal strings — JSON cannot
   * transport bigint. We parse them back to BigInt here so the calling
   * code (live ticker, allowance computation) gets the right type.
   *
   * Throttled server-side at 6/min/wallet — clients SHOULD NOT spam.
   * Per spec 024 §4.4.1, recommended refresh cadence on the live
   * counter screen is at most once per 10 s.
   */
  async preflightRepayment(
    body: RepayPreflightRequest,
    opts: { force?: boolean } = {},
  ): Promise<RepayPreflightPayload> {
    // Spec 033 — `force=true` only when the user clicks "Pagar". This
    // tells the backend to fire `accrueLate` and materialize current
    // mora into storage before the user signs `repay(MaxUint256)`.
    // Default (autoRefresh / focus / mount) is read-only.
    const path = opts.force
      ? "/loan/repay/preflight?force=true"
      : "/loan/repay/preflight";
    const wire = await this.authedPost<RepayPreflightResponseWire>(
      path,
      body,
    );
    return {
      ...wire,
      principal: BigInt(wire.principal),
      storedAmountDueBefore: BigInt(wire.storedAmountDueBefore),
      accruedAmountDue: BigInt(wire.accruedAmountDue),
      ratePerSecWad: BigInt(wire.ratePerSecWad),
    };
  }

  // ── Self ──

  selfVerify(body: SelfVerifyRequest): Promise<SelfVerifyResponse> {
    return this.authedPost<SelfVerifyResponse>("/self/verify", body);
  }

  selfProfile(walletAddress: string): Promise<SelfProfileResponse> {
    return this.authedGet<SelfProfileResponse>(
      `/self/profile?walletAddress=${encodeURIComponent(walletAddress)}`,
    );
  }

  // ── Spec 044: Lemon SDK identity claims ──

  /**
   * Spec 044 — persist identity claims granted via
   * `lemonAuthenticate({ requirements: { claims }})`.
   * Idempotent: calling twice with the same payload is safe.
   * Returns identityMatchScore when Self KYC fields were present to compare.
   */
  lemonProfile(body: LemonProfilePayload): Promise<LemonProfileResponse> {
    return this.authedPost<LemonProfileResponse>("/user/lemon-profile", body);
  }

  // ── Analytics (fire-and-forget, never throw) ──

  trackSession(data: {
    sessionId: string;
    walletAddress?: string;
    platform?: string;
  }): Promise<void> {
    return this.post("/analytics/session", data).catch(() => {});
  }

  trackEvent(data: {
    sessionId?: string;
    walletAddress?: string;
    eventType: string;
    path?: string;
    metadata?: Record<string, unknown>;
    clientTimestamp?: number;
  }): Promise<void> {
    return this.post("/analytics/event", data).catch(() => {});
  }

  trackBorrowAttempt(data: {
    walletAddress?: string;
    sessionId?: string;
    amountHuman?: string;
    tenorDays?: number;
    outcome: string;
    errorType?: string;
    errorMessage?: string;
    durationMs?: number;
  }): Promise<void> {
    return this.post("/analytics/borrow-attempt", data).catch(() => {});
  }
}

/**
 * Spec 044 — singleton instance for fire-and-forget endpoints
 * (analytics, lemonProfile) called outside React render context.
 *
 * Uses a noop refresh because the only authenticated callers
 * (`lemonProfile`) are invoked immediately after a successful
 * SIWE/refresh, so the access token is fresh and won't need rotation
 * during the call. If auth fails, the `.catch(() => {})` at call sites
 * silently swallows it (best-effort persistence).
 */
const noopRefresh: RefreshFn = async () => null;
export const lendoorApi = new LendoorApi(noopRefresh);
