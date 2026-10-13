'use client';

import * as React from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useWallet } from '@/providers/WalletProvider';
import { usePrivyStellar } from '@/providers/PrivyStellarProvider';

function shortAddress(address: string): string {
  return `${address.slice(0, 5)}...${address.slice(-5)}`;
}

/**
 * Web-only auth area usando RainbowKit + wagmi.
 * Nunca se renderiza en Lemon (mini-app).
 */
export default function WebAuthArea({ mounted }: { mounted: boolean }) {
  const {
    sdkHasLoaded,
    isMiniApp,
    loadingNetwork,
    mode,
    primaryWallet,
    setShowAuthFlow,
  } = useWallet();
  const { privyAddress, exportPrivyWallet } = usePrivyStellar();

  // Por si acaso, no mostrar nada en Lemon
  if (isMiniApp) return null;

  const authKnown = mounted && sdkHasLoaded;

  if (!authKnown) {
    return <div className="h-10 w-28 rounded-xl bg-muted/50 animate-pulse" />;
  }

  if (mode === 'stellar') {
    const address = primaryWallet?.address ?? null;
    const isPrivyWallet = !!address && address === privyAddress;
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={setShowAuthFlow}
          disabled={loadingNetwork}
          className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loadingNetwork
            ? 'Connecting...'
            : address
              ? `${isPrivyWallet ? 'Privy' : 'Freighter'} ${shortAddress(address)}`
              : 'Connect wallet'}
        </button>
        {isPrivyWallet ? (
          <button
            type="button"
            onClick={() => void exportPrivyWallet()}
            className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 shadow-sm transition hover:bg-slate-50"
            title="Copia la clave privada de tu wallet embebida desde el modal seguro de Privy"
          >
            Exportar clave
          </button>
        ) : null}
      </div>
    );
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
