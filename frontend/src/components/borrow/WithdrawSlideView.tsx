'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';

import { NumericKeypad } from '@/components/common/NumericKeypad';
import { KeypadAmount } from '@/components/common/KeypadAmount';
import { isMockTx } from '@/lib/mockTx';
import { dedupeToast as toast } from '@/lib/dedupeToast';
import { parseUsdcAmount } from '@/lib/utils';
import { stellarWithdraw } from '@/lib/stellar-contracts';

/**
 * Retirar fondos como SUB-VISTA (slide) de la cortina de Cuenta — MISMO patrón
 * que RepayDepositView. Retira USDC del vault de Soroban hacia la wallet del
 * user (firmado con Freighter). Vive dentro del slider de ConfigTab.
 */
type Props = {
  /** Wallet del usuario (G... de Freighter) — destino del retiro. */
  account: string;
  /** Saldo disponible en el vault (units, 6 decimales) para validar/Max. */
  balanceRaw: bigint | null;
  balanceDecimals: number | null;
  /** Saldo disponible formateado (exacto) para "Disponible: $X". */
  balanceDisplay: string;
  /** Tras retirar OK → volver a la raíz. */
  onConfirmed: () => void;
};

function unitsToFloat(raw: bigint, decimals: number): number {
  return Number(raw) / 10 ** decimals;
}

export function WithdrawSlideView({ account, balanceRaw, balanceDecimals, balanceDisplay, onConfirmed }: Props) {
  const [amount, setAmount] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const num = parseFloat((amount || '0').replace(',', '.'));
  // No permitir retirar más de lo que hay (sólo ANTES de confirmar; durante el
  // retiro `busy` desactiva el check porque el balance baja por este mismo retiro).
  const overBalance = React.useMemo(() => {
    if (busy || !amount || balanceRaw == null || balanceDecimals == null) return false;
    try {
      const full = unitsToFloat(balanceRaw, balanceDecimals);
      return num > full + 1e-9;
    } catch { return false; }
  }, [busy, amount, num, balanceRaw, balanceDecimals]);
  const valid = num > 0 && !overBalance;

  const setMax = () => {
    // Precisión completa → retira hasta el polvo.
    if (balanceRaw != null && balanceDecimals != null) {
      const base = 10n ** BigInt(balanceDecimals);
      const whole = balanceRaw / base;
      const frac = (balanceRaw % base).toString().padStart(balanceDecimals, '0').replace(/0+$/, '');
      setAmount(frac ? `${whole}.${frac}` : `${whole}`);
    }
  };

  const onConfirm = async () => {
    if (!valid || busy) return;
    setBusy(true);

    // DEMO (mock): retiro simulado.
    if (isMockTx()) {
      try { window.dispatchEvent(new CustomEvent('lendoor:withdraw-done')); } catch { /* noop */ }
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
      await stellarWithdraw({ from: account, assets: units });
      try { window.dispatchEvent(new CustomEvent('lendoor:withdraw-done')); } catch { /* noop */ }
      toast.success('Retiro procesado');
      onConfirmed();
    } catch (e) {
      console.error('[WithdrawSlideView] withdraw error', e);
      toast.error('No se pudo completar el retiro. Intentá de nuevo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-md flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain flex flex-col px-5 pt-3">
        <div className="pt-1 text-center">
          <p className="text-[15px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'rgba(21,35,59,0.62)' }}>
            Retirar fondos
          </p>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center py-3">
          <KeypadAmount value={amount} color={overBalance ? '#ef4444' : '#334155'} />

          <div className="mt-4 flex items-center gap-2.5">
            <span className="text-[14px]" style={{ color: 'rgba(21,35,59,0.55)' }}>
              Disponible: <span className="font-semibold" style={{ color: overBalance ? '#ef4444' : 'rgba(21,35,59,0.72)' }}>${balanceDisplay}</span>
            </span>
            <button
              type="button"
              onClick={setMax}
              disabled={busy || balanceRaw == null}
              className="rounded-full px-4 py-2 text-[13px] font-bold uppercase tracking-wide transition-all active:scale-95 disabled:opacity-40"
              style={{ background: 'rgba(124,58,237,0.1)', color: '#7c3aed' }}
            >
              Max
            </button>
          </div>

          <div className="mt-2 h-[18px]">
            {overBalance && <p className="text-[12px] font-medium" style={{ color: '#ef4444' }}>No podés retirar más que tu saldo</p>}
          </div>
        </div>

        <NumericKeypad value={amount} onChange={setAmount} maxDecimals={6} buttonHeight={82} gapClass="gap-2.5" />
      </div>

      <div
        className="shrink-0 bg-background px-5 pt-3"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1.25rem)' }}
      >
        <button
          type="button"
          onClick={onConfirm}
          disabled={!valid || busy}
          className="flex h-[56px] w-full items-center justify-center gap-2 rounded-full text-[16px] font-semibold text-white transition-all active:scale-[0.98] disabled:opacity-50"
          style={{ backgroundColor: '#7c3aed' }}
        >
          {busy ? (<><Loader2 className="h-5 w-5 animate-spin" />Procesando…</>) : 'Confirmar'}
        </button>
      </div>
    </div>
  );
}
