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
  });

  it('pushes a sentinel entry on mount so first back is interceptable', () => {
    renderHook(() =>
      useHistoryBackGuard({
        currentView: 'inicio',
        rootView: 'inicio',
        onBack: vi.fn(),
        namespace: 'tabs',
      }),
    );
    expect(pushStateSpy).toHaveBeenCalledWith(
      { v: 'inicio', ns: 'tabs' },
      '',
    );
  });

  it('on back press from any view, navigates to rootView (not to previous)', () => {
    const onBack = vi.fn();
    renderHook(() =>
      useHistoryBackGuard({
        currentView: 'progreso',
        rootView: 'inicio',
        onBack,
        namespace: 'tabs',
      }),
    );
    act(() => firePopstate({ v: 'solicitar', ns: 'tabs' }));
    // Key assertion: lands on rootView (inicio), NOT on the popstate's v (solicitar).
    expect(onBack).toHaveBeenCalledWith('inicio');
  });

  it('pushes a new root sentinel after handling so back is intercepted again', () => {
    const onBack = vi.fn();
    renderHook(() =>
      useHistoryBackGuard({
        currentView: 'progreso',
        rootView: 'inicio',
        onBack,
        namespace: 'tabs',
      }),
    );
    pushStateSpy.mockClear(); // ignore the mount push
    act(() => firePopstate({ v: 'solicitar', ns: 'tabs' }));
    expect(pushStateSpy).toHaveBeenCalledWith({ v: 'inicio', ns: 'tabs' }, '');
  });

  it('ignores popstate events from other namespaces', () => {
    const onBack = vi.fn();
    renderHook(() =>
      useHistoryBackGuard({
        currentView: 'solicitar',
        rootView: 'inicio',
        onBack,
        namespace: 'tabs',
      }),
    );
    act(() => firePopstate({ v: 'other', ns: 'modal-foo' }));
    expect(onBack).not.toHaveBeenCalled();
  });

  it('handles popstate with null state (no sentinel present) by going to root', () => {
    const onBack = vi.fn();
    renderHook(() =>
      useHistoryBackGuard({
        currentView: 'cuenta',
        rootView: 'inicio',
        onBack,
        namespace: 'tabs',
      }),
    );
    act(() => firePopstate(null));
    expect(onBack).toHaveBeenCalledWith('inicio');
  });

  it('namespace defaults to rootView when not provided', () => {
    const onBack = vi.fn();
    renderHook(() =>
      useHistoryBackGuard({
        currentView: 'solicitar',
        rootView: 'inicio',
        onBack,
      }),
    );
    // Same-namespace popstate (ns defaults to 'inicio') must be handled
    act(() => firePopstate({ v: 'progreso', ns: 'inicio' }));
    expect(onBack).toHaveBeenCalledWith('inicio');
  });

  it('cleans up popstate listener on unmount', () => {
    const onBack = vi.fn();
    const { unmount } = renderHook(() =>
      useHistoryBackGuard({
        currentView: 'inicio',
        rootView: 'inicio',
        onBack,
        namespace: 'tabs',
      }),
    );
    unmount();
    act(() => firePopstate({ v: 'solicitar', ns: 'tabs' }));
    expect(onBack).not.toHaveBeenCalled();
  });

  it('multiple consecutive back presses always land on root', () => {
    const onBack = vi.fn();
    renderHook(() =>
      useHistoryBackGuard({
        currentView: 'progreso',
        rootView: 'inicio',
        onBack,
        namespace: 'tabs',
      }),
    );
    act(() => firePopstate({ v: 'solicitar', ns: 'tabs' }));
    act(() => firePopstate({ v: 'progreso', ns: 'tabs' }));
    act(() => firePopstate({ v: 'cuenta', ns: 'tabs' }));

    // All 3 calls must have gone to inicio — never to the popstate value.
    expect(onBack).toHaveBeenCalledTimes(3);
    onBack.mock.calls.forEach((call) => {
      expect(call[0]).toBe('inicio');
    });
  });
});
