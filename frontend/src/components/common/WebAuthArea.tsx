'use client';

import * as React from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useWallet } from '@/providers/WalletProvider';

/**
 * Web-only auth area usando RainbowKit + wagmi.
 * Nunca se renderiza en Lemon (mini-app).
 */
export default function WebAuthArea({ mounted }: { mounted: boolean }) {
  const { sdkHasLoaded, isMiniApp } = useWallet();

  // Por si acaso, no mostrar nada en Lemon
  if (isMiniApp) return null;

  const authKnown = mounted && sdkHasLoaded;

  if (!authKnown) {
    return <div className="h-10 w-28 rounded-xl bg-muted/50 animate-pulse" />;
  }

  return (
    <div className="flex items-center justify-center gap-2">
      <ConnectButton
        chainStatus="icon"
        accountStatus="address"
        showBalance={false}
      />
    </div>
  );
}
