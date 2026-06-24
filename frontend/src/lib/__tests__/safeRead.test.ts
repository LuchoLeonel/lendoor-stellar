import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

import { toast } from 'sonner';
import { safeRead } from '../safeRead';

const mockToast = toast as { error: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  // Default: tab is visible
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'visible',
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('safeRead', () => {
  describe('successful reads', () => {
    it('returns the resolved value from fn', async () => {
      const fn = vi.fn().mockResolvedValue(42);

      const result = await safeRead(fn, 0, 'test-tag');

      expect(result).toBe(42);
    });

    it('returns complex objects unchanged', async () => {
      const data = { balance: '1000', decimals: 6 };
      const fn = vi.fn().mockResolvedValue(data);

      const result = await safeRead(fn, null, 'balance-tag');

      expect(result).toEqual(data);
    });

    it('does not call toast on success', async () => {
      const fn = vi.fn().mockResolvedValue('value');

      await safeRead(fn, '', 'tag', { toastOnError: true });

      expect(mockToast.error).not.toHaveBeenCalled();
    });
  });

  describe('error handling — returns fallback', () => {
    it('returns fallback when fn throws', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('contract read failed'));

      const promise = safeRead(fn, 'fallback', 'error-tag');
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe('fallback');
    });

    it('returns 0n fallback for bigint', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('rpc error'));

      const promise = safeRead(fn, 0n, 'bigint-tag');
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe(0n);
    });

    it('returns null fallback', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));

      const promise = safeRead(fn, null, 'null-fallback');
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBeNull();
    });

    it('does NOT show toast by default (toastOnError=false)', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));

      const promise = safeRead(fn, 0, 'silent-tag');
      await vi.runAllTimersAsync();
      await promise;

      expect(mockToast.error).not.toHaveBeenCalled();
    });

    it('shows toast when toastOnError=true and tab is visible', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));

      const promise = safeRead(fn, 0, 'toast-tag', { toastOnError: true });
      await vi.runAllTimersAsync();
      await promise;

      expect(mockToast.error).toHaveBeenCalledOnce();
    });

    it('does NOT show toast when tab is hidden even if toastOnError=true', async () => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      const fn = vi.fn().mockRejectedValue(new Error('fail'));

      const promise = safeRead(fn, 0, 'hidden-tab-tag', { toastOnError: true });
      await vi.runAllTimersAsync();
      await promise;

      expect(mockToast.error).not.toHaveBeenCalled();
    });
  });

  describe('timeout behaviour', () => {
    it('returns fallback when fn exceeds timeoutMs', async () => {
      const fn = vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve('late'), 10_000)),
      );

      const promise = safeRead(fn, 'timed-out', 'slow-tag', { timeoutMs: 100 });

      // Advance past the timeout
      vi.advanceTimersByTime(200);

      const result = await promise;

      expect(result).toBe('timed-out');
    });

    it('resolves successfully when fn completes before timeoutMs', async () => {
      const fn = vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve('fast'), 50)),
      );

      const promise = safeRead(fn, 'fallback', 'fast-tag', { timeoutMs: 5000 });

      vi.advanceTimersByTime(100);

      const result = await promise;

      expect(result).toBe('fast');
    });
  });

  describe('mapError option', () => {
    it('calls custom mapError with the thrown error', async () => {
      const error = new Error('raw');
      const fn = vi.fn().mockRejectedValue(error);
      const mapError = vi.fn().mockReturnValue('mapped message');

      const promise = safeRead(fn, 0, 'map-tag', { mapError });
      await vi.runAllTimersAsync();
      await promise;

      expect(mapError).toHaveBeenCalledWith(error);
    });

    it('uses shortMessage when available and no custom mapError', async () => {
      const fn = vi.fn().mockRejectedValue({ shortMessage: 'short msg', message: 'long msg' });

      const promise = safeRead(fn, 0, 'short-msg-tag');
      await vi.runAllTimersAsync();
      await promise;

      // If the error has shortMessage, the default mapError picks it.
      // We just verify safeRead doesn't throw.
      // The tag + message lands in window.__LENDOOR_LAST_ERROR
      const lastError = (window as unknown as Record<string, unknown>).__LENDOOR_LAST_ERROR as { msg: string } | undefined;
      expect(lastError?.msg).toBe('short msg');
    });
  });

  describe('window.__LENDOOR_LAST_ERROR', () => {
    it('stores debug info on error', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('debug error'));

      const promise = safeRead(fn, 0, 'debug-tag');
      await vi.runAllTimersAsync();
      await promise;

      const lastError = (window as unknown as Record<string, unknown>).__LENDOOR_LAST_ERROR as {
        tag: string;
        msg: string;
      };
      expect(lastError.tag).toBe('debug-tag');
      expect(lastError.msg).toBe('debug error');
    });

    it('includes timestamp in debug info', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('ts error'));
      const before = Date.now();

      const promise = safeRead(fn, 0, 'ts-tag');
      await vi.runAllTimersAsync();
      await promise;

      const lastError = (window as unknown as Record<string, unknown>).__LENDOOR_LAST_ERROR as {
        at: number;
      };
      expect(lastError.at).toBeGreaterThanOrEqual(before);
    });
  });
});
