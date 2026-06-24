// src/components/common/LemonFundsDialogs.tsx
"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  Dialog,
  DialogDescription,
  DialogPortal,
} from "@/components/ui/dialog";
import { dedupeToast as toast } from "@/lib/dedupeToast";
import { CheckCircle2, Loader2, XIcon } from "lucide-react";
import { useKeyboardAvoidance } from "@/hooks/useKeyboardAvoidance";
import { NumericKeypad } from "@/components/common/NumericKeypad";
import {
  deposit as lemonDeposit,
  withdraw as lemonWithdraw,
  TransactionResult as LemonTxResult,
  TokenName,
  ChainId as LemonChainId,
} from "@lemoncash/mini-app-sdk";

import { useUsdcBalance } from "@/hooks/useUsdcBalance";
import { useTranslation } from "@/i18n/useTranslation";
import { logLemonOutcome } from "@/lib/lemonErrorLog";
import { formatUnits } from "ethers";

function parseLemonChainId(): number {
  const raw = (import.meta.env.VITE_LEMON_CHAIN_ID as string | undefined)?.trim();
  if (!raw) return LemonChainId.CELO;
  const n = Number(raw);
  return Number.isFinite(n) ? n : LemonChainId.CELO;
}

export type LemonOp = "Deposit" | "Withdraw";

type LemonTxResponse =
  | {
      result: LemonTxResult;
      data?: { txHash?: string };
      error?: { message?: string };
    }
  | undefined;

export type LemonFundsDialogsProps = {
  openDeposit: boolean;
  onOpenDepositChange: (open: boolean) => void;
  openWithdraw: boolean;
  onOpenWithdrawChange: (open: boolean) => void;

  /** Textos custom opcionales para las descripciones */
  depositDescription?: React.ReactNode;
  withdrawDescription?: React.ReactNode;

  /** Safety extra, por si querés deshabilitar on-chain desde arriba */
  enabled?: boolean;

  /** Monto sugerido para el diálogo de depósito (ej: saldo faltante para pagar) */
  depositPresetAmount?: string | null;
};

// Aceptamos punto o coma como separador decimal
const DECIMAL_REGEX = /^\d*([.,]\d{0,18})?$/;

function normalizeToDot(value: string): string {
  return value.replace(/,/g, ".").trim();
}

function isValidAmount(raw: string, t: (key: string, vars?: Record<string, unknown>) => string) {
  return getFormatErrorLocalized(raw, t) === null;
}

/** Convierte un string decimal (con . o ,) a unidades mínimas (bigint) */
function toUnits(raw: string, decimals: number, t: (key: string, vars?: Record<string, unknown>) => string): bigint | null {
  if (!isValidAmount(raw, t)) return null;

  const value = normalizeToDot(raw);
  const [intPart, fracPart = ""] = value.split(".");
  const fracPadded = (fracPart + "0".repeat(decimals)).slice(0, decimals);

  const bi = BigInt(intPart || "0");
  const bf = BigInt(fracPadded || "0");
  const base = 10n ** BigInt(decimals);

  return bi * base + bf;
}

/** Devuelve string de error si el formato es inválido, si no null */
function getFormatErrorLocalized(
  raw: string,
  t: (key: string, vars?: Record<string, unknown>) => string,
): string | null {
  if (!raw || raw.trim() === "") {
    return t("common.lemonFundsDialogs.errors.empty");
  }

  if (!DECIMAL_REGEX.test(raw)) {
    return t("common.lemonFundsDialogs.errors.invalidFormat");
  }

  const normalized = normalizeToDot(raw);
  const n = Number(normalized);

  if (!Number.isFinite(n)) {
    return t("common.lemonFundsDialogs.errors.invalidAmount");
  }
  if (n <= 0) {
    return t("common.lemonFundsDialogs.errors.nonPositive");
  }

  return null;
}

export function LemonFundsDialogs({
  openDeposit,
  onOpenDepositChange,
  openWithdraw,
  onOpenWithdrawChange,
  depositDescription,
  withdrawDescription,
  enabled = true,
  depositPresetAmount,
}: LemonFundsDialogsProps) {
  const [amount, setAmount] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [successState, setSuccessState] = React.useState<"deposit" | "withdraw" | null>(null);

  // Swipe-to-close de las cortinas (igual que la de Cuenta): arrastrar abajo cierra.
  // transform translateY (GPU). Misma curva/duración que Cuenta para parejear.
  const [sheetDragY, setSheetDragY] = React.useState(0);
  const [sheetDragging, setSheetDragging] = React.useState(false);
  const sheetDragStartY = React.useRef<number | null>(null);

  const depositInputRef = React.useRef<HTMLInputElement>(null);
  const withdrawInputRef = React.useRef<HTMLInputElement>(null);

  const { t } = useTranslation();
  const { keyboardHeight } = useKeyboardAvoidance();

  // SOLO se usa para validar el withdraw
  const {
    raw: usdcRaw,
    decimals: usdcDecimals,
    display: usdcDisplay,
  } = useUsdcBalance(10_000);

  const formatError = React.useMemo(
    () => getFormatErrorLocalized(amount, t),
    [amount, t],
  );

  const insufficientBalance = React.useMemo(() => {
    if (!amount) return false;
    if (formatError) return false;
    if (usdcRaw == null || usdcDecimals == null) return false;

    const units = toUnits(amount, usdcDecimals, t);
    if (units == null) return false;

    return units > usdcRaw;
  }, [amount, formatError, usdcRaw, usdcDecimals, t]);

  const resetForm = () => {
    setAmount("");
  };

  const handleDepositOpenChange = (open: boolean) => {
    if (!open) {
      resetForm();
      setSuccessState(null);
    }
    onOpenDepositChange(open);
  };

  const handleWithdrawOpenChange = (open: boolean) => {
    if (!open) {
      resetForm();
      setSuccessState(null);
    }
    onOpenWithdrawChange(open);
  };

  // Handlers de swipe-to-close compartidos: cierran la cortina que esté abierta.
  const sheetHandlers = {
    onTouchStart: (e: React.TouchEvent) => {
      sheetDragStartY.current = e.touches[0].clientY;
    },
    onTouchMove: (e: React.TouchEvent) => {
      if (sheetDragStartY.current == null) return;
      const delta = e.touches[0].clientY - sheetDragStartY.current;
      if (delta > 0) {
        if (!sheetDragging) setSheetDragging(true);
        setSheetDragY(delta);
      }
    },
    onTouchEnd: () => {
      if (sheetDragStartY.current == null) return;
      const h = typeof window !== "undefined" ? window.innerHeight : 700;
      if (sheetDragY > h * 0.16) {
        if (openDeposit) handleDepositOpenChange(false);
        else if (openWithdraw) handleWithdrawOpenChange(false);
      }
      setSheetDragY(0);
      setSheetDragging(false);
      sheetDragStartY.current = null;
    },
  };

  // Auto-focus inputs when dialogs open
  React.useEffect(() => {
    if (openDeposit) {
      setTimeout(() => depositInputRef.current?.focus(), 350);
    }
  }, [openDeposit]);

  React.useEffect(() => {
    if (openWithdraw) {
      setTimeout(() => withdrawInputRef.current?.focus(), 350);
    }
  }, [openWithdraw]);

  React.useEffect(() => {
    if (!openDeposit) return;
    if (!depositPresetAmount) return;

    const trimmed = depositPresetAmount.trim();
    if (!trimmed) return;

    setAmount((prev) => (prev === trimmed ? prev : trimmed));
  }, [openDeposit, depositPresetAmount]);

  const handleResult = (
    op: LemonOp,
    res: LemonTxResponse,
    closeDialog: (open: boolean) => void,
  ) => {
    const opLabel =
      op === "Deposit"
        ? t("common.lemonFundsDialogs.op.deposit")
        : t("common.lemonFundsDialogs.op.withdraw");

    if (!res) {
      toast.warning(
        t("common.lemonFundsDialogs.unknownResult", { op: opLabel }),
      );
      return;
    }
    if (res.result === LemonTxResult.SUCCESS) {
      // Show success animation briefly before closing
      setSuccessState(op === "Deposit" ? "deposit" : "withdraw");
      setTimeout(() => {
        setSuccessState(null);
        closeDialog(false);
        toast.success(
          t("common.lemonFundsDialogs.success", { op: opLabel }),
        );
      }, 1200);
      return;
    }
    if (res.result === LemonTxResult.FAILED) {
      toast.error(
        t("common.lemonFundsDialogs.failed", { op: opLabel }),
      );
      return;
    }
    if (res.result === LemonTxResult.CANCELLED) {
      toast.info(t("common.lemonFundsDialogs.cancelledTitle"));
      return;
    }
    toast.warning(
      t("common.lemonFundsDialogs.unknownResult", { op: opLabel }),
    );
  };

  const doDeposit = async () => {
    if (!enabled) return;

    if (!isValidAmount(amount, t)) {
      const err =
        getFormatErrorLocalized(amount, t) ??
        t("common.lemonFundsDialogs.invalidAmountFallback");
      toast.error(err);
      return;
    }

    const normalized = normalizeToDot(amount);

    setBusy(true);
    try {
      const chainId = parseLemonChainId();
      const res = await lemonDeposit({
        amount: normalized,
        tokenName: TokenName.USDC,
        chainId: chainId as never,
      });
      logLemonOutcome("deposit", res as never, {
        payload: { amount: normalized, tokenName: TokenName.USDC, chainId },
      });
      handleResult("Deposit", res, handleDepositOpenChange);
    } catch (e) {
      logLemonOutcome("deposit", null, {
        payload: { amount: normalized, tokenName: TokenName.USDC },
        extra: { thrown: e instanceof Error ? e.message : String(e) },
      });
      toast.error(t("common.lemonFundsDialogs.depositErrorTitle"));
    } finally {
      setBusy(false);
      resetForm();
    }
  };

  const doWithdraw = async () => {
    if (!enabled) return;

    if (!isValidAmount(amount, t)) {
      const err =
        getFormatErrorLocalized(amount, t) ??
        t("common.lemonFundsDialogs.invalidAmountFallback");
      toast.error(err);
      return;
    }

    // chequeo de saldo SOLO acá
    if (usdcRaw != null && usdcDecimals != null) {
      const units = toUnits(amount, usdcDecimals, t);
      if (units != null && units > usdcRaw) {
        toast.error(
          t("common.lemonFundsDialogs.errors.insufficientWithdrawBalance"),
        );
        return;
      }
    }

    const normalized = normalizeToDot(amount);

    setBusy(true);
    try {
      const chainId = parseLemonChainId();
      const res = await lemonWithdraw({
        amount: normalized,
        tokenName: TokenName.USDC,
        chainId,
      } as never);
      logLemonOutcome("withdraw", res as never, {
        payload: { amount: normalized, tokenName: TokenName.USDC, chainId },
      });
      handleResult("Withdraw", res, handleWithdrawOpenChange);
    } catch (e) {
      logLemonOutcome("withdraw", null, {
        payload: { amount: normalized, tokenName: TokenName.USDC },
        extra: { thrown: e instanceof Error ? e.message : String(e) },
      });
      toast.error(t("common.lemonFundsDialogs.withdrawErrorTitle"));
    } finally {
      setBusy(false);
      resetForm();
    }
  };

  const depositDisabled = busy || !!formatError || !amount;
  const withdrawDisabled =
    busy || !!formatError || !amount || insufficientBalance;

  // Suppress unused-prop warnings — descriptions kept for accessibility / future use
  void depositDescription;
  void withdrawDescription;

  return (
    <>
      {/* ===== Dialog Depositar ===== */}
      <Dialog open={openDeposit} onOpenChange={handleDepositOpenChange}>
        <DialogPortal>
          {/* Backdrop tenue + proporcional al swipe (igual que la cortina de Cuenta).
              Se aclara a medida que arrastrás para cerrar. opacity = GPU, sin lag. */}
          <div
            onClick={() => {
              if (openDeposit) handleDepositOpenChange(false);
              else if (openWithdraw) handleWithdrawOpenChange(false);
            }}
            aria-hidden="true"
            className="fixed inset-0 z-40"
            style={{
              background: '#000',
              opacity: Math.max(
                0,
                0.28 *
                  (1 -
                    sheetDragY /
                      (typeof window !== 'undefined' ? window.innerHeight * 0.987 : 700)),
              ),
              transition: sheetDragging
                ? 'none'
                : 'opacity 460ms cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          />
          <DialogPrimitive.Content
            {...sheetHandlers}
            className="fixed bottom-0 inset-x-0 mx-auto max-w-md z-50 bg-white rounded-t-3xl overflow-hidden flex flex-col data-[state=open]:animate-[slideUpFull_460ms_cubic-bezier(0.22,1,0.36,1)] data-[state=closed]:animate-[slideDownFull_320ms_cubic-bezier(0.22,1,0.36,1)]"
            style={{
              top: '1.3%',
              transform: `translateY(${sheetDragY}px)`,
              transition: sheetDragging
                ? 'none'
                : 'transform 460ms cubic-bezier(0.22,1,0.36,1), padding-bottom 200ms ease-out',
              paddingBottom: keyboardHeight > 0 ? `${keyboardHeight}px` : undefined,
            }}
          >
            {successState === "deposit" ? (
              /* Success screen — fullscreen centered */
              <div className="flex-1 flex flex-col items-center justify-center px-6">
                <div
                  className="flex h-20 w-20 items-center justify-center rounded-full mb-6"
                  style={{
                    backgroundColor: "rgba(34,197,94,0.1)",
                    animation: "scaleIn 400ms cubic-bezier(0.34, 1.56, 0.64, 1)",
                  }}
                >
                  <CheckCircle2 className="h-10 w-10" style={{ color: "#22c55e" }} />
                </div>
                <p className="text-[24px] font-bold text-foreground">¡Listo!</p>
                <p className="text-[16px] text-muted-foreground mt-2">
                  Fondos agregados exitosamente
                </p>
              </div>
            ) : (
              <>
                {/* Accessibility — hidden description required by Radix */}
                <DialogDescription className="sr-only">
                  {t("common.lemonFundsDialogs.depositDescription")}
                </DialogDescription>

                {/* Grabber (cortina) */}
                <div className="shrink-0 pt-3 pb-1">
                  <div className="mx-auto h-1.5 w-10 rounded-full" style={{ background: 'rgba(0,0,0,0.18)' }} />
                </div>
                {/* Top bar */}
                <div
                  className="flex items-center justify-between px-5 pb-0"
                  style={{ paddingTop: '4px' }}
                >
                  <div />
                  <DialogPrimitive.Close
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-muted/50 transition-colors hover:bg-muted active:scale-95"
                    disabled={busy}
                  >
                    <XIcon className="h-5 w-5 text-muted-foreground" />
                    <span className="sr-only">Cerrar</span>
                  </DialogPrimitive.Close>
                </div>

                {/* Title + amount — hero area (anclado abajo, pegado al teclado) */}
                <div className="flex-1 flex flex-col items-center justify-end px-6 gap-4 pb-6">
                  <p className="text-[13px] uppercase tracking-widest font-medium text-muted-foreground/70">
                    Agregar fondos
                  </p>

                  {/* Display del monto — sin <input> nativo (no dispara teclado del SO).
                      El valor lo maneja el NumericKeypad de abajo. */}
                  <div className="relative text-center">
                    <p className="text-[clamp(48px,15vw,72px)] font-bold tabular-nums leading-none text-foreground">
                      {amount || "0"}<span className="text-[24px] font-semibold text-muted-foreground ml-2">USDC</span>
                    </p>
                  </div>

                  {/* Preset button — only shown when there's a pending loan */}
                  {depositPresetAmount && (
                    <button
                      type="button"
                      onClick={() => setAmount(depositPresetAmount)}
                      disabled={busy}
                      className="mt-4 rounded-full px-4 py-2 text-[13px] font-semibold transition-all active:scale-95 disabled:opacity-40"
                      style={{ backgroundColor: "rgba(249,116,21,0.1)", color: "#F97415" }}
                    >
                      Depositar para pagar crédito ({depositPresetAmount} USDC)
                    </button>
                  )}

                  {/* Format error */}
                  {formatError && amount && (
                    <p className="mt-4 text-[14px] text-red-500 font-medium">
                      {formatError}
                    </p>
                  )}
                </div>

                {/* Teclado numérico custom (reemplaza el del SO) */}
                <div className="px-5 pb-1">
                  <NumericKeypad value={amount} onChange={setAmount} disabled={busy} />
                </div>

                {/* Bottom CTA */}
                <div
                  className="px-6 pt-2"
                  style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.75rem)" }}
                >
                  <button
                    onClick={doDeposit}
                    disabled={depositDisabled}
                    className="w-full h-[52px] rounded-2xl text-[16px] font-semibold text-white transition-all disabled:opacity-40 active:scale-[0.98]"
                    style={{ backgroundColor: "#F97415" }}
                  >
                    {busy ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader2 className="h-5 w-5 animate-spin" />
                        Procesando…
                      </span>
                    ) : (
                      "Confirmar"
                    )}
                  </button>
                </div>
              </>
            )}
          </DialogPrimitive.Content>
        </DialogPortal>
      </Dialog>

      {/* ===== Dialog Retirar ===== */}
      <Dialog open={openWithdraw} onOpenChange={handleWithdrawOpenChange}>
        <DialogPortal>
          {/* Backdrop tenue + proporcional al swipe (igual que la cortina de Cuenta).
              Se aclara a medida que arrastrás para cerrar. opacity = GPU, sin lag. */}
          <div
            onClick={() => {
              if (openDeposit) handleDepositOpenChange(false);
              else if (openWithdraw) handleWithdrawOpenChange(false);
            }}
            aria-hidden="true"
            className="fixed inset-0 z-40"
            style={{
              background: '#000',
              opacity: Math.max(
                0,
                0.28 *
                  (1 -
                    sheetDragY /
                      (typeof window !== 'undefined' ? window.innerHeight * 0.987 : 700)),
              ),
              transition: sheetDragging
                ? 'none'
                : 'opacity 460ms cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          />
          <DialogPrimitive.Content
            {...sheetHandlers}
            className="fixed bottom-0 inset-x-0 mx-auto max-w-md z-50 bg-white rounded-t-3xl overflow-hidden flex flex-col data-[state=open]:animate-[slideUpFull_460ms_cubic-bezier(0.22,1,0.36,1)] data-[state=closed]:animate-[slideDownFull_320ms_cubic-bezier(0.22,1,0.36,1)]"
            style={{
              top: '1.3%',
              transform: `translateY(${sheetDragY}px)`,
              transition: sheetDragging
                ? 'none'
                : 'transform 460ms cubic-bezier(0.22,1,0.36,1), padding-bottom 200ms ease-out',
              paddingBottom: keyboardHeight > 0 ? `${keyboardHeight}px` : undefined,
            }}
          >
            {successState === "withdraw" ? (
              /* Success screen — fullscreen centered */
              <div className="flex-1 flex flex-col items-center justify-center px-6">
                <div
                  className="flex h-20 w-20 items-center justify-center rounded-full mb-6"
                  style={{
                    backgroundColor: "rgba(34,197,94,0.1)",
                    animation: "scaleIn 400ms cubic-bezier(0.34, 1.56, 0.64, 1)",
                  }}
                >
                  <CheckCircle2 className="h-10 w-10" style={{ color: "#22c55e" }} />
                </div>
                <p className="text-[24px] font-bold text-foreground">¡Listo!</p>
                <p className="text-[16px] text-muted-foreground mt-2">
                  Retiro procesado exitosamente
                </p>
              </div>
            ) : (
              <>
                {/* Accessibility — hidden description required by Radix */}
                <DialogDescription className="sr-only">
                  {t("common.lemonFundsDialogs.withdrawDescription")}
                </DialogDescription>

                {/* Grabber (cortina) */}
                <div className="shrink-0 pt-3 pb-1">
                  <div className="mx-auto h-1.5 w-10 rounded-full" style={{ background: 'rgba(0,0,0,0.18)' }} />
                </div>
                {/* Top bar */}
                <div
                  className="flex items-center justify-between px-5 pb-0"
                  style={{ paddingTop: '4px' }}
                >
                  <div />
                  <DialogPrimitive.Close
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-muted/50 transition-colors hover:bg-muted active:scale-95"
                    disabled={busy}
                  >
                    <XIcon className="h-5 w-5 text-muted-foreground" />
                    <span className="sr-only">Cerrar</span>
                  </DialogPrimitive.Close>
                </div>

                {/* Title + amount — hero area (anclado abajo, pegado al teclado) */}
                <div className="flex-1 flex flex-col items-center justify-end px-6 pb-5">
                  <p className="text-[13px] uppercase tracking-widest font-medium text-muted-foreground/70 mb-5">
                    Retirar fondos
                  </p>

                  {/* Display del monto — sin <input> nativo (no dispara teclado del SO).
                      El valor lo maneja el NumericKeypad de abajo. */}
                  <div className="relative text-center">
                    <p className="text-[clamp(48px,15vw,72px)] font-bold tabular-nums leading-none text-foreground">
                      {amount || "0"}<span className="text-[24px] font-semibold text-muted-foreground ml-2">USDC</span>
                    </p>
                  </div>

                  {/* Available balance + Max button */}
                  {usdcDisplay != null && (
                    <div className="mt-4 flex items-center gap-3">
                      <p className="text-[13px] text-muted-foreground">
                        Disponible:{" "}
                        <span className={`font-semibold ${(() => {
                          if (usdcRaw == null || usdcDecimals == null) return 'text-foreground';
                          const fullBal = parseFloat(formatUnits(usdcRaw, usdcDecimals));
                          return (fullBal - parseFloat(amount || "0")) < 0 ? 'text-red-500' : 'text-foreground';
                        })()}`}>
                          {(() => {
                            if (usdcRaw == null || usdcDecimals == null) return "0";
                            const fullBal = parseFloat(formatUnits(usdcRaw, usdcDecimals));
                            const remaining = fullBal - parseFloat(amount || "0");
                            // 4 decimals is enough for users to read — 6 is noise.
                            // Max still uses the raw bigint for the actual withdraw.
                            return remaining.toFixed(4);
                          })()} USDC
                        </span>
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          if (usdcRaw != null && usdcDecimals != null) {
                            // Full precision — display value is rounded to 2 decimals
                            // and would fail the balance check for sub-cent balances.
                            setAmount(formatUnits(usdcRaw, usdcDecimals));
                          }
                        }}
                        disabled={busy || usdcRaw == null}
                        className="rounded-full px-3 py-1 text-[12px] font-bold uppercase tracking-wide transition-all active:scale-95 disabled:opacity-40"
                        style={{ backgroundColor: "rgba(99,102,241,0.1)", color: "#6366f1" }}
                      >
                        Max
                      </button>
                    </div>
                  )}

                  {/* Format error */}
                  {formatError && amount && (
                    <p className="mt-3 text-[14px] text-red-500 font-medium">
                      {formatError}
                    </p>
                  )}

                  {/* Insufficient balance error */}
                  {!formatError && insufficientBalance && (
                    <p className="mt-3 text-[14px] text-red-500 font-medium text-center">
                      No podés retirar más de tu saldo disponible
                    </p>
                  )}
                </div>

                {/* Teclado numérico custom (reemplaza el del SO) */}
                <div className="px-5 pb-1">
                  <NumericKeypad value={amount} onChange={setAmount} disabled={busy} />
                </div>

                {/* Bottom CTA */}
                <div
                  className="px-6 pt-2"
                  style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.75rem)" }}
                >
                  <button
                    onClick={doWithdraw}
                    disabled={withdrawDisabled}
                    className="w-full h-[52px] rounded-2xl text-[16px] font-semibold text-white transition-all disabled:opacity-40 active:scale-[0.98]"
                    style={{ backgroundColor: "#6366f1" }}
                  >
                    {busy ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader2 className="h-5 w-5 animate-spin" />
                        Procesando…
                      </span>
                    ) : (
                      "Confirmar"
                    )}
                  </button>
                </div>
              </>
            )}
          </DialogPrimitive.Content>
        </DialogPortal>
      </Dialog>
    </>
  );
}
