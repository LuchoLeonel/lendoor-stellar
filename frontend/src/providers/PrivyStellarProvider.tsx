// src/providers/PrivyStellarProvider.tsx
"use client";

/**
 * Privy al lado de Freighter (D1.2) — onboarding sin extensión.
 *
 * Monta el SDK de Privy SOLO en modo Stellar y solo si hay App ID; en
 * cualquier otro modo (Celo prod, Lemon, Farcaster) renderiza los children
 * tal cual y no cambia nada. Al autenticarse: se asegura de que el usuario
 * tenga una wallet Stellar embebida (la crea en el primer login), arma el
 * firmante con el puente probado (`makePrivySigner`) y lo registra como
 * firmante activo — los call sites de borrow/repay/deposit no se enteran.
 *
 * Gotchas manejados (documentados por pollar-xyz/pollar, mismo round SCF #45):
 * - el aprovisionamiento automático de wallets EVM/Solana va APAGADO
 *   (`createOnLogin: 'off'`): si no, cada login crea wallets que no usamos;
 * - `chainType: 'stellar'` NO está en la unión de tipos pública del SDK
 *   (compila casteado; verificado contra los .d.ts de la 3.48.0 instalada);
 * - los params `privy_oauth_*` que quedan en la URL tras el OAuth se limpian
 *   a mano.
 */
import * as React from "react";
import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import {
  useCreateWallet,
  useSignRawHash,
} from "@privy-io/react-auth/extended-chains";

import { makePrivySigner } from "@/lib/privy-signer";
import { setActiveStellarSigner } from "@/lib/stellar-signer-registry";
import { isStellarMode } from "@/lib/stellar-wallet";

const APP_ID = (import.meta.env.VITE_PRIVY_APP_ID as string | undefined)?.trim();

// 'stellar' es Tier 2: existe en runtime pero no en la unión de tipos pública.
const STELLAR_CHAIN_TYPE = "stellar" as never;

type PrivyStellarContextType = {
  /** G-address de la wallet Stellar embebida, o null si no hay sesión Privy. */
  privyAddress: string | null;
  privyReady: boolean;
  privyAuthenticated: boolean;
  privyEnabled: boolean;
  loginWithPrivy: () => void;
  logoutPrivy: () => Promise<void>;
};

const PrivyStellarContext = React.createContext<PrivyStellarContextType>({
  privyAddress: null,
  privyReady: false,
  privyAuthenticated: false,
  privyEnabled: false,
  loginWithPrivy: () => {
    console.warn("[PrivyStellar] provider not mounted (no app id / not stellar mode)");
  },
  logoutPrivy: async () => {},
});

// eslint-disable-next-line react-refresh/only-export-components
export const usePrivyStellar = () => React.useContext(PrivyStellarContext);

function findStellarWallet(user: ReturnType<typeof usePrivy>["user"]): string | null {
  const accounts = user?.linkedAccounts ?? [];
  for (const account of accounts) {
    if (
      account.type === "wallet" &&
      (account as { chainType?: string }).chainType === "stellar" &&
      typeof (account as { address?: string }).address === "string"
    ) {
      return (account as { address: string }).address;
    }
  }
  return null;
}

function cleanOauthParams() {
  try {
    const url = new URL(window.location.href);
    let dirty = false;
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith("privy_oauth_")) {
        url.searchParams.delete(key);
        dirty = true;
      }
    }
    if (dirty) window.history.replaceState({}, "", url.toString());
  } catch {
    /* no-op */
  }
}

function PrivyStellarBridge({ children }: React.PropsWithChildren) {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { createWallet } = useCreateWallet();
  const { signRawHash } = useSignRawHash();
  const [privyAddress, setPrivyAddress] = React.useState<string | null>(null);
  const creatingRef = React.useRef(false);

  // Al autenticar: asegurar la wallet Stellar (crearla en el primer login).
  React.useEffect(() => {
    if (!ready || !authenticated || !user) {
      setPrivyAddress(null);
      return;
    }
    cleanOauthParams();
    const existing = findStellarWallet(user);
    if (existing) {
      setPrivyAddress(existing);
      return;
    }
    if (creatingRef.current) return;
    creatingRef.current = true;
    void createWallet({ chainType: STELLAR_CHAIN_TYPE })
      .then((result: unknown) => {
        const address =
          (result as { wallet?: { address?: string } })?.wallet?.address ?? null;
        if (address) setPrivyAddress(address);
        else console.error("[PrivyStellar] createWallet sin address", result);
      })
      .catch((err: unknown) => {
        console.error("[PrivyStellar] createWallet error", err);
      })
      .finally(() => {
        creatingRef.current = false;
      });
  }, [ready, authenticated, user, createWallet]);

  // Registrar/desregistrar el firmante activo cuando cambia la sesión.
  React.useEffect(() => {
    if (!privyAddress) {
      setActiveStellarSigner(null); // vuelve Freighter
      return;
    }
    const signer = makePrivySigner({
      address: privyAddress,
      networkPassphrase:
        (import.meta.env.VITE_STELLAR_NETWORK_PASSPHRASE as string | undefined) ??
        "Test SDF Network ; September 2015",
      signRawHash: async (hashHex0x) => {
        const { signature } = await signRawHash({
          address: privyAddress,
          chainType: STELLAR_CHAIN_TYPE,
          hash: hashHex0x as `0x${string}`,
        });
        return signature;
      },
    });
    setActiveStellarSigner({
      kind: "privy",
      signTransaction: async (xdr, opts) =>
        (await signer.signTransaction(xdr, opts)).signedTxXdr,
    });
    return () => setActiveStellarSigner(null);
  }, [privyAddress, signRawHash]);

  const value = React.useMemo<PrivyStellarContextType>(
    () => ({
      privyAddress,
      privyReady: ready,
      privyAuthenticated: authenticated,
      privyEnabled: true,
      loginWithPrivy: login,
      logoutPrivy: logout,
    }),
    [privyAddress, ready, authenticated, login, logout],
  );

  return (
    <PrivyStellarContext.Provider value={value}>
      {children}
    </PrivyStellarContext.Provider>
  );
}

export function PrivyStellarProvider({ children }: React.PropsWithChildren) {
  // Fuera del modo Stellar, o sin App ID, este provider no existe: cero
  // impacto en Celo/Lemon/Farcaster, y el bundle EVM no carga el SDK en vano.
  if (!isStellarMode() || !APP_ID) {
    return <>{children}</>;
  }
  return (
    <PrivyProvider
      appId={APP_ID}
      config={{
        loginMethods: ["email", "google"],
        // Gotcha de Pollar: sin esto, cada login aprovisiona wallets
        // EVM/Solana que no usamos.
        embeddedWallets: {
          ethereum: { createOnLogin: "off" },
          solana: { createOnLogin: "off" },
        },
        appearance: { theme: "light" },
      }}
    >
      <PrivyStellarBridge>{children}</PrivyStellarBridge>
    </PrivyProvider>
  );
}
