// src/providers/ContractsProvider.tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Contract,
  JsonRpcProvider,
  ethers,
} from "ethers";
import { useWalletClient } from "wagmi";
import { encodeFunctionData } from "viem";
import { dedupeToast as toast } from "@/lib/dedupeToast";
import {
  authenticate as lemonAuthenticate,
  deposit as lemonDeposit,
  callSmartContract as lemonCallSmartContract,
  ChainId as LemonChainId,
  ClaimKey as LemonClaimKey,
  TransactionResult as LemonTxResult,
} from "@lemoncash/mini-app-sdk";

import { useWallet, type WalletMode } from "@/providers/WalletProvider";
import { useTranslation } from "@/i18n/useTranslation";
import { logLemonOutcome } from "@/lib/lemonErrorLog";
import { lendoorApi } from "@/lib/api";

// Spec 044 — full set of identity claims requested from Lemon at every
// authenticate(). The user grants them once and Lemon caches consent;
// subsequent calls return the cached values silently. We persist the
// payload to the backend (POST /user/lemon-profile) so it's available as
// risk-model features (spec 044 Phase C retraining).
const LEMON_IDENTITY_CLAIMS = [
  LemonClaimKey.NAME,
  LemonClaimKey.LAST_NAME,
  LemonClaimKey.EMAIL,
  LemonClaimKey.IS_PEP,
  LemonClaimKey.LEMONTAG,
  LemonClaimKey.OPERATION_COUNTRY,
];

/**
 * Spec 044 — parse the `grantedClaims` array from Lemon's authenticate
 * response into a flat payload the backend understands. Each claim is
 * `{ key: ClaimKey, value: string }`. Unknown / missing claims are left
 * `null` so the backend can distinguish "not asked" from "asked + denied".
 */
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

// ABIs
import IEVault from "@/contracts/IEVault.json";
import IEVC from "@/contracts/IEVC.json";
import {
  USDC_ADDRESS,
  EVAULT_ADDRESS,
  EVAULT_JUNIOR_ADDRESS,
  EVAULT_CONTROLLER_ADDRESS,
  DEFAULT_CELO_RPCS,
  EXPECTED_CHAIN_ID,
} from "@/lib/constants";

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function transfer(address,uint256) returns (bool)",
  "function transferFrom(address,address,uint256) returns (bool)",
];

export type TxInputs = {
  contractAddress: `0x${string}`;
  abi?: any;
  functionName: string;
  functionParams?: Array<string | number | bigint>;
  value?: string | number | bigint;
  chainId?: number;
  contractStandard?: string;
  permits?: any[];

  // Opcionales para title/description en la UI de Lemon
  titleValues?: Record<string, string>;
  descriptionValues?: Record<string, string>;
};

export type LemonHelpers = {
  deposit: (amount: string, tokenName: string) => Promise<string>;
  call: (i: TxInputs) => Promise<string>;
  callBatch: (items: TxInputs[]) => Promise<string[]>;
  requestSiwe: (
    nonce?: string,
    chainIdOverride?: number,
  ) => Promise<{ wallet: string; signature: string; message: string } | null>;
};

export type ContractsContextType = {
  ready: boolean;

  /** Modo global (refleja lo que diga WalletProvider) */
  mode: WalletMode;

  /** true si estamos corriendo dentro de una mini-app (Lemon o Farcaster) */
  isWebView: boolean;

  evault: Contract | null;
  evaultAddress: `0x${string}` | null;
  evaultJunior: Contract | null;
  evaultJuniorAddress: `0x${string}` | null;
  controller: Contract | null;
  controllerAddress: `0x${string}` | null;
  usdc: Contract | null;
  usdcAddress: `0x${string}` | null;
  usdcDecimals: number | null;

  signer: ethers.Signer | null;
  connectedAddress: string | null;
  chainId: number | null;

  refresh: () => Promise<void>;
  disconnect: () => Promise<void>;
  sendContractTx: (t: TxInputs) => Promise<string>;
  sendBatchContractTx: (txs: TxInputs[]) => Promise<string[]>;
  lemon: LemonHelpers | null;
};

const ContractsContext = createContext<ContractsContextType | null>(null);

// ---------------- Helpers ----------------

function abiOf(mod: any): any {
  return mod?.abi ?? mod?.default?.abi ?? mod ?? [];
}

function parseLemonChainId(): number | null {
  const raw = (import.meta.env.VITE_LEMON_CHAIN_ID as string | undefined)?.trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function exposeError(tag: string, e: unknown) {
  const err = e as any;
  const msg = (err?.message as string | undefined) || String(e);
  (window as any).__LENDOOR_LAST_ERROR = { tag, msg, err, time: Date.now() };
  console.error(`[Lendoor:${tag}]`, err);
  return msg;
}

async function pickCeloReadProvider(
  urls: string[],
  timeoutMs = 2500,
): Promise<{ provider: JsonRpcProvider; url: string }> {
  const KEY = "lendoor:rpc:base:url";

  // Último RPC que funcionó, si existe
  const preferred =
    (typeof window !== "undefined" && localStorage.getItem(KEY)) || null;

  const list = Array.from(
    new Set(
      [
        preferred,
        ...(urls || []), // 👉 acá ya viene DEFAULT_CELO_RPCS desde constants
      ].filter(Boolean),
    ),
  ) as string[];

  if (!list.length) {
    throw new Error(
      "No hay RPC configurado. Revisá DEFAULT_CELO_RPCS (VITE_BASE_RPCS / VITE_RPC_URL / VITE_PUBLIC_RPC_URL).",
    );
  }

  console.log("[READ_RPC_PICK] candidate RPCs", list);

  for (const url of list) {
    try {
      const p = new JsonRpcProvider(url);

      // Chequeo básico de red con timeout
      await Promise.race([
        p.getNetwork(),
        new Promise((_r, rej) =>
          setTimeout(() => rej(new Error("RPC timeout")), timeoutMs),
        ),
      ]);

      const net = await p.getNetwork();

      if (Number(net.chainId) !== 42220) {
        console.warn("[READ_RPC_PICK] chainId incorrecto para", url, net.chainId);
        continue;
      }

      // Validamos que USDC exista en ese RPC
      if (USDC_ADDRESS) {
        const code = await Promise.race([
          p.getCode(USDC_ADDRESS),
          new Promise((_r, rej) =>
            setTimeout(() => rej(new Error("RPC code timeout")), timeoutMs),
          ),
        ]);
        if (!code || code === "0x") {
          console.warn("[READ_RPC_PICK] USDC no desplegado en", url);
          continue;
        }
      }

      if (typeof window !== "undefined") {
        localStorage.setItem(KEY, url);
      }

      console.info("[Lendoor] RPC de lectura seleccionado:", url);
      return { provider: p, url };
    } catch (e) {
      console.warn("[READ_RPC_PICK] fallo RPC", url, e);
      // probamos el siguiente
    }
  }

  throw new Error("No hay RPC de lectura disponible (todos fallaron)");
}


// ---------------- Provider ----------------

export function ContractsProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  // 👉 Modo global (lemon / farcaster / webapp / none)
  const { mode, isMiniApp, primaryWallet } = useWallet();

  // wagmi: walletClient para web + farcaster (conector farcasterMiniApp + injected)
  const { data: walletClient } = useWalletClient();

  const [ready, setReady] = useState(false);

  const [evault, setEVault] = useState<Contract | null>(null);
  const [evaultJunior, setEVaultJunior] = useState<Contract | null>(null);
  const [controller, setController] = useState<Contract | null>(null);
  const [usdc, setUSDC] = useState<Contract | null>(null);
  const [usdcDecimals, setUsdcDecimals] = useState<number | null>(null);
  const [signer, setSigner] = useState<ethers.Signer | null>(null);
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);

  const aliveRef = useRef(true);
  const initializedRef = useRef(false);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const disconnect = useCallback(async () => {
    setEVault(null);
    setEVaultJunior(null);
    setController(null);
    setUSDC(null);
    setUsdcDecimals(null);
    setSigner(null);
    setConnectedAddress(null);
    setChainId(null);
  }, []);

  const build = useCallback(async () => {
    if (!initializedRef.current) {
      setReady(false);
    }
    const stillAlive = () => aliveRef.current;

    try {
      // 0) Read provider RESILIENTE
      let readProvider: JsonRpcProvider | null = null;
      let readUrl = "";
      try {
        const picked = await pickCeloReadProvider(DEFAULT_CELO_RPCS, 2600);
        readProvider = picked.provider;
        readUrl = picked.url;
      } catch (e) {
        exposeError("READ_RPC_PICK", e);
        toast.error(t("common.connectionError"));
      }

      // ===================== MINI-APP LEMON =====================
      if (mode === "lemon") {
        const envOverride = parseLemonChainId();
        const defaultLemonChain = envOverride ?? LemonChainId.CELO;

        let selectedChainId = defaultLemonChain;
        let walletLower: string | null = null;

        try {
          // Spec 044 hotfix — claims require user interaction (popup), so the
          // 3.5s safety timeout that worked for silent re-auth is too short
          // for first-time auth when user must read + approve the consent
          // dialog. Bump to 60s to cover real human interaction time.
          const res = await Promise.race([
            lemonAuthenticate({
              chainId: defaultLemonChain,
              requirements: { claims: LEMON_IDENTITY_CLAIMS },
            } as any),
            new Promise<null>((resolve) =>
              setTimeout(() => resolve(null), 60_000),
            ),
          ]);

          const data: any = res && (res as any).data;
          const wallet = data?.wallet;
          const sdkChainId =
            (typeof data?.chainId === "number" && data.chainId) ||
            (typeof data?.network?.chainId === "number" &&
              data.network.chainId) ||
            (typeof data?.chain?.id === "number" && data.chain.id) ||
            null;

          if (sdkChainId) selectedChainId = sdkChainId;
          walletLower = wallet ? String(wallet).toLowerCase() : null;

          // Spec 044 — persist granted claims to backend (fire-and-forget;
          // never block auth flow on this).
          if (walletLower && data?.grantedClaims?.length) {
            const parsed = parseLemonClaims(data.grantedClaims);
            void lendoorApi
              .lemonProfile({
                walletAddress: walletLower,
                ...parsed,
              })
              .catch((e: unknown) => exposeError("LEMON_PROFILE_PERSIST", e));
          }
        } catch (e) {
          exposeError("LEMON_AUTH", e);
        }

        if (stillAlive()) {
          setConnectedAddress(walletLower);
          setChainId(selectedChainId);
        }

        const ieVaultAbi = abiOf(IEVault);
        const ctrlAbi = abiOf(IEVC);

        setEVault(
          EVAULT_ADDRESS && readProvider
            ? new Contract(EVAULT_ADDRESS, ieVaultAbi, readProvider)
            : null,
        );
        setEVaultJunior(
          EVAULT_JUNIOR_ADDRESS && readProvider
            ? new Contract(EVAULT_JUNIOR_ADDRESS, ieVaultAbi, readProvider)
            : null,
        );
        setController(
          EVAULT_CONTROLLER_ADDRESS && readProvider
            ? new Contract(EVAULT_CONTROLLER_ADDRESS, ctrlAbi, readProvider)
            : null,
        );

        if (USDC_ADDRESS && readProvider) {
          try {
            const cUsdc = new Contract(USDC_ADDRESS, ERC20_ABI, readProvider);
            setUSDC(cUsdc);
            const dec = 6;
            if (stillAlive())
              setUsdcDecimals(Number.isFinite(dec) ? dec : null);
          } catch (e) {
            exposeError("USDC_WEBVIEW", e);
            if (stillAlive()) {
              setUSDC(null);
              setUsdcDecimals(null);
            }
            toast.error(t("common.setupError"));
          }
        } else {
          if (stillAlive()) {
            setUSDC(null);
            setUsdcDecimals(null);
          }
        }

        if (!readProvider) {
          toast.error(t("common.connectionError"));
        } else {
          console.info("[Lendoor] Read RPC (MiniApp Lemon) =", readUrl);
        }

        if (stillAlive()) {
          setSigner(null); // en mini-app Lemon, writes van por el SDK
          initializedRef.current = true;
          setReady(true);
        }
        return;
      }

      // ===================== WEB / FARCASTER (wagmi) =====================

      const ieVaultAbi = abiOf(IEVault);
      const ctrlAbi = abiOf(IEVC);

      setEVault(
        EVAULT_ADDRESS && readProvider
          ? new Contract(EVAULT_ADDRESS, ieVaultAbi, readProvider)
          : null,
      );
      setEVaultJunior(
        EVAULT_JUNIOR_ADDRESS && readProvider
          ? new Contract(EVAULT_JUNIOR_ADDRESS, ieVaultAbi, readProvider)
          : null,
      );
      setController(
        EVAULT_CONTROLLER_ADDRESS && readProvider
          ? new Contract(EVAULT_CONTROLLER_ADDRESS, ctrlAbi, readProvider)
          : null,
      );

      if (USDC_ADDRESS && readProvider) {
        try {
          const cUsdc = new Contract(USDC_ADDRESS, ERC20_ABI, readProvider);
          setUSDC(cUsdc);
          setUsdcDecimals(6);
        } catch (e) {
          exposeError("USDC_WEB", e);
          setUSDC(null);
          setUsdcDecimals(null);
          toast.error(t("common.setupError"));
        }
      } else {
        setUSDC(null);
        setUsdcDecimals(null);
      }

      if (!readProvider) {
        toast.error(t("common.connectionError"));
      } else {
        console.info("[Lendoor] Read RPC (Browser / Farcaster) =", readUrl);
      }

      // 👉 acá NO armamos un ethers.Signer desde walletClient.
      // Solo usamos walletClient directamente en sendContractTx.
      let addr: string | null = null;
      let chainIdLocal: number | null = null;

      if (walletClient && walletClient.account) {
        // 1) Caso ideal: usar walletClient (RainbowKit / Farcaster)
        addr = walletClient.account.address.toLowerCase();
        chainIdLocal =
          typeof walletClient.chain?.id === "number"
            ? walletClient.chain.id
            : null;

        console.info("[Lendoor] walletClient (web/farcaster)", {
          addr,
          chainId: chainIdLocal,
          mode,
        });
      } else if (primaryWallet?.address) {
        // 2) Fallback: usar lo que expone WalletProvider (useAccount de wagmi)
        addr = primaryWallet.address.toLowerCase();
        chainIdLocal = primaryWallet.chainId ?? null;

        console.info("[Lendoor] using primaryWallet from WalletProvider", {
          addr,
          chainId: chainIdLocal,
          mode,
        });
      } else {
        // 3) Sin wallet → modo solo lectura
        console.info(
          "[Lendoor] No walletClient / primaryWallet (read-only)",
          { mode },
        );
      }

      if (stillAlive()) {
        setSigner(null); // no usamos ethers signer en web/farcaster
        setConnectedAddress(addr);
        setChainId(chainIdLocal);
      }

      initializedRef.current = true;
      setReady(true);
    } catch (e) {
      exposeError("INIT", e);
      toast.error(t("common.initError"));
      await disconnect();
      initializedRef.current = true;
      setReady(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, walletClient, disconnect]);

  useEffect(() => {
    void build();
  }, [build]);

  // ================== SEND CONTRACT TX ==================
  const sendContractTx = useCallback<ContractsContextType["sendContractTx"]>(
    async ({
      contractAddress,
      abi,
      functionName,
      functionParams = [],
      value = 0,
      chainId: chainIdOverride,
      contractStandard,
      permits,
      titleValues,
      descriptionValues,
    }) => {
      // Normalizamos params: strings / numbers / bigint -> string
      const params = (functionParams || []).map((p: string | number | bigint) =>
        typeof p === "bigint" ? p.toString() : typeof p === "number" ? String(p) : p,
      );
      const valueStr =
        typeof value === "bigint" ? value.toString() : String(value ?? 0);

      // --------- MiniApp (Lemon) ---------
      if (mode === "lemon") {
        const envOverride = parseLemonChainId();
        const defaultLemonChain = envOverride ?? LemonChainId.CELO;

        const chosenChainId = Number(
          chainIdOverride ?? chainId ?? defaultLemonChain,
        );

        // 👉 si el contrato es USDC, default a ERC20
        const usdcAddr = (USDC_ADDRESS ?? "").toLowerCase();
        const isUsdcContract =
          usdcAddr.length > 0 &&
          contractAddress.toLowerCase() === usdcAddr;

        const contractPayload: any = {
          contractAddress,
          functionName,
          functionParams: params,
          args: params,
          value: valueStr,
          contractStandard:
            contractStandard ?? (isUsdcContract ? "ERC20" : undefined),
          chainId: chosenChainId as any,
          permits,
        };

        const payload: any = { contracts: [contractPayload] };

        if (titleValues) payload.titleValues = titleValues;
        if (descriptionValues) payload.descriptionValues = descriptionValues;

        console.info(
          "[Lendoor:MiniApp Lemon] callSmartContract payload",
          payload,
        );

        const res = await lemonCallSmartContract(payload as any);

        console.info(
          "[Lendoor:MiniApp Lemon] callSmartContract result",
          res,
        );

        // Log EVERY Lemon outcome (success + error) to backend for observability.
        // Critical when the Lemon modal shows errors like "El recurso ya existe"
        // that never surface anywhere else in our stack.
        logLemonOutcome("callSmartContract", res as any, {
          wallet: connectedAddress,
          payload,
        });

        // Accept both SUCCESS and PENDING with txHash. PENDING means the op
        // is in the mempool with a tx hash assigned — rejecting it would push
        // the user to retry, but the Lemon SDK still has the same op pending,
        // which causes the next callSmartContract to fail with 409 "El recurso
        // ya existe". Treating PENDING as completed lets the tx mine normally.
        if (
          (res?.result === LemonTxResult.SUCCESS ||
            res?.result === LemonTxResult.PENDING) &&
          (res as any).data?.txHash
        ) {
          return (res as any).data.txHash as string;
        }
        if (res?.result === LemonTxResult.CANCELLED) {
          throw new Error("Transaction cancelled");
        }
        const errMsg =
          (res as any)?.error?.message ||
          (res as any)?.error?.code ||
          (res as any)?.error ||
          "Transaction failed";
        throw new Error(errMsg);
      }

      // --- modo web / farcaster → usamos wagmi walletClient + viem ---
      if (!walletClient || !walletClient.account) {
        console.error("[ContractsProvider] No walletClient / account", {
          mode,
          chainId,
          connectedAddress,
        });
        throw new Error(
          "No wallet connected. Conectá tu wallet para firmar la transacción.",
        );
      }

      const clientChainId = walletClient.chain?.id ?? null;
      if (
        typeof EXPECTED_CHAIN_ID === "number" &&
        clientChainId !== null &&
        clientChainId !== EXPECTED_CHAIN_ID
      ) {
        throw new Error(
          "Red equivocada: cambiá a la chain esperada para firmar.",
        );
      }

      const _abi = abi || [`function ${functionName}()`];
      let data: `0x${string}`;
      try {
        data = encodeFunctionData({
          abi: (_abi as any).abi ?? (_abi as any),
          functionName: functionName as any,
          args: params as any[],
        });
      } catch (e) {
        const msg = exposeError("ENCODE_FN_DATA", e);
        throw new Error(`No se pudo armar la transacción: ${msg}`);
      }

      try {
        console.info("[ContractsProvider] sendTransaction", {
          to: contractAddress,
          functionName,
          params,
          valueStr,
        });

        const hash = await (walletClient as any).sendTransaction({
          account: walletClient.account,
          to: contractAddress,
          data,
          value: BigInt(valueStr || "0"),
        });

        console.info("[ContractsProvider] tx hash =", hash);
        return hash as string;
      } catch (e) {
        const rawMsg = exposeError("TX_WALLETCLIENT", e);
        const err = e as any;
        const code = err?.code;
        const short = (err?.shortMessage || err?.message || rawMsg || "") as string;
        const text = `${short} ${rawMsg}`.toLowerCase();

        if (
          text.includes("insufficient funds") ||
          text.includes("insufficient balance") ||
          text.includes("funds for gas") ||
          text.includes("funds to cover gas") ||
          code === "INSUFFICIENT_FUNDS"
        ) {
          throw new Error(
            "No tenés suficiente CELO para pagar el gas de esta transacción. " +
              "Enviate un poco de CELO a esta wallet y volvé a intentar.",
          );
        }

        if (mode === "farcaster") {
          if (
            code === 4001 ||
            text.includes("user rejected") ||
            text.includes("user denied") ||
            text.includes("user rejected the request")
          ) {
            throw new Error(
              "La wallet de Farcaster frenó la transacción. " +
                "Muchas veces pasa cuando no hay CELO suficiente para pagar las fees " +
                "o cuando el escaneo de seguridad la bloquea. " +
                "Revisá que tengas CELO para gas y probá de nuevo.",
            );
          }

          if (
            text.includes("security") ||
            text.includes("scan") ||
            text.includes("malicious") ||
            text.includes("risk")
          ) {
            throw new Error(
              "La transacción fue frenada por el sistema de seguridad de la wallet. " +
                "Si creés que es un falso positivo, revisá los detalles en la app " +
                "y probá más tarde.",
            );
          }
        }

        throw new Error(short || rawMsg || "Tx failed");
      }
    },
    [mode, walletClient, chainId, connectedAddress],
  );


  // ================== SEND BATCH CONTRACT TX ==================
  const sendBatchContractTx = useCallback<
    ContractsContextType["sendBatchContractTx"]
  >(
    async (txs) => {
      if (!txs.length) return [];

      // ---- MiniApp Lemon: batch real con contracts: [...] ----
      if (mode === "lemon") {
        const envOverride = parseLemonChainId();
        const defaultLemonChain = envOverride ?? LemonChainId.CELO;
        const chosenChainId = Number(chainId ?? defaultLemonChain);

        const contracts = txs.map((t) => {
          const params = (t.functionParams || []).map((p: string | number | bigint) =>
            typeof p === "bigint" ? p.toString() : typeof p === "number" ? String(p) : p,
          );
          const valueStr =
            typeof t.value === "bigint"
              ? t.value.toString()
              : String(t.value ?? 0);

          // 👉 si este contrato es USDC, default a ERC20
          const usdcAddr = (USDC_ADDRESS ?? "").toLowerCase();
          const isUsdcContract =
            usdcAddr.length > 0 &&
            t.contractAddress.toLowerCase() === usdcAddr;

          const c: any = {
            contractAddress: t.contractAddress,
            functionName: t.functionName,
            functionParams: params,
            args: params,
            value: valueStr,
            contractStandard:
              t.contractStandard ?? (isUsdcContract ? "ERC20" : undefined),
            chainId: chosenChainId as any,
            permits: t.permits,
          };

          return c;
        });

        const payload: any = { contracts };

        console.info(
          "[Lendoor:MiniApp Lemon] batch callSmartContract payload",
          payload,
        );

        const res = await lemonCallSmartContract(payload as any);

        console.info(
          "[Lendoor:MiniApp Lemon] batch callSmartContract result",
          res,
        );

        logLemonOutcome("callSmartContract.batch", res as any, {
          wallet: connectedAddress,
          payload,
          extra: { batchSize: txs.length },
        });

        // Accept SUCCESS and PENDING (see note in sendContractTx — same reason).
        if (
          res?.result === LemonTxResult.SUCCESS ||
          res?.result === LemonTxResult.PENDING
        ) {
          const data: any = (res as any).data ?? {};
          if (data.txHash) return [data.txHash as string];
          return [];
        }
        if (res?.result === LemonTxResult.CANCELLED) {
          throw new Error("Transaction cancelled");
        }
        const errMsg =
          (res as any)?.error?.message ||
          (res as any)?.error?.code ||
          (res as any)?.error ||
          "Transaction failed";
        throw new Error(errMsg);
      }

      // ---- Web / Farcaster: correrlas una por una ----
      const hashes: string[] = [];
      for (const t of txs) {
        const h = await sendContractTx(t);
        hashes.push(h);
      }
      return hashes;
    },
    [mode, chainId, sendContractTx],
  );


  // ================== MiniApp helpers (Lemon) ==================
  const lemonHelpers = useMemo<LemonHelpers | null>(() => {
    if (mode !== "lemon") return null;
    return {
      deposit: async (amount: string, tokenName: string) => {
        const res = await lemonDeposit({ amount, tokenName } as any);
        logLemonOutcome("deposit", res as any, {
          wallet: connectedAddress,
          payload: { amount, tokenName },
        });
        // Accept SUCCESS and PENDING (Lemon SDK can return PENDING with a
        // valid txHash — see callSmartContract handler for the full reason).
        if (
          (res?.result === LemonTxResult.SUCCESS ||
            res?.result === LemonTxResult.PENDING) &&
          (res as any).data?.txHash
        )
          return (res as any).data.txHash as string;
        if (res?.result === LemonTxResult.CANCELLED)
          throw new Error("Deposit cancelled");
        const errMsg =
          (res as any)?.error ||
          (res as any)?.error?.message ||
          "Deposit failed";
        throw new Error(errMsg);
      },
      call: async (i) =>
        sendContractTx({
          contractAddress: i.contractAddress,
          abi: i.abi,
          functionName: i.functionName,
          functionParams: i.functionParams || [],
          value: i.value ?? 0,
          chainId: i.chainId,
          contractStandard: i.contractStandard,
          permits: i.permits,
          titleValues: i.titleValues,
          descriptionValues: i.descriptionValues,
        }),
      callBatch: async (items) => sendBatchContractTx(items),
      requestSiwe: async (nonce?: string, chainIdOverride?: number) => {
        const envOverride = parseLemonChainId();
        const defaultLemonChain = envOverride ?? LemonChainId.CELO;
        const chosenChainId = Number(
          chainIdOverride ?? chainId ?? defaultLemonChain,
        );
        const res = await lemonAuthenticate({
          nonce,
          chainId: chosenChainId,
          // Spec 044 — request claims on every re-auth too. Idempotent on
          // backend (POST /user/lemon-profile is upsert).
          requirements: { claims: LEMON_IDENTITY_CLAIMS },
        } as any);
        if (res?.result === LemonTxResult.SUCCESS && (res as any).data) {
          const { wallet, signature, message, grantedClaims } = (res as any)
            .data as any;
          // Persist claims fire-and-forget; SIWE flow continues regardless.
          if (wallet && grantedClaims?.length) {
            const walletLower = String(wallet).toLowerCase();
            const parsed = parseLemonClaims(grantedClaims);
            void lendoorApi
              .lemonProfile({ walletAddress: walletLower, ...parsed })
              .catch(() => {
                /* swallow — risk persist is best-effort */
              });
          }
          return { wallet, signature, message };
        }
        return null;
      },
    };
  }, [mode, chainId, sendContractTx, sendBatchContractTx]);

  const value: ContractsContextType = useMemo(
    () => ({
      ready,
      mode,
      isWebView: isMiniApp,
      evault,
      evaultAddress: (EVAULT_ADDRESS ?? null) as `0x${string}` | null,
      evaultJunior,
      evaultJuniorAddress: (EVAULT_JUNIOR_ADDRESS ??
        null) as `0x${string}` | null,
      controller,
      controllerAddress: (EVAULT_CONTROLLER_ADDRESS ??
        null) as `0x${string}` | null,
      usdc,
      usdcAddress: (USDC_ADDRESS ?? null) as `0x${string}` | null,
      usdcDecimals,
      signer,
      connectedAddress,
      chainId,
      refresh: build,
      disconnect,
      sendContractTx,
      sendBatchContractTx,
      lemon: lemonHelpers,
    }),
    [
      ready,
      mode,
      isMiniApp,
      evault,
      evaultJunior,
      controller,
      signer,
      connectedAddress,
      chainId,
      usdc,
      usdcDecimals,
      build,
      disconnect,
      sendContractTx,
      sendBatchContractTx,
      lemonHelpers,
    ],
  );

  return (
    <ContractsContext.Provider value={value}>
      {children}
    </ContractsContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useContracts() {
  const ctx = useContext(ContractsContext);
  if (!ctx)
    throw new Error("useContracts must be used within <ContractsProvider>");
  return ctx;
}
