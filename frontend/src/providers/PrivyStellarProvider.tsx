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
  useExportWallet,
  useSignRawHash,
} from "@privy-io/react-auth/extended-chains";

import { makePrivyAuthMessageSigner, makePrivySigner } from "@/lib/privy-signer";
import { setActiveStellarSigner } from "@/lib/stellar-signer-registry";
import { ensureTestnetAccountReady } from "@/lib/stellar-account-activation";
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
  /**
   * Autocustodia (D1.2): abre el modal seguro de Privy para que el usuario
   * copie la clave privada de su wallet embebida. La clave vive en un iframe
   * de otro dominio — la app nunca la ve.
   */
  exportPrivyWallet: () => Promise<void>;
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
  exportPrivyWallet: async () => {
    console.warn("[PrivyStellar] export: provider not mounted");
  },
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
  const { exportWallet } = useExportWallet();
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
    const signRawHashForWallet = async (hashHex0x: string) => {
      const { signature } = await signRawHash({
        address: privyAddress,
        chainType: STELLAR_CHAIN_TYPE,
        hash: hashHex0x as `0x${string}`,
      });
      return signature;
    };
    const networkPassphrase =
      (import.meta.env.VITE_STELLAR_NETWORK_PASSPHRASE as string | undefined) ??
      "Test SDF Network ; September 2015";
    const signer = makePrivySigner({
      address: privyAddress,
      networkPassphrase,
      signRawHash: signRawHashForWallet,
    });
    const signPrivyAuthMessage = makePrivyAuthMessageSigner({
      signRawHash: signRawHashForWallet,
    });
    setActiveStellarSigner({
      kind: "privy",
      signTransaction: async (xdr, opts) =>
        (await signer.signTransaction(xdr, opts)).signedTxXdr,
      signAuthMessage: (message, opts) => {
        if (opts.address !== privyAddress) {
          return Promise.reject(
            new Error(
              `Privy signer holds ${privyAddress}; asked to sign auth for ${opts.address}`,
            ),
          );
        }
        return signPrivyAuthMessage(message);
      },
    });

    // Wallet recién creada: sin XLM ni trustline de USDC no puede pedir ni
    // recibir un préstamo. En testnet la dejamos operable acá (no-op en
    // mainnet y si ya está lista).
    let cancelled = false;
    void ensureTestnetAccountReady({
      address: privyAddress,
      networkPassphrase,
      signTransaction: async (xdr) =>
        (await signer.signTransaction(xdr, { networkPassphrase })).signedTxXdr,
    })
      .then((r) => {
        if (!cancelled && r.kind === "ready" && (r.funded || r.trustlineAdded)) {
          console.info("[PrivyStellar] wallet activada en testnet", r);
        }
      })
      .catch((err: unknown) => {
        console.error("[PrivyStellar] no se pudo activar la wallet en testnet", err);
      });

    return () => {
      cancelled = true;
      setActiveStellarSigner(null);
    };
  }, [privyAddress, signRawHash]);

  const value = React.useMemo<PrivyStellarContextType>(
    () => ({
      privyAddress,
      privyReady: ready,
      privyAuthenticated: authenticated,
      privyEnabled: true,
      loginWithPrivy: login,
      logoutPrivy: logout,
      exportPrivyWallet: async () => {
        if (!privyAddress) {
          throw new Error("No hay wallet de Privy en sesion para exportar");
        }
        await exportWallet({ address: privyAddress });
      },
    }),
    [privyAddress, ready, authenticated, login, logout, exportWallet],
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
