// src/providers/WagmiProvider.tsx
"use client";

import React from "react";
import {
  WagmiProvider as WagmiRoot,
  createConfig,
  http,
} from "wagmi";
import { celo } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { farcasterMiniApp } from "@farcaster/miniapp-wagmi-connector";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lightTheme, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { isWebView as lemonIsWebView } from "@lemoncash/mini-app-sdk";
import { FarcasterProvider } from "@/providers/FarcasterProvider";

// Detect Lemon WebView at module load. When inside Lemon we must NOT
// register the Farcaster mini-app connector — its probe sends a Comlink
// `{ type: "GET", path: ["context"] }` postMessage that Lemon's WebView
// does not recognize and answers with an "Actualizar app" modal.
const IS_LEMON = (() => {
  try {
    return lemonIsWebView() === true;
  } catch {
    return false;
  }
})();

// Persist across HMR — prevents MetaMask popup on every hot reload
const wagmiConfig = /* @__PURE__ */ createConfig({
  chains: [celo],
  transports: {
    [celo.id]: http(),
  },
  connectors: IS_LEMON
    ? [injected()]
    : [farcasterMiniApp(), injected()],
});

// Keep query client stable across HMR
const queryClient = /* @__PURE__ */ new QueryClient({
  defaultOptions: {
    queries: {
      // Don't refetch on window focus (prevents re-triggering wallet calls)
      refetchOnWindowFocus: false,
    },
  },
});

export function WagmiProvider({ children }: { children: React.ReactNode }) {
  return (
    <WagmiRoot config={wagmiConfig} reconnectOnMount={false}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          locale={navigator.language?.startsWith("es") ? "es" : "en"}
          theme={lightTheme({
            accentColor: '#fb923c',
            accentColorForeground: '#ffffff',
          })}
        >
          <FarcasterProvider>{children}</FarcasterProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiRoot>
  );
}
