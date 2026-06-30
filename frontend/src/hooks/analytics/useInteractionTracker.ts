/**
 * Tracks user interactions (taps/clicks) per session.
 * Sends a summary every 2 minutes or when the page is hidden (app backgrounded).
 *
 * No UX impact — runs silently via passive event listeners.
 */

import { useEffect, useRef } from 'react';
import { useAnalyticsSession } from '@/providers/AnalyticsProvider';
import { BACKEND_URL } from '@/lib/constants';
import { isStellarMode } from '@/lib/stellar-wallet';

const FLUSH_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

function firePost(path: string, body: Record<string, unknown>) {
  // Sin endpoints de analytics en el backend de Stellar → no disparamos (evita 404).
  if (isStellarMode()) return;
  try {
    fetch(`${BACKEND_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => {});
  } catch {
    // swallow
  }
}

export function useInteractionTracker() {
  const { sessionId } = useAnalyticsSession();
  const tapsRef = useRef(0);
  const tapsByPageRef = useRef<Record<string, number>>({});
  const scrollMaxRef = useRef(0);
  const lastFlushRef = useRef(Date.now());

  useEffect(() => {
    if (!sessionId) return;

    // Count taps/clicks
    const onTap = () => {
      tapsRef.current += 1;
      const path = window.location.pathname;
      tapsByPageRef.current[path] =
        (tapsByPageRef.current[path] || 0) + 1;
    };

    // Track max scroll depth (0-1)
    const onScroll = () => {
      const root = document.getElementById('root');
      if (!root) return;
      const depth =
        root.scrollHeight > root.clientHeight
          ? root.scrollTop / (root.scrollHeight - root.clientHeight)
          : 0;
      if (depth > scrollMaxRef.current) {
        scrollMaxRef.current = depth;
      }
    };

    // Flush summary
    const flush = () => {
      if (tapsRef.current === 0) return;

      firePost('/analytics/event', {
        sessionId,
        eventType: 'interaction_summary',
        metadata: {
          totalTaps: tapsRef.current,
          tapsByPage: { ...tapsByPageRef.current },
          maxScrollDepth: Math.round(scrollMaxRef.current * 100) / 100,
          periodMs: Date.now() - lastFlushRef.current,
        },
        clientTimestamp: Date.now(),
      });

      // Reset counters
      tapsRef.current = 0;
      tapsByPageRef.current = {};
      scrollMaxRef.current = 0;
      lastFlushRef.current = Date.now();
    };

    // Flush on visibility change (user backgrounds the app)
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        flush();
      }
    };

    // Periodic flush
    const interval = setInterval(flush, FLUSH_INTERVAL_MS);

    // Passive listeners (no performance impact)
    document.addEventListener('click', onTap, { passive: true });
    document.addEventListener('touchstart', onTap, { passive: true });
    document.addEventListener('scroll', onScroll, {
      passive: true,
      capture: true,
    });
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      flush(); // final flush on unmount
      clearInterval(interval);
      document.removeEventListener('click', onTap);
      document.removeEventListener('touchstart', onTap);
      document.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [sessionId]);
}
