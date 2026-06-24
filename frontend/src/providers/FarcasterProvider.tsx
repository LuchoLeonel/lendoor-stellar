// src/providers/FarcasterProvider.tsx
"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  type PropsWithChildren,
} from "react";
import { sdk } from "@farcaster/miniapp-sdk";
import { isWebView as lemonIsWebView } from "@lemoncash/mini-app-sdk";

export type FarcasterState = {
  isMiniApp: boolean;
  isReady: boolean;
  fid?: number;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
  authToken?: string;
};

const initialState: FarcasterState = {
  isMiniApp: false,
  isReady: false,
};

const FarcasterContext = createContext<FarcasterState>(initialState);

// eslint-disable-next-line react-refresh/only-export-components
export const useFarcaster = () => useContext(FarcasterContext);

export function FarcasterProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<FarcasterState>(initialState);

  useEffect(() => {
    if (typeof window === "undefined") {
      setState({ isMiniApp: false, isReady: true });
      return;
    }

    // Si estamos dentro del WebView de Lemon, no tocamos el SDK de Farcaster.
    // Sus llamadas usan Comlink/postMessage y Lemon, al no reconocerlas,
    // dispara su modal de "actualizar app".
    let inLemon = false;
    try {
      inLemon = lemonIsWebView() === true;
    } catch {
      inLemon = false;
    }
    if (inLemon) {
      setState({ isMiniApp: false, isReady: true });
      return;
    }

    let cancelled = false;

    const init = async () => {
      try {
        const inMiniApp = await sdk.isInMiniApp?.();
        console.log("[Farcaster] isInMiniApp:", inMiniApp);

        if (!inMiniApp) {
          if (!cancelled) {
            setState({ isMiniApp: false, isReady: true });
          }
          return;
        }

        const ctx = (await sdk.context) as Record<string, unknown> | undefined;
        const user = ctx?.user as Record<string, unknown> | undefined;

        let authToken: string | undefined;
        try {
          const tokenResult: unknown = await sdk.quickAuth?.getToken?.();
          if (
            tokenResult &&
            typeof tokenResult === "object" &&
            "token" in tokenResult
          ) {
            authToken = tokenResult.token as string;
          }
        } catch (e) {
          console.warn("[Farcaster] quickAuth.getToken falló (no grave):", e);
        }

        try {
          await sdk.actions.ready();
          console.log("[Farcaster] sdk.actions.ready() OK");
        } catch (e) {
          console.warn("[Farcaster] sdk.actions.ready() falló:", e);
        }

        if (!cancelled) {
          setState({
            isMiniApp: true,
            isReady: true,
            fid: user?.fid,
            username: user?.username,
            displayName: user?.displayName,
            avatarUrl: user?.pfpUrl || user?.pfp?.url,
            authToken,
          });
        }
      } catch (err) {
        console.error("[Farcaster] error inicializando MiniApp:", err);
        if (!cancelled) {
          setState({ isMiniApp: false, isReady: true });
        }
      }
    };

    void init();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <FarcasterContext.Provider value={state}>
      {children}
    </FarcasterContext.Provider>
  );
}