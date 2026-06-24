import { useCallback } from "react";
import {
  authenticate as lemonAuthenticate,
  ChainId as LemonChainId,
  ClaimKey as LemonClaimKey,
  TransactionResult as LemonTxResult,
} from "@lemoncash/mini-app-sdk";
import { useAccount, useSignMessage } from "wagmi";
import { dedupeToast as toast } from "@/lib/dedupeToast";

import { BACKEND_URL } from "@/lib/constants";
import { useWallet } from "@/providers/WalletProvider";
import { useTranslation } from "@/i18n/useTranslation";
import { useAuthStore } from "@/stores/authStore";
import { lendoorApi } from "@/lib/api";
import type { GetNonceResponse, VerifySiweResponse } from "@shared/types/api";

// Spec 044 — request the 6 identity claims on every Lemon SIWE so backend
// can persist them as risk-model features. Mirrors LEMON_IDENTITY_CLAIMS in
// ContractsProvider; kept in sync manually because both hooks live in the
// frontend tier without a shared module.
const LEMON_IDENTITY_CLAIMS = [
  LemonClaimKey.NAME,
  LemonClaimKey.LAST_NAME,
  LemonClaimKey.EMAIL,
  LemonClaimKey.IS_PEP,
  LemonClaimKey.LEMONTAG,
  LemonClaimKey.OPERATION_COUNTRY,
];

function parseLemonClaims(
  grantedClaims: ReadonlyArray<{ key: string; value: string }> | undefined,
): {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  lemonTag: string | null;
  pep: boolean | null;
  lemonCountry: string | null;
} {
  const out = {
    firstName: null as string | null,
    lastName: null as string | null,
    email: null as string | null,
    lemonTag: null as string | null,
    pep: null as boolean | null,
    lemonCountry: null as string | null,
  };
  if (!grantedClaims) return out;
  for (const c of grantedClaims) {
    switch (c.key) {
      case "NAME":
        out.firstName = c.value || null;
        break;
      case "LAST_NAME":
        out.lastName = c.value || null;
        break;
      case "EMAIL":
        out.email = c.value || null;
        break;
      case "IS_PEP":
        out.pep =
          c.value === "true" || c.value === "1"
            ? true
            : c.value === "false" || c.value === "0"
              ? false
              : null;
        break;
      case "LEMONTAG":
        out.lemonTag = c.value || null;
        break;
      case "OPERATION_COUNTRY":
        out.lemonCountry = c.value || null;
        break;
    }
  }
  return out;
}

function parseLemonChainId(): number {
  const raw = (import.meta.env.VITE_LEMON_CHAIN_ID as string | undefined)?.trim();
  if (!raw) return LemonChainId.CELO;
  const n = Number(raw);
  return Number.isFinite(n) ? n : LemonChainId.CELO;
}

function buildSiweMessage(
  address: string,
  chainId: number,
  nonce: string,
): string {
  const domain =
    typeof window !== "undefined" ? window.location.host : "localhost";
  const uri =
    typeof window !== "undefined"
      ? window.location.origin
      : "http://localhost:3000";
  const issuedAt = new Date().toISOString();
  const statement = "Sign in to Lendoor";

  return `${domain} wants you to sign in with your Ethereum account:
${address}

${statement}

URI: ${uri}
Version: 1
Chain ID: ${chainId}
Nonce: ${nonce}
Issued At: ${issuedAt}`;
}

export function useRefreshAccessToken(): () => Promise<string | null> {
  const { address: wagmiAddress, chainId: wagmiChainId, status: wagmiStatus } =
    useAccount();
  const { signMessageAsync } = useSignMessage();
  const { mode } = useWallet();
  const { t } = useTranslation();
  const { setAccessToken, setAuthLoading } = useAuthStore();

  return useCallback(async (): Promise<string | null> => {
    setAuthLoading(true);
    try {
      // Try silent refresh first (no user interaction needed)
      const currentToken =
        typeof window !== "undefined"
          ? localStorage.getItem("lendoor:accessToken")
          : null;

      if (currentToken) {
        try {
          const refreshRes = await fetch(`${BACKEND_URL}/auth/refresh`, {
            method: "POST",
            headers: { Authorization: `Bearer ${currentToken}` },
          });
          if (refreshRes.ok) {
            const data = await refreshRes.json();
            setAccessToken(data.accessToken);
            try { localStorage.setItem("lendoor:tokenWallet", data.wallet.toLowerCase()); } catch { /* */ }
            return data.accessToken;
          }
        } catch {
          // Silent refresh failed, fall through to full SIWE
        }
      }

      // 1) MINI-APP LEMON
      if (mode === "lemon") {
        console.log("[RefreshAccessToken] Using Lemon SIWE flow");
        const lemonChainId = parseLemonChainId();

        const nonceRes = await fetch(`${BACKEND_URL}/auth/nonce`, {
          method: "POST",
        });
        if (!nonceRes.ok) {
          const txt = await nonceRes.text().catch(() => "");
          throw new Error(
            txt || `Error al pedir nonce (HTTP ${nonceRes.status})`,
          );
        }
        const { nonce } = (await nonceRes.json()) as GetNonceResponse;

        const res = await lemonAuthenticate({
          nonce,
          chainId: lemonChainId,
          // Spec 044 — request identity claims on every SIWE refresh so the
          // backend can persist them. This is the most common code path in
          // production (token refresh ~every 24h) so it's the main lever
          // for the passive backfill.
          requirements: { claims: LEMON_IDENTITY_CLAIMS },
        } as Record<string, unknown>);

        if (
          !res ||
          res.result !== LemonTxResult.SUCCESS ||
          !(res as unknown as Record<string, unknown>).data
        ) {
          throw new Error("Lemon SIWE falló o fue cancelado");
        }

        const { wallet, signature, message, grantedClaims } = (res as unknown as Record<string, unknown>).data as {
          wallet: string;
          signature: `0x${string}`;
          message: string;
          grantedClaims?: Array<{ key: string; value: string }>;
        };

        const verifyRes = await fetch(`${BACKEND_URL}/auth/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wallet, signature, message, nonce }),
        });

        if (!verifyRes.ok) {
          const txt = await verifyRes.text().catch(() => "");
          throw new Error(
            txt || `Error /auth/verify (HTTP ${verifyRes.status})`,
          );
        }

        const data = (await verifyRes.json()) as VerifySiweResponse;

        setAccessToken(data.accessToken);
        try { localStorage.setItem("lendoor:tokenWallet", wallet.toLowerCase()); } catch { /* */ }
        console.log("[RefreshAccessToken] Lemon SIWE success");

        // Spec 044 — fire-and-forget persist of identity claims. Now that
        // the access token is set in localStorage, lendoorApi will pick it
        // up automatically via fetchWithAuthRetry. Failure here MUST NOT
        // block the auth flow — risk persistence is best-effort.
        if (grantedClaims?.length) {
          const parsed = parseLemonClaims(grantedClaims);
          void lendoorApi
            .lemonProfile({
              walletAddress: wallet.toLowerCase(),
              ...parsed,
            })
            .catch((e) => {
              console.warn("[RefreshAccessToken] lemon-profile persist failed:", e);
            });
        }

        return data.accessToken;
      }

      // 2) WEB / FARCASTER via wagmi
      if (wagmiStatus === "connected" && wagmiAddress && wagmiChainId) {
        console.log("[RefreshAccessToken] Using wagmi SIWE flow");

        const nonceRes = await fetch(`${BACKEND_URL}/auth/nonce`, {
          method: "POST",
        });
        if (!nonceRes.ok) {
          const txt = await nonceRes.text().catch(() => "");
          throw new Error(
            txt || `Error al pedir nonce (HTTP ${nonceRes.status})`,
          );
        }
        const { nonce } = (await nonceRes.json()) as GetNonceResponse;

        const message = buildSiweMessage(wagmiAddress, wagmiChainId, nonce);

        const signature = await signMessageAsync({
          message,
          account: wagmiAddress as `0x${string}`,
        });

        const verifyRes = await fetch(`${BACKEND_URL}/auth/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            wallet: wagmiAddress,
            signature,
            message,
            nonce,
          }),
        });

        if (!verifyRes.ok) {
          const txt = await verifyRes.text().catch(() => "");
          throw new Error(
            txt || `Error /auth/verify (HTTP ${verifyRes.status})`,
          );
        }

        const data = (await verifyRes.json()) as VerifySiweResponse;

        setAccessToken(data.accessToken);
        try { localStorage.setItem("lendoor:tokenWallet", wagmiAddress.toLowerCase()); } catch { /* */ }
        console.log("[RefreshAccessToken] wagmi SIWE success");
        return data.accessToken;
      }

      // 3) wagmi not connected — user needs to connect via RainbowKit first
      console.log("[RefreshAccessToken] No wallet connected via wagmi", { wagmiStatus });
      return null;
    } catch (e: unknown) {
      console.error("[RefreshAccessToken] failed", e);
      setAccessToken(null);

      // Show toast so web users know auth failed (not just silent null)
      const msg = e?.shortMessage || e?.message || "Authentication failed";
      const isUserRejection =
        msg.toLowerCase().includes("user rejected") ||
        msg.toLowerCase().includes("user denied") ||
        msg.toLowerCase().includes("user cancelled") ||
        e?.code === 4001;

      if (isUserRejection) {
        toast.info(t("common.auth.signInCancelled"));
      } else {
        toast.error(t("common.auth.signInFailed"));
      }

      return null;
    } finally {
      setAuthLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, wagmiStatus, wagmiAddress, wagmiChainId, signMessageAsync, setAccessToken, setAuthLoading]);
}
