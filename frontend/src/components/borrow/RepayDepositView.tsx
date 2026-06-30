'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';

import { NumericKeypad } from '@/components/common/NumericKeypad';
import { KeypadAmount } from '@/components/common/KeypadAmount';
import { isMockTx } from '@/lib/mockTx';
import { dedupeToast as toast } from '@/lib/dedupeToast';
import { parseUsdcAmount } from '@/lib/utils';
import { stellarDeposit } from '@/lib/stellar-contracts';

/**
 * Vista de "Agregar fondos" como SUB-VISTA de la cortina de Cuenta (se desliza
 * desde la derecha). MISMA estructura/estilo que el original (Lemon), pero el
 * depósito va al vault de Soroban: deposita USDC desde la wallet del user
 * (firmado con Freighter) y en éxito vuelve al resumen.
 */
type Props = {
  /** Wallet del usuario (G... de Freighter) — origen del depósito. */
  account: string;
  /** Monto sugerido (opcional). */
  presetAmount?: string | null;
  /** Se llama tras confirmar el depósito (para volver al resumen). */
  onConfirmed: () => void;
};

export function RepayDepositView({ account, presetAmount, onConfirmed }: Props) {
  const [amount, setAmount] = React.useState<string>(presetAmount ?? '');
  const [busy, setBusy] = React.useState(false);

  const didPrefill = React.useRef<boolean>(presetAmount != null);
  React.useEffect(() => {
    if (!didPrefill.current && presetAmount) {
      setAmount(presetAmount);
      didPrefill.current = true;
    }
  }, [presetAmount]);

  const valid = parseFloat((amount || '0').replace(',', '.')) > 0;

  const onConfirm = async () => {
    if (!valid || busy) return;
    setBusy(true);

    // DEMO: depósito simulado.
    if (isMockTx()) {
      try { window.dispatchEvent(new CustomEvent('lendoor:mock-deposit-done')); } catch { /* noop */ }
      onConfirmed();
      setBusy(false);
      return;
    }

    const units = parseUsdcAmount(amount);
    if (units == null || units <= 0n) {
      toast.error('Monto inválido.');
      setBusy(false);
      return;
    }

    try {
      await stellarDeposit({ from: account, assets: units });
      try { window.dispatchEvent(new CustomEvent('lendoor:mock-deposit-done')); } catch { /* noop */ }
      toast.success('Fondos agregados');
      onConfirmed();
    } catch (e) {
      console.error('[RepayDepositView] deposit error', e);
      toast.error('No se pudo agregar los fondos. Intentá de nuevo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-md flex-col">
      {/* MEDIO scrolleable — título + monto + atajo + teclado */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain flex flex-col px-5 pt-3">
        <div className="pt-1 text-center">
          <p className="text-[15px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'rgba(21,35,59,0.62)' }}>
            Agregar fondos
          </p>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center py-3">
          <KeypadAmount value={amount} />

          {presetAmount && (
            <button
              type="button"
              onClick={() => setAmount(presetAmount)}
              disabled={busy}
              className="mt-4 rounded-full px-4 py-2 text-[13px] font-semibold transition-all active:scale-95"
              style={{ backgroundColor: 'rgba(249,116,21,0.1)', color: '#F97415' }}
            >
              Depositar (${presetAmount})
            </button>
          )}
        </div>

        <NumericKeypad value={amount} onChange={setAmount} maxDecimals={6} buttonHeight={82} gapClass="gap-2.5" />
      </div>

      {/* FOOTER anclado */}
      <div
        className="shrink-0 bg-background px-5 pt-3"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1.25rem)' }}
      >
        <button
          type="button"
          onClick={onConfirm}
          disabled={!valid || busy}
          className="flex h-[56px] w-full items-center justify-center gap-2 rounded-full text-[16px] font-semibold text-white transition-all active:scale-[0.98] disabled:opacity-50"
          style={{ backgroundColor: '#F97415' }}
        >
          {busy ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              Procesando…
            </>
          ) : (
            'Confirmar'
          )}
        </button>
      </div>
    </div>
  );
}
