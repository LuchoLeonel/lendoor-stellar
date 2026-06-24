/**
 * Links the analytics session to the connected wallet address.
 * Call this hook inside any component that has access to the wallet.
 * It sends the wallet to the analytics backend once per session.
 */

import { useEffect } from 'react';
import { useAnalyticsSession } from '@/providers/AnalyticsProvider';
import { useContracts } from '@/providers/ContractsProvider';

export function useAnalyticsWallet() {
  const { setWallet } = useAnalyticsSession();
  const { connectedAddress } = useContracts();

  useEffect(() => {
    if (connectedAddress) {
      setWallet(connectedAddress);
    }
  }, [connectedAddress, setWallet]);
}
