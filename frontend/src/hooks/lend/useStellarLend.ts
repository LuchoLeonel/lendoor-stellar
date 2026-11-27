'use client';

import * as React from 'react';
import { useWallet } from '@/providers/WalletProvider';
import { dedupeToast as toast } from '@/lib/dedupeToast';
import { DECIMALS, formatUSDCAmount2dp, parseUsdcAmount } from '@/lib/utils';
import {
  stellarDeposit,
  stellarWithdraw,
  stellarReadVaultBalance,
  stellarReadWalletUsdc,
} from '@/lib/stellar-contracts';

/**
 * Wiring del mercado de Lend (/lend) contra el vault de Soroban — el equivalente
 * Stellar de useApproveAndDepositUSDC + useWithdrawUSDC + useVaultStats +
 * useVaultShares + useUsdcBalance. Lee TVL / share price / shares del user y el
 * balance de la wallet; depositar/retirar firman con el firmante Stellar activo (Freighter o la wallet embebida de Privy, D1.2/D2.1).
 */
export function useStellarLend() {
  const { mode, primaryWallet } = useWallet();
  const account = primaryWallet?.address ?? null;
  const enabled = mode === 'stellar' && !!account;

  const [walletRaw, setWalletRaw] = React.useState<bigint | null>(null);
  const [sharesRaw, setSharesRaw] = React.useState<bigint | null>(null);
  const [positionAssets, setPositionAssets] = React.useState<bigint | null>(null);
  const [totalAssets, setTotalAssets] = React.useState<bigint | null>(null);
  const [totalSupply, setTotalSupply] = React.useState<bigint | null>(null);
  const [decimalsOffset, setDecimalsOffset] = React.useState<number>(0);
  const [loading, setLoading] = React.useState(true);
  const [submittingDeposit, setSubmittingDeposit] = React.useState(false);
  const [submittingWithdraw, setSubmittingWithdraw] = React.useState(false);

  const refresh = React.useCallback(async () => {
    if (!enabled || !account) return;
    setLoading(true);
    try {
      const [wallet, vault] = await Promise.all([
        stellarReadWalletUsdc(account),
        stellarReadVaultBalance(account),
      ]);
      setWalletRaw(wallet);
      setSharesRaw(vault.shares);
      setPositionAssets(vault.assets);
      setTotalAssets(vault.totalAssets);
      setTotalSupply(vault.totalSupply);
      setDecimalsOffset(vault.decimalsOffset);
    } catch (e) {
      console.error('[useStellarLend] read', e);
    } finally {
      setLoading(false);
    }
  }, [enabled, account]);

  React.useEffect(() => {
    if (enabled) void refresh();
  }, [enabled, refresh]);

  // D2.3: las shares llevan `decimals_offset` decimales mas que el asset (3 en
  // los pares del Tranche 2: 1 unidad de USDC = 1_000 unidades de share a la
  // par). Para la UI se expresan en "share-USDC" (shares / 10^offset) y el
  // precio por esa unidad = total_assets / total_supply * 10^offset, asi
  // `userShares * sharePrice` sigue dando el valor en USDC y el label muestra
  // ~1.00xx como siempre.
  const shareScale = 10n ** BigInt(decimalsOffset);
  const sharePrice =
    totalSupply != null && totalSupply > 0n && totalAssets != null
      ? (Number(totalAssets) / Number(totalSupply)) * Number(shareScale)
      : 1;
  const sharesInAssetScale = sharesRaw != null ? sharesRaw / shareScale : null;

  const submitDeposit = React.useCallback(
    async (amountStr: string): Promise<boolean> => {
      if (!account) return false;
      const units = parseUsdcAmount(amountStr);
      if (units == null || units <= 0n) {
        toast.error('Monto inválido.');
        return false;
      }
      setSubmittingDeposit(true);
      try {
        await stellarDeposit({ from: account, assets: units });
        toast.success('Depósito confirmado');
        await refresh();
        return true;
      } catch (e) {
        console.error('[useStellarLend] deposit', e);
        toast.error('No se pudo depositar. Intentá de nuevo.');
        return false;
      } finally {
        setSubmittingDeposit(false);
      }
    },
    [account, refresh],
  );

  const submitWithdraw = React.useCallback(
    async (amountStr: string): Promise<boolean> => {
      if (!account) return false;
      const units = parseUsdcAmount(amountStr);
      if (units == null || units <= 0n) {
        toast.error('Monto inválido.');
        return false;
      }
      setSubmittingWithdraw(true);
      try {
        await stellarWithdraw({ from: account, assets: units });
        toast.success('Retiro confirmado');
        await refresh();
        return true;
      } catch (e) {
        console.error('[useStellarLend] withdraw', e);
        toast.error('No se pudo retirar. Intentá de nuevo.');
        return false;
      } finally {
        setSubmittingWithdraw(false);
      }
    },
    [account, refresh],
  );

  return {
    enabled,
    loading,
    /** Balance del token en la wallet (label "balance" del depósito). */
    walletUsdcDisplay: walletRaw != null ? formatUSDCAmount2dp(walletRaw) : '—',
    /** Posición del user en el vault, en escala del asset (shares / 10^offset). */
    userSharesRaw: sharesInAssetScale,
    userSharesDisplay: sharesInAssetScale != null ? formatUSDCAmount2dp(sharesInAssetScale) : '—',
    /** Shares crudas tal como las guarda el contrato (para debug / repay de shares exactas). */
    userSharesOnChain: sharesRaw,
    decimalsOffset,
    /** USDC retirable (posición valuada) — para el label "available" del retiro. */
    availableUi:
      positionAssets != null ? Number(positionAssets) / 10 ** DECIMALS : 0,
    /** TVL + share price. */
    totalAssetsDisplay: totalAssets != null ? formatUSDCAmount2dp(totalAssets) : '—',
    sharePrice,
    sharePriceDisplay: sharePrice.toFixed(4),
    submitDeposit,
    submitWithdraw,
    submittingDeposit,
    submittingWithdraw,
    refresh,
  };
}
