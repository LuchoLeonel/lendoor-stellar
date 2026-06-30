import { createContext, useContext, useEffect, useRef, useMemo, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { initClarity } from '@/lib/clarity';
import { BACKEND_URL } from '@/lib/constants';
import { isStellarMode } from '@/lib/stellar-wallet';

// ── Session context ──────────────────────────────────────────────────

type AnalyticsContextValue = {
  sessionId: string;
  /** Call when wallet address becomes available (after auth) */
  setWallet: (wallet: string) => void;
};

const AnalyticsContext = createContext<AnalyticsContextValue>({
  sessionId: '',
  setWallet: () => {},
});

export function useAnalyticsSession() {
  return useContext(AnalyticsContext);
}

// ── Helpers ──────────────────────────────────────────────────────────

function generateSessionId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older WebViews — 32 hex chars for collision resistance
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Fire-and-forget POST — never throws, never blocks */
function firePost(path: string, body: Record<string, unknown>) {
  // El backend de Stellar no tiene endpoints de analytics → evitamos los 404
  // ruidosos en consola (analytics no aplica a este deploy).
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

// ── Provider ─────────────────────────────────────────────────────────

type Props = { children: React.ReactNode };

export function AnalyticsProvider({ children }: Props) {
  const sessionId = useMemo(() => generateSessionId(), []);
  const sessionSent = useRef(false);
  const walletSent = useRef<string | null>(null);

  // Initialize Clarity (existing behavior)
  useEffect(() => {
    initClarity();
  }, []);

  // Send session on mount (device + IP captured by backend from headers)
  useEffect(() => {
    if (sessionSent.current) return;
    sessionSent.current = true;

    firePost('/analytics/session', {
      sessionId,
      platform: 'lemon', // default, could detect from SDK
    });
  }, [sessionId]);

  // Called when wallet becomes available — sends update to link session to user
  const setWallet = useCallback(
    (wallet: string) => {
      if (!wallet || walletSent.current === wallet.toLowerCase()) return;
      walletSent.current = wallet.toLowerCase();

      firePost('/analytics/session', {
        sessionId,
        walletAddress: wallet.toLowerCase(),
        platform: 'lemon',
      });
    },
    [sessionId],
  );

  const value = useMemo(() => ({ sessionId, setWallet }), [sessionId, setWallet]);

  return (
    <AnalyticsContext.Provider value={value}>
      <PageTracker sessionId={sessionId} />
      {children}
    </AnalyticsContext.Provider>
  );
}

// ── Page tracker (invisible component) ───────────────────────────────

function PageTracker({ sessionId }: { sessionId: string }) {
  const location = useLocation();
  const lastPath = useRef('');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const path = location.pathname;
    if (path === lastPath.current) return;

    // Debounce rapid route changes (redirects)
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      lastPath.current = path;
      firePost('/analytics/event', {
        sessionId,
        eventType: 'page_view',
        path,
        clientTimestamp: Date.now(),
      });
    }, 300);

    return () => clearTimeout(debounceRef.current);
  }, [location.pathname, sessionId]);

  return null;
}
