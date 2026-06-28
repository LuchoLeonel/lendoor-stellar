"use client";

import * as React from "react";
import { parseUnits } from "ethers";
import { toast } from "sonner";

import { useTranslation } from "@/i18n/useTranslation";
import { useContracts } from "@/providers/ContractsProvider";
import { useCreditLine } from "@/hooks/borrow/blockchain/useCreditLine";
import { useBorrower } from "@/providers/BorrowerProvider";
import { useWallet } from "@/providers/WalletProvider";
import {
  DECIMALS,
  softWait,
  formatEvmError,
  transactionExplorerUrl,
} from "@/lib/utils";
import { safeRead } from "@/lib/safeRead";
import { useApi } from "@/hooks/useApi";
import { ApiError } from "@/lib/api";
import { retryWithBackoff } from "@/lib/retryWithBackoff";
import {
  addPendingOpen,
  removePendingOpen,
  updatePendingOpen,
} from "@/lib/loanOpenQueue";
import { stellarBorrowWithTerm } from "@/lib/stellar-contracts";
import { normalizeWalletAddress } from "@/lib/wallet-address";

import IEVault from "@/contracts/IEVault.json";
import * as IEVC from "@/contracts/IEVC.json";

type Options = {
  requireController?: boolean;
};

/** 1234567n -> "1,234,567" asumiendo d decimales */
function fmt0(n: bigint, d = 6) {
  const b = 10n ** BigInt(d);
  return (n / b).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function clean(s: string) {
  return s.replace(/[_,\s]/g, "");
}

function isNonRetryableStatus(err: unknown): boolean {
  return err instanceof ApiError && err.status >= 400 && err.status < 500;
}

function toastOptions(description: string, explorerUrl: string | null) {
  if (!explorerUrl) return { description };
  return {
    description,
    action: {
      label: "View tx",
      onClick: () => window.open(explorerUrl, "_blank", "noopener,noreferrer"),
    },
  };
}

// =========================
// DEBUG: CUSTOM ERROR DECODE
// =========================

// selector -> i18n key
const CUSTOM_ERROR_MAP: Record<string, string> = {
  "0x13790bf0": "hooks.useBorrow.errors.insufficientCash",
};

type DecodedCustomError =
  | { kind: "mapped"; key: string }
  | { kind: "unknown"; selector: string }
  | null;

function decodeCustomError(e: unknown): DecodedCustomError {
  const err = e as Record<string, unknown> | null | undefined;
  const info = err?.info as Record<string, unknown> | undefined;
  const rawData =
    err?.data ??
    (err?.error as Record<string, unknown> | undefined)?.data ??
    (info?.error as Record<string, unknown> | undefined)?.data ??
    info?.data ??
    null;

  if (
    typeof rawData === "string" &&
    rawData.startsWith("0x") &&
    rawData.length >= 10
  ) {
    const selector = rawData.slice(0, 10);
    const mappedKey = CUSTOM_ERROR_MAP[selector] || null;

    console.error("[useBorrow] custom error revert", {
      selector,
      mappedKey,
      rawData,
      code: err?.code,
      shortMessage: err?.shortMessage,
      reason: err?.reason,
    });

    if (mappedKey) return { kind: "mapped", key: mappedKey };
    return { kind: "unknown", selector };
  }

  console.error("[useBorrow] non-custom revert or no data", {
    code: err?.code,
    shortMessage: err?.shortMessage,
    reason: err?.reason,
  });

  return null;
}

// =========================
// HOOK PRINCIPAL
// =========================

export function useBorrow({ requireController = true }: Options = {}) {
  const { t } = useTranslation();

  const formatBorrowError = React.useCallback(
    (e: unknown): string => {
      const decoded = decodeCustomError(e);
      if (decoded?.kind === "mapped") return t(decoded.key);
      if (decoded?.kind === "unknown") {
        return t("hooks.useBorrow.errors.unknownCustom", {
          selector: decoded.selector,
        });
      }
      return formatEvmError(e);
    },
    [t],
  );

  const {
    evaultAddress,
    connectedAddress,
    sendContractTx,
    sendBatchContractTx,
    refresh,

    // 👇 necesarios para enableController
    controller,
    controllerAddress,
  } = useContracts();

  const { mode, primaryWallet, isLemonMiniApp } = useWallet();

  // address efectiva on-chain (web/Farcaster = primaryWallet, Lemon = connectedAddress)
  const userAddress: string | null =
    mode === "stellar"
      ? (primaryWallet?.address ?? null)
      : isLemonMiniApp
        ? (connectedAddress ?? primaryWallet?.address ?? null)
        : (primaryWallet?.address ?? connectedAddress ?? null);

  // address normalizada para backend / DB
  const walletAddress = normalizeWalletAddress(userAddress, mode);

  const { limitRaw, borrowedRaw } = useCreditLine({ pollMs: 15_000 });

  const { refreshLoanStats } = useBorrower();
  const api = useApi();

  const [submitting, setSubmitting] = React.useState(false);

  const maxBorrowRaw = React.useMemo(() => {
    if (limitRaw == null || borrowedRaw == null) return null;
    const cap = limitRaw - borrowedRaw;
    return cap > 0n ? cap : 0n;
  }, [limitRaw, borrowedRaw]);

  const maxBorrowDisplay = React.useMemo(
    () => (maxBorrowRaw == null ? "—" : `${fmt0(maxBorrowRaw, DECIMALS)} USDC`),
    [maxBorrowRaw],
  );

  const validateAmount = React.useCallback(
    (amountInput: string) => {
      const s = clean(amountInput || "");
      if (!s) {
        return {
          ok: false,
          reason: t("hooks.useBorrow.validation.enterAmount"),
        };
      }

      let amount: bigint;
      try {
        amount = parseUnits(s, DECIMALS);
      } catch {
        return {
          ok: false,
          reason: t("hooks.useBorrow.validation.invalidAmount"),
        };
      }

      if (amount <= 0n) {
        return {
          ok: false,
          reason: t("hooks.useBorrow.validation.greaterThanZero"),
        };
      }

      if (maxBorrowRaw != null && amount > maxBorrowRaw) {
        return {
          ok: false,
          reason: t("hooks.useBorrow.validation.exceedsCapacity"),
        };
      }

      return { ok: true as const, reason: null as null, amount };
    },
    [maxBorrowRaw, t],
  );

  const exceedsCapacity = React.useCallback(
    (s: string) => {
      try {
        return (
          maxBorrowRaw != null &&
          parseUnits(clean(s || "0"), DECIMALS) > maxBorrowRaw
        );
      } catch {
        return false;
      }
    },
    [maxBorrowRaw],
  );

  const submit = React.useCallback(
    async (
      amountInput: string,
      tenorDays: number,
      feeBps = 3000,
    ): Promise<boolean> => {
      if (
        !userAddress ||
        !walletAddress ||
        (mode !== "stellar" && !evaultAddress)
      ) {
        toast.error(t("hooks.useBorrow.toast.missingSetup.title"), {
          description: t("hooks.useBorrow.toast.missingSetup.desc"),
        });
        console.error("[useBorrow] missing setup", {
          evaultAddress,
          userAddress,
        });
        return false;
      }

      if (mode !== "stellar" && (!sendContractTx || !sendBatchContractTx)) {
        toast.error(t("hooks.useBorrow.toast.walletNotReady.title"), {
          description: t("hooks.useBorrow.toast.walletNotReady.desc"),
        });
        console.error(
          "[useBorrow] sendContractTx / sendBatchContractTx not available",
        );
        return false;
      }

      const { ok, reason, amount } = validateAmount(amountInput);
      if (!ok || !amount) {
        toast.error(t("hooks.useBorrow.toast.invalidAmount.title"), {
          description:
            reason || t("hooks.useBorrow.toast.invalidAmount.fallback"),
        });
        console.warn("[useBorrow] validateAmount failed", {
          amountInput,
          reason,
        });
        return false;
      }

      // string humano para el backend (mismo monto que mostró el usuario)
      const amountHumanForBackend = clean(amountInput || "");

      /** Returns true if backend sync succeeded, false otherwise */
      const informBackend = async (txHash: string | null): Promise<boolean> => {
        if (!walletAddress) return false;

        // 1) Enqueue before calling backend
        const pending = addPendingOpen({
          walletAddress,
          amountHuman: amountHumanForBackend,
          tenorDays,
          txHash,
        });

        try {
          console.log("[useBorrow] inform-open →", {
            wallet: walletAddress,
            amountHuman: amountHumanForBackend,
            tenorDays,
          });

          // 2) Retry with backoff — don't retry 4xx
          await retryWithBackoff(
            () =>
              api.informOpen({
                walletAddress,
                amountHuman: amountHumanForBackend,
                tenorDays,
                txHash: txHash ?? undefined,
              }),
            {
              maxAttempts: 3,
              shouldRetry: (err) => !isNonRetryableStatus(err),
            },
          );

          console.log("[useBorrow] inform-loan-opened ok");

          // 3) Success — remove from queue
          removePendingOpen(pending.id);
          await refreshLoanStats(walletAddress);
          return true;
        } catch (e) {
          console.error("[useBorrow] inform-loan-opened error", e);

          // Total failure — keep in queue for recovery
          updatePendingOpen(pending.id, {
            attempts: pending.attempts + 1,
            lastAttemptAt: Date.now(),
          });

          return false;
        }
      };

      setSubmitting(true);
      const tLoading = toast.loading(t("hooks.useBorrow.toast.submitting"));

      try {
        console.info("[useBorrow] submit start", {
          evaultAddress,
          userAddress,
          amount: amount.toString(),
          tenorDays,
          feeBps,
          requireController,
          hasController: !!controller,
          hasControllerAddress: !!controllerAddress,
        });

        let txHash: string | null = null;

        if (mode === "stellar") {
          txHash = await stellarBorrowWithTerm({
            borrower: walletAddress,
            amount,
            tenorDays,
            feeBps,
          });
        } else {
          const borrowTx = {
            contractAddress: evaultAddress,
            abi: (IEVault as { abi: unknown[] }).abi ?? IEVault,
            functionName: "borrowWithTerm",
            functionParams: [amount.toString(), userAddress, tenorDays, feeBps],
            value: "0",
          };

          // ================================
          // 2) Chequeo & enableController
          // ================================
          if (requireController) {
            if (controller && controllerAddress) {
              console.info("[useBorrow] checking isControllerEnabled", {
                controllerAddress,
                user: userAddress,
                evault: evaultAddress,
              });

              const alreadyEnabled = await safeRead(
                () =>
                  (
                    controller as unknown as {
                      isControllerEnabled: (
                        user: string,
                        vault: string,
                      ) => Promise<boolean>;
                    }
                  ).isControllerEnabled(userAddress, evaultAddress),
                false,
                "isControllerEnabled",
                { toastOnError: false },
              );

              console.info("[useBorrow] isControllerEnabled result", {
                alreadyEnabled,
              });

              if (!alreadyEnabled) {
                console.info(
                  "[useBorrow] controller NOT enabled, sending batch [enableController, borrowWithTerm]",
                  {
                    controllerAddress,
                    user: userAddress,
                    evault: evaultAddress,
                  },
                );

                const enableTx = {
                  contractAddress: controllerAddress,
                  abi: (IEVC as { abi: unknown[] }).abi ?? IEVC,
                  functionName: "enableController",
                  functionParams: [userAddress, evaultAddress],
                  value: "0",
                };

                const hashes = await sendBatchContractTx([enableTx, borrowTx]);
                txHash = hashes[hashes.length - 1] ?? null;

                if (!txHash) {
                  console.warn(
                    "[useBorrow] batch enable+borrow sin txHash esperado",
                    hashes,
                  );
                }
              } else {
                console.info(
                  "[useBorrow] controller already enabled, sending single borrowWithTerm tx.",
                );

                txHash = await sendContractTx(borrowTx);
              }
            } else {
              toast.error(t("hooks.useBorrow.toast.walletNotReady.title"), {
                description: t("hooks.useBorrow.toast.walletNotReady.desc"),
              });
              console.error(
                "[useBorrow] requireController=true but controller setup is missing.",
                {
                  requireController,
                  hasController: !!controller,
                  hasControllerAddress: !!controllerAddress,
                },
              );
              return false;
            }
          } else {
            console.info(
              "[useBorrow] requireController=false, sending single borrowWithTerm tx.",
            );
            txHash = await sendContractTx(borrowTx);
          }
        }

        // ================================
        // 3) Post-borrow
        // ================================
        await softWait(4_000);
        const synced = await informBackend(txHash);
        const explorerUrl = transactionExplorerUrl(txHash, mode);

        if (synced) {
          toast.success(
            t("hooks.useBorrow.toast.confirmed.title"),
            toastOptions(
              t("hooks.useBorrow.toast.confirmed.desc"),
              explorerUrl,
            ),
          );
        } else {
          // Chain tx SUCCEEDED (the user's borrow went through on-chain),
          // backend reconciliation is pending. Show success (green) — the
          // yellow `warning` variant misled users into thinking there was
          // a problem when there wasn't. The recovery hook syncs the backend
          // silently on next mount.
          toast.success(
            t("hooks.useBorrow.toast.syncPending.title"),
            toastOptions(
              t("hooks.useBorrow.toast.syncPending.desc"),
              explorerUrl,
            ),
          );
        }

        await refresh?.();
        return true;
      } catch (e: unknown) {
        const msg = formatBorrowError(e);

        toast.error(t("hooks.useBorrow.toast.failed.title"), {
          description: msg,
        });

        console.error("[useBorrow] borrow tx failed", {
          message: msg,
          raw: e,
        });

        return false;
      } finally {
        toast.dismiss(tLoading);
        setSubmitting(false);
      }
    },
    [
      evaultAddress,
      userAddress,
      walletAddress,
      sendContractTx,
      sendBatchContractTx,
      refresh,
      validateAmount,
      requireController,
      mode,
      controller,
      controllerAddress,
      api,
      refreshLoanStats,
      t,
      formatBorrowError,
    ],
  );

  return {
    limitRaw,
    borrowedRaw,
    maxBorrowRaw,
    maxBorrowDisplay,
    exceedsCapacity,
    validateAmount,
    canSubmit: (s: string) => validateAmount(s).ok,
    submit,
    submitting,
  };
}
