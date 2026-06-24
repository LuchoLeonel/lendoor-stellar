// src/providers/LenderProvider.tsx
'use client';

import * as React from 'react';
import { useContracts } from '@/providers/ContractsProvider';

// on-chain hooks (sólo lender / senior)
import { useSeniorExchangeRate } from '@/hooks/lend/useSeniorExchangeRate';
import { useSeniorYield } from '@/hooks/lend/useSeniorYield';
import { useVaultShares } from '@/hooks/lend/useVaultShares';
import { useSeniorAvailableToWithdraw } from '@/hooks/lend/useSeniorAvailableToWithdraw';

import { BACKEND_URL } from '@/lib/constants';
import type { UserJourneyResponse } from '@shared/types/api';

type BorrowSubmitFn = (
  amountInput: string,
  tenorDays?: number,
  feeBps?: number,
) => Promise<boolean>;

export type LenderContextValue = {
  creditScoreDisplay: string;
  creditLimitDisplay: string;
  borrowedDisplay: string;

  seniorExchangeRateDisplay: string;
  seniorApyDisplay: string;

  susdcDisplay: string;
  seniorWithdrawAvailableDisplay: string;

  maxBorrowDisplay: string;
  borrowSubmit: BorrowSubmitFn;
  borrowSubmitting: boolean;

  isVerified: boolean;
  setIsVerified: (on: boolean) => void;

  /** Ready del contexto de usuario (on-chain + verificación backend) */
  ready: boolean;
};

const DEFAULT_VALUE: LenderContextValue = {
  creditScoreDisplay: '—',
  creditLimitDisplay: '—/—',
  borrowedDisplay: '—',
  seniorExchangeRateDisplay: '—',
  seniorApyDisplay: '—',
  susdcDisplay: '—',
  seniorWithdrawAvailableDisplay: '—',
  maxBorrowDisplay: '—',
  borrowSubmit: async (_amountInput: string, _tenorDays?: number, _feeBps?: number) => false,
  borrowSubmitting: false,
  isVerified: false,
  setIsVerified: () => {},
  ready: false,
};

const LenderContext = React.createContext<LenderContextValue | null>(null);

// Helper to log client messages to a backend endpoint
function postClientLog(
  level: 'log' | 'warn' | 'error',
  msg: string,
  extra?: Record<string, unknown>,
) {
  try {
    fetch('/__client-log', {
      method: 'POST',
      body: JSON.stringify({
        level,
        msg,
        tag: 'LenderProvider',
        path: typeof window !== 'undefined' ? window.location.pathname : '',
        ua: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        time: Date.now(),
        ...extra,
      }),
    }).catch(() => {});
  } catch { /* intentionally empty */ }
}

/**
 * Wrapper: mientras Contracts no está listo, devolvemos DEFAULT_VALUE
 * para que los consumidores no crasheen. Cuando `ready` es true,
 * montamos el provider real que usa hooks on-chain.
 */
export function LenderProvider({ children }: { children: React.ReactNode }) {
  const { ready } = useContracts();

  if (!ready) {
    return (
      <LenderContext.Provider value={DEFAULT_VALUE}>
        {children}
      </LenderContext.Provider>
    );
  }
  return <LenderProviderReady>{children}</LenderProviderReady>;
}

/** Provider real: sólo se monta cuando Contracts.ready === true */
function LenderProviderReady({ children }: { children: React.ReactNode }) {
  const { mode, connectedAddress } = useContracts();

  const wallet = React.useMemo(
    () => (connectedAddress ?? '').toLowerCase(),
    [connectedAddress],
  );
  const isLoggedIn = React.useMemo(
    () => (mode === 'lemon' ? true : !!wallet),
    [mode, wallet],
  );

  // --- On-chain reads (lender / senior) ---
  const { display: seniorExchangeRateDisplay } = useSeniorExchangeRate();
  const { displayAPY: seniorApyDisplay } = useSeniorYield();
  const { display: susdcDisplay } = useVaultShares();
  const { display: seniorWithdrawAvailableDisplay } = useSeniorAvailableToWithdraw();

  // Campos de “borrow / score” ya no se leen on-chain acá.
  // Los dejamos en '—' para no romper consumidores que todavía los usen.
  const creditScoreDisplay = '—';
  const creditLimitDisplay = '—/—';
  const borrowedDisplay = '—';

  const maxBorrowDisplay = '—';
  const borrowSubmit = React.useCallback<BorrowSubmitFn>(
    async () => false,
    [],
  );
  const borrowSubmitting = false;

  // --- Backend verification (tolerante a fallos, con logging) ---
  const [isVerified, setIsVerified] = React.useState(false);
  const [userReady, setUserReady] = React.useState(false);

  React.useEffect(() => {
    let alive = true;

    const run = async () => {
      setUserReady(false);

      try {
        if (!isLoggedIn) {
          if (!alive) return;
          setIsVerified(false);
          setUserReady(true);
          return;
        }

        const addr = wallet || 'lemon-user';
        const url = `${BACKEND_URL}/user/${addr}`;

        const res = await fetch(url);
        if (!alive) return;

        if (!res.ok) {
          setIsVerified(false);
          postClientLog('warn', 'backend user check not ok', {
            status: res.status,
            url,
          });
          setUserReady(true);
          return;
        }

        const data: Pick<UserJourneyResponse, 'isVerified'> = await res.json();
        if (!alive) return;

        setIsVerified(Boolean(data?.isVerified));
        setUserReady(true);
      } catch (e: unknown) {
        if (!alive) return;
        setIsVerified(false);
        postClientLog('error', 'backend user check failed', {
          err: String(e?.message || e),
        });
        setUserReady(true);
      }
    };

    void run();
    return () => {
      alive = false;
    };
  }, [isLoggedIn, wallet]);

  const value = React.useMemo<LenderContextValue>(
    () => ({
      creditScoreDisplay,
      creditLimitDisplay,
      borrowedDisplay,
      seniorExchangeRateDisplay,
      seniorApyDisplay,
      susdcDisplay,
      seniorWithdrawAvailableDisplay,
      maxBorrowDisplay,
      borrowSubmit,
      borrowSubmitting,
      isVerified,
      setIsVerified,
      ready: userReady,
    }),
    [
      creditScoreDisplay,
      creditLimitDisplay,
      borrowedDisplay,
      seniorExchangeRateDisplay,
      seniorApyDisplay,
      susdcDisplay,
      seniorWithdrawAvailableDisplay,
      maxBorrowDisplay,
      borrowSubmit,
      borrowSubmitting,
      isVerified,
      userReady,
    ],
  );

  return <LenderContext.Provider value={value}>{children}</LenderContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useLender() {
  const ctx = React.useContext(LenderContext);
  if (!ctx) throw new Error('useLender must be used within <LenderProvider>.');
  return ctx;
}
