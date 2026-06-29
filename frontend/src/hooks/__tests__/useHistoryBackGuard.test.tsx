import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useHistoryBackGuard } from '../useHistoryBackGuard';

// Helper: simulate a browser back press by firing a popstate event with
// the given state (like `history.back()` would dispatch).
function firePopstate(state: unknown) {
  const event = new PopStateEvent('popstate', { state });
  window.dispatchEvent(event);
}

describe('useHistoryBackGuard', () => {
  let pushStateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    pushStateSpy = vi.spyOn(window.history, 'pushState');
  });

  afterEach(() => {
    pushStateSpy.mockRestore();
    vi.useRealTimers();
  });

  it('pushes a sentinel entry on mount so first back is interceptable', () => {
    renderHook(() =>
      useHistoryBackGuard({
        onBack: vi.fn(),
        namespace: 'tabs',
      }),
    );
    expect(pushStateSpy).toHaveBeenCalledWith({ ns: 'tabs' }, '');
  });

  it('delegates same-namespace back presses to onBack', () => {
    const onBack = vi.fn(() => true);
    renderHook(() =>
      useHistoryBackGuard({
        onBack,
        namespace: 'tabs',
      }),
    );
    act(() => firePopstate({ v: 'solicitar', ns: 'tabs' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('pushes a new sentinel after a handled back so it is intercepted again', () => {
    const onBack = vi.fn(() => true);
    renderHook(() =>
      useHistoryBackGuard({
        onBack,
        namespace: 'tabs',
      }),
    );
    pushStateSpy.mockClear(); // ignore the mount push
    act(() => firePopstate({ v: 'solicitar', ns: 'tabs' }));
    expect(pushStateSpy).toHaveBeenCalledWith({ ns: 'tabs' }, '');
  });

  it('ignores popstate events from other namespaces', () => {
    const onBack = vi.fn(() => true);
    renderHook(() =>
      useHistoryBackGuard({
        onBack,
        namespace: 'tabs',
      }),
    );
    act(() => firePopstate({ v: 'other', ns: 'modal-foo' }));
    expect(onBack).not.toHaveBeenCalled();
  });

  it('handles popstate with null state as an app back press', () => {
    const onBack = vi.fn(() => true);
    renderHook(() =>
      useHistoryBackGuard({
        onBack,
        namespace: 'tabs',
      }),
    );
    act(() => firePopstate(null));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('namespace defaults to app when not provided', () => {
    const onBack = vi.fn(() => true);
    renderHook(() =>
      useHistoryBackGuard({
        onBack,
      }),
    );
    act(() => firePopstate({ v: 'progreso', ns: 'app' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('cleans up popstate listener on unmount', () => {
    const onBack = vi.fn(() => true);
    const { unmount } = renderHook(() =>
      useHistoryBackGuard({
        onBack,
        namespace: 'tabs',
      }),
    );
    unmount();
    act(() => firePopstate({ v: 'solicitar', ns: 'tabs' }));
    expect(onBack).not.toHaveBeenCalled();
  });

  it('multiple consecutive handled back presses stay protected', () => {
    const onBack = vi.fn(() => true);
    renderHook(() =>
      useHistoryBackGuard({
        onBack,
        namespace: 'tabs',
      }),
    );
    act(() => firePopstate({ v: 'solicitar', ns: 'tabs' }));
    act(() => firePopstate({ v: 'progreso', ns: 'tabs' }));
    act(() => firePopstate({ v: 'cuenta', ns: 'tabs' }));

    expect(onBack).toHaveBeenCalledTimes(3);
    expect(pushStateSpy).toHaveBeenCalledTimes(4); // mount + one re-protect per handled back
  });

  it('arms exit instead of re-protecting when onBack returns false', () => {
    vi.useFakeTimers();
    const onBack = vi.fn(() => false);
    const onArmExit = vi.fn();
    renderHook(() =>
      useHistoryBackGuard({
        onBack,
        onArmExit,
        namespace: 'tabs',
        exitWindowMs: 1000,
      }),
    );

    pushStateSpy.mockClear();
    act(() => firePopstate({ ns: 'tabs' }));

    expect(onArmExit).toHaveBeenCalledTimes(1);
    expect(pushStateSpy).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1000));
    expect(pushStateSpy).toHaveBeenCalledWith({ ns: 'tabs' }, '');
  });
});
