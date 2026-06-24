import { describe, it, expect, vi, afterEach } from 'vitest';
import { retryWithBackoff } from '../retryWithBackoff';

// We use real timers here and set baseDelayMs to 0 so retries are instant.
// This avoids the unhandled-rejection race condition that occurs when fake
// timers and Promise.reject interact.

afterEach(() => {
  vi.restoreAllMocks();
});

describe('retryWithBackoff', () => {
  describe('success on first attempt', () => {
    it('resolves immediately when fn succeeds', async () => {
      const fn = vi.fn().mockResolvedValue('ok');

      const result = await retryWithBackoff(fn);

      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledOnce();
    });

    it('returns the resolved value unchanged', async () => {
      const fn = vi.fn().mockResolvedValue({ data: 42 });

      const result = await retryWithBackoff(fn);

      expect(result).toEqual({ data: 42 });
    });
  });

  describe('retries on failure', () => {
    it('retries up to maxAttempts before succeeding', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockResolvedValue('success');

      const result = await retryWithBackoff(fn, { maxAttempts: 3, baseDelayMs: 0 });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('throws on the last failed attempt when maxAttempts is exhausted', async () => {
      const error = new Error('always fails');
      const fn = vi.fn().mockRejectedValue(error);

      await expect(
        retryWithBackoff(fn, { maxAttempts: 3, baseDelayMs: 0 }),
      ).rejects.toThrow('always fails');

      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('defaults to 3 maxAttempts when not specified', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));

      // Use baseDelayMs:0 via shouldRetry trick to avoid real sleep for the default
      // 1000ms delay. We do this by using a custom tiny baseDelayMs.
      await expect(
        retryWithBackoff(fn, { baseDelayMs: 0 }),
      ).rejects.toThrow();

      expect(fn).toHaveBeenCalledTimes(3);
    });
  });

  describe('shouldRetry option', () => {
    it('stops retrying immediately when shouldRetry returns false', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('abort'));

      await expect(
        retryWithBackoff(fn, { maxAttempts: 5, baseDelayMs: 0, shouldRetry: () => false }),
      ).rejects.toThrow('abort');

      // shouldRetry = false on first failure: only one call, no retries
      expect(fn).toHaveBeenCalledOnce();
    });

    it('retries only while shouldRetry returns true', async () => {
      let callCount = 0;
      const fn = vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.reject(new Error(`fail ${callCount}`));
      });

      // Retry only when error message is 'fail 1' → stops after second call
      await expect(
        retryWithBackoff(fn, {
          maxAttempts: 5,
          baseDelayMs: 0,
          shouldRetry: (err) => (err as Error).message === 'fail 1',
        }),
      ).rejects.toThrow('fail 2');

      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('passes the caught error to shouldRetry', async () => {
      const shouldRetry = vi.fn().mockReturnValue(false);
      const error = new Error('specific error');
      const fn = vi.fn().mockRejectedValue(error);

      await expect(
        retryWithBackoff(fn, { maxAttempts: 3, baseDelayMs: 0, shouldRetry }),
      ).rejects.toThrow();

      expect(shouldRetry).toHaveBeenCalledWith(error);
    });
  });

  describe('options defaults', () => {
    it('uses maxAttempts=1 to make exactly one call and throw on failure', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));

      await expect(
        retryWithBackoff(fn, { maxAttempts: 1, baseDelayMs: 0 }),
      ).rejects.toThrow();

      expect(fn).toHaveBeenCalledOnce();
    });
  });
});
