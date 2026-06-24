import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

import { toast } from 'sonner';
import { dedupeToast } from '../dedupeToast';

const mockToast = toast as {
  error: ReturnType<typeof vi.fn>;
  success: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warning: ReturnType<typeof vi.fn>;
};

describe('dedupeToast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('dedupeToast.error', () => {
    it('calls toast.error with the message as id', () => {
      dedupeToast.error('Something failed');

      expect(mockToast.error).toHaveBeenCalledOnce();
      expect(mockToast.error).toHaveBeenCalledWith('Something failed', { id: 'Something failed' });
    });

    it('preserves and merges custom opts with the id', () => {
      dedupeToast.error('Network error', { duration: 5000 });

      expect(mockToast.error).toHaveBeenCalledWith('Network error', {
        id: 'Network error',
        duration: 5000,
      });
    });

    it('passes the same id both times when called with the same message twice', () => {
      dedupeToast.error('Duplicate error');
      dedupeToast.error('Duplicate error');

      expect(mockToast.error).toHaveBeenCalledTimes(2);
      expect(mockToast.error.mock.calls[0][1]).toEqual({ id: 'Duplicate error' });
      expect(mockToast.error.mock.calls[1][1]).toEqual({ id: 'Duplicate error' });
    });
  });

  describe('dedupeToast.success', () => {
    it('calls toast.success with the message as id', () => {
      dedupeToast.success('All done!');

      expect(mockToast.success).toHaveBeenCalledOnce();
      expect(mockToast.success).toHaveBeenCalledWith('All done!', { id: 'All done!' });
    });

    it('preserves and merges custom opts with the id', () => {
      dedupeToast.success('Saved', { className: 'my-toast' });

      expect(mockToast.success).toHaveBeenCalledWith('Saved', {
        id: 'Saved',
        className: 'my-toast',
      });
    });

    it('passes the same id both times when called with the same message twice', () => {
      dedupeToast.success('Repeated success');
      dedupeToast.success('Repeated success');

      expect(mockToast.success).toHaveBeenCalledTimes(2);
      expect(mockToast.success.mock.calls[0][1]).toEqual({ id: 'Repeated success' });
      expect(mockToast.success.mock.calls[1][1]).toEqual({ id: 'Repeated success' });
    });
  });

  describe('dedupeToast.info', () => {
    it('calls toast.info with the message as id', () => {
      dedupeToast.info('Code sent');

      expect(mockToast.info).toHaveBeenCalledOnce();
      expect(mockToast.info).toHaveBeenCalledWith('Code sent', { id: 'Code sent' });
    });

    it('preserves and merges custom opts with the id', () => {
      dedupeToast.info('Info message', { duration: 3000 });

      expect(mockToast.info).toHaveBeenCalledWith('Info message', {
        id: 'Info message',
        duration: 3000,
      });
    });

    it('passes the same id both times when called with the same message twice', () => {
      dedupeToast.info('Duplicate info');
      dedupeToast.info('Duplicate info');

      expect(mockToast.info).toHaveBeenCalledTimes(2);
      expect(mockToast.info.mock.calls[0][1]).toEqual({ id: 'Duplicate info' });
      expect(mockToast.info.mock.calls[1][1]).toEqual({ id: 'Duplicate info' });
    });
  });

  describe('dedupeToast.warning', () => {
    it('calls toast.warning with the message as id', () => {
      dedupeToast.warning('Watch out');

      expect(mockToast.warning).toHaveBeenCalledOnce();
      expect(mockToast.warning).toHaveBeenCalledWith('Watch out', { id: 'Watch out' });
    });

    it('preserves and merges custom opts with the id', () => {
      dedupeToast.warning('Low balance', { position: 'top-center' });

      expect(mockToast.warning).toHaveBeenCalledWith('Low balance', {
        id: 'Low balance',
        position: 'top-center',
      });
    });

    it('passes the same id both times when called with the same message twice', () => {
      dedupeToast.warning('Duplicate warning');
      dedupeToast.warning('Duplicate warning');

      expect(mockToast.warning).toHaveBeenCalledTimes(2);
      expect(mockToast.warning.mock.calls[0][1]).toEqual({ id: 'Duplicate warning' });
      expect(mockToast.warning.mock.calls[1][1]).toEqual({ id: 'Duplicate warning' });
    });
  });

  describe('id derivation', () => {
    it('uses the full message string verbatim as the id', () => {
      const msg = 'Session expired — please reconnect';
      dedupeToast.error(msg);

      expect(mockToast.error).toHaveBeenCalledWith(msg, { id: msg });
    });

    it('opts id field is overridden by the message-derived id', () => {
      // Even if the caller passes their own id, our wrapper sets id from the message
      dedupeToast.error('Override test', { id: 'caller-id' });

      // The spread order is { id: toId(msg), ...opts }, so caller's id wins here
      expect(mockToast.error).toHaveBeenCalledWith('Override test', {
        id: 'caller-id',
      });
    });
  });
});
