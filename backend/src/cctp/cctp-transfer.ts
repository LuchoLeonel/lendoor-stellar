/**
 * CCTP transfer state machine + Iris attestation client contract (Tranche 0).
 *
 * Scope: TYPES AND TRANSITIONS ONLY — no network calls yet. This is the
 * scaffolding the award's Tranche 0 commits to ("CCTP integration
 * scaffolding"); the live burn/attest/mint flow lands with D1.1 on top of it.
 *
 * Shape adapted from lumenline-labs/lumenline (Apache-2.0) —
 * packages/relayer/src/repo/types.ts and work/reconcile.ts: a small explicit
 * transition table validated at the repository boundary (not scattered through
 * callers), and idempotent reconciliation keyed by the CCTP nonce, asking the
 * chain (`is_nonce_used`) rather than trusting a DB flag.
 *
 * Iris retry contract (verified against Circle's docs and both reference
 * repos): HTTP 404 for a known burn tx means "attestation not ready yet" —
 * it is PENDING, not an error. 429 means back off. Only a malformed request
 * or an unknown domain is a real failure.
 */

/** CCTP V2 domain ids. Stellar is domain 27; Base Sepolia (testnet origin) is 6. */
export const CCTP_DOMAINS = {
  STELLAR: 27,
  BASE_SEPOLIA: 6,
} as const;

export type CctpDomain = (typeof CCTP_DOMAINS)[keyof typeof CCTP_DOMAINS];

/**
 * Lifecycle of one cross-chain transfer:
 *
 *   pending ──► attested ──► submitting ──► delivered
 *      │            │             │  ▲
 *      ▼            ▼             │  │ (submit failed but retryable:
 *    failed       failed          │  │  back to attested, nonce unused)
 *                                 ▼  │
 *                               failed
 *
 * `delivered` and `failed` are terminal. A retry of a failed transfer is a NEW
 * row with the same nonce — and the nonce-used check on chain makes the replay
 * harmless (mint is refused for a consumed nonce).
 */
export type CctpTransferState =
  | 'pending' // burn seen on the source chain; waiting for Iris
  | 'attested' // Iris returned the attestation; mint not sent yet
  | 'submitting' // mint transaction sent on Stellar; awaiting confirmation
  | 'delivered' // mint confirmed; funds in the vault via deposit_from
  | 'failed'; // terminal; requeue creates a new attempt, same nonce

/** The ONLY legal edges. Everything else must throw, never silently proceed. */
export const LEGAL_TRANSITIONS: Readonly<
  Record<CctpTransferState, readonly CctpTransferState[]>
> = {
  pending: ['attested', 'failed'],
  attested: ['submitting', 'failed'],
  submitting: ['delivered', 'attested', 'failed'],
  delivered: [],
  failed: [],
};

export class IllegalCctpTransition extends Error {
  constructor(
    readonly from: CctpTransferState,
    readonly to: CctpTransferState,
    readonly nonce: string,
  ) {
    super(`CCTP transfer ${nonce}: illegal transition ${from} -> ${to}`);
  }
}

/** One transfer, keyed by the CCTP nonce (globally unique per burn). */
export interface CctpTransfer {
  /** CCTP nonce from the burn event — THE idempotency key, source of truth. */
  nonce: string;
  sourceDomain: CctpDomain;
  destinationDomain: CctpDomain;
  /** burn tx hash on the source chain */
  burnTxHash: string;
  /** USDC amount in CCTP message units (6 decimals) — NOT Stellar subunits.
   * On Stellar, `deposit_for_burn`/mint amounts are 7-decimal subunits: the
   * 6→7 rescale happens at the boundary, in ONE place, when building the mint. */
  amountUsdc6: bigint;
  /** Stellar G-address whose vault shares the deposit credits (deposit_from). */
  beneficiary: string;
  state: CctpTransferState;
  /** hex attestation payload once Iris returns it */
  attestation?: string;
  /** mint tx hash on Stellar once submitted */
  mintTxHash?: string;
  /** last error message, for the failed state and for observability */
  lastError?: string;
  attempts: number;
}

/**
 * Validate and apply a state change. This is the single choke point: callers
 * never write `state` directly, so an illegal edge can't creep in from a
 * forgotten code path (the same mistake class as writing a DB flag and
 * trusting it — see the openTxHash incident).
 */
export function transition(
  t: CctpTransfer,
  to: CctpTransferState,
  patch: Partial<Pick<CctpTransfer, 'attestation' | 'mintTxHash' | 'lastError'>> = {},
): CctpTransfer {
  if (t.state === to) return t; // idempotent re-apply: a replayed event is a no-op
  if (!LEGAL_TRANSITIONS[t.state].includes(to)) {
    throw new IllegalCctpTransition(t.state, to, t.nonce);
  }
  return { ...t, ...patch, state: to };
}

/** What Iris answered for one burn. 404 maps to `pending`, never to an error. */
export type IrisAttestationStatus =
  | { kind: 'pending' } // includes HTTP 404 for a known burn: not ready yet
  | { kind: 'complete'; attestation: string }
  | { kind: 'backoff'; retryAfterMs: number } // HTTP 429
  | { kind: 'error'; message: string }; // malformed request / unknown domain

/**
 * Client contract for Circle's attestation service. The real HTTP
 * implementation lands with D1.1; the scaffolding pins down the semantics the
 * poller relies on, so the retry loop can be written and unit-tested now.
 */
export interface IrisClient {
  getAttestation(sourceDomain: CctpDomain, burnTxHash: string): Promise<IrisAttestationStatus>;
}

/** Map a raw Iris HTTP status to the semantic result — the 404 rule lives HERE. */
export function irisStatusFromHttp(
  httpStatus: number,
  body?: { attestation?: string; error?: string },
): IrisAttestationStatus {
  if (httpStatus === 200 && body?.attestation) {
    return { kind: 'complete', attestation: body.attestation };
  }
  if (httpStatus === 404) return { kind: 'pending' }; // NOT an error: not ready yet
  if (httpStatus === 429) return { kind: 'backoff', retryAfterMs: 5_000 };
  if (httpStatus >= 500) return { kind: 'pending' }; // transient; poll again
  return { kind: 'error', message: body?.error ?? `iris http ${httpStatus}` };
}

/**
 * One reconciliation step for one transfer, pure and unit-testable. The
 * `nonceUsedOnChain` input is the on-chain `is_nonce_used` answer — the ground
 * truth that makes crash recovery safe: if we crashed after submitting but
 * before recording it, the chain says the nonce is consumed and we mark
 * delivered instead of double-minting.
 */
export function reconcile(
  t: CctpTransfer,
  iris: IrisAttestationStatus,
  nonceUsedOnChain: boolean,
): CctpTransfer {
  // Ground truth first: a consumed nonce means the mint happened, whatever our DB says.
  if (nonceUsedOnChain && t.state !== 'delivered' && t.state !== 'failed') {
    // legal from submitting; from pending/attested it means an external mint —
    // still delivered, but walk the legal edges so the table stays honest
    let cur = t;
    if (cur.state === 'pending') cur = transition(cur, 'attested');
    if (cur.state === 'attested') cur = transition(cur, 'submitting');
    return transition(cur, 'delivered');
  }
  switch (t.state) {
    case 'pending':
      if (iris.kind === 'complete') {
        return transition(t, 'attested', { attestation: iris.attestation });
      }
      if (iris.kind === 'error') return transition(t, 'failed', { lastError: iris.message });
      return t; // pending / backoff: wait
    case 'attested':
    case 'submitting':
    case 'delivered':
    case 'failed':
      return t; // submit/confirm steps are driven by the worker, not by Iris
  }
}
