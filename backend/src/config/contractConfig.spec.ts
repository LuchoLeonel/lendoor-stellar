/**
 * Spec 021 §Phase 2 — unit tests for chain-write retry behaviour.
 *
 * The module imports ethers + config heavyweight at load time. We only
 * need the pure helpers (`isRetryableChainError`, `withChainWriteRetry`).
 * Tests stub the injected `waitFn` so backoff delays don't slow jest.
 */
import {
  isRetryableChainError,
  withChainWriteRetry,
  RETRYABLE_ERROR_FRAGMENTS,
  MAX_SEND_ATTEMPTS,
} from './contractConfig';

describe('isRetryableChainError', () => {
  it('returns true for each documented retryable fragment', () => {
    for (const frag of RETRYABLE_ERROR_FRAGMENTS) {
      const err = new Error(`something something ${frag} extra text`);
      expect(isRetryableChainError(err)).toBe(true);
    }
  });

  it('returns false for a generic revert', () => {
    const err = new Error('setUserRisk reverted on estimateGas');
    expect(isRetryableChainError(err)).toBe(false);
  });

  it('returns false for a plain balance error', () => {
    const err = new Error('insufficient funds for gas');
    expect(isRetryableChainError(err)).toBe(false);
  });

  it('extracts message from .shortMessage when .message is missing', () => {
    const err = {
      shortMessage: 'AUTO_CLEAR_FAILED nonce=17: transient',
    };
    expect(isRetryableChainError(err)).toBe(true);
  });

  it('tolerates non-Error throws (string payloads)', () => {
    expect(isRetryableChainError('nonce has already been used on this tx')).toBe(true);
    expect(isRetryableChainError('something totally different')).toBe(false);
  });
});

describe('withChainWriteRetry', () => {
  const noWait = async (_ms: number) => undefined;

  it('succeeds on the first attempt, invokes fn once', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await withChainWriteRetry(fn, 'test', { waitFn: noWait });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on retryable error, then succeeds', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('AUTO_CLEAR_FAILED nonce=42: foo'))
      .mockResolvedValueOnce('ok');
    const result = await withChainWriteRetry(fn, 'test', { waitFn: noWait });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on non-retryable error — fails on first attempt', async () => {
    const onFinalFailure = jest.fn();
    const fn = jest
      .fn()
      .mockRejectedValue(new Error('setUserRisk reverted on estimateGas'));
    await expect(
      withChainWriteRetry(fn, 'test', { waitFn: noWait, onFinalFailure }),
    ).rejects.toThrow('setUserRisk reverted on estimateGas');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(onFinalFailure).toHaveBeenCalledWith(expect.any(Error), 1);
  });

  it('retries up to maxAttempts then gives up with final failure callback', async () => {
    const onFinalFailure = jest.fn();
    const fn = jest
      .fn()
      .mockRejectedValue(new Error('AUTO_CLEAR_FAILED nonce=99: persistent'));
    await expect(
      withChainWriteRetry(fn, 'test', {
        waitFn: noWait,
        maxAttempts: 3,
        onFinalFailure,
      }),
    ).rejects.toThrow('AUTO_CLEAR_FAILED');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onFinalFailure).toHaveBeenCalledTimes(1);
    expect(onFinalFailure).toHaveBeenCalledWith(expect.any(Error), 3);
  });

  it('calls onRetry hook between attempts with attempt/max/wait', async () => {
    const onRetry = jest.fn();
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('nonce has already been used'))
      .mockRejectedValueOnce(new Error('nonce has already been used'))
      .mockResolvedValueOnce('ok');
    await withChainWriteRetry(fn, 'test', {
      waitFn: noWait,
      maxAttempts: 3,
      onRetry,
      backoffMs: (a) => a * 1000,
    });
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenNthCalledWith(1, expect.any(Error), 1, 3, 1000);
    expect(onRetry).toHaveBeenNthCalledWith(2, expect.any(Error), 2, 3, 2000);
  });

  it('uses default backoff 2s/4s/6s when not overridden', async () => {
    const waits: number[] = [];
    const waitFn = async (ms: number) => {
      waits.push(ms);
    };
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('AUTO_CLEAR_FAILED a'))
      .mockRejectedValueOnce(new Error('AUTO_CLEAR_FAILED b'))
      .mockResolvedValueOnce('ok');
    await withChainWriteRetry(fn, 'test', { waitFn });
    expect(waits).toEqual([2000, 4000]);
  });

  it('MAX_SEND_ATTEMPTS default is 3', () => {
    expect(MAX_SEND_ATTEMPTS).toBe(3);
  });

  it('does not call waitFn after the final attempt', async () => {
    const waitFn = jest.fn().mockResolvedValue(undefined);
    const fn = jest.fn().mockRejectedValue(new Error('AUTO_CLEAR_FAILED'));
    await expect(
      withChainWriteRetry(fn, 'test', { waitFn, maxAttempts: 2 }),
    ).rejects.toThrow();
    // With maxAttempts=2, we call fn twice but only wait once (between attempts).
    expect(fn).toHaveBeenCalledTimes(2);
    expect(waitFn).toHaveBeenCalledTimes(1);
  });
});
