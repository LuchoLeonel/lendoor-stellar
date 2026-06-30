import * as React from "react";
import { Mail, Phone, FileText, Shield, ChevronRight, ArrowDownLeft, ArrowUpRight, Wallet } from "lucide-react";
import { useTranslation } from "@/i18n/useTranslation";
import { useWallet } from "@/providers/WalletProvider";
import { formatUSDCAmountExact } from "@/lib/utils";
import { stellarReadVaultBalance, stellarReadWalletUsdc } from "@/lib/stellar-contracts";
import { RepayDepositView } from "@/components/borrow/RepayDepositView";
import { WithdrawSlideView } from "@/components/borrow/WithdrawSlideView";
import TermsBody from "@/components/terms-and-conditions/TermsBody";
import PrivacyBody from "@/components/terms-and-conditions/PrivacyBody";

type ConfigTabProps = {
  email?: string | null;
  phoneVerified?: boolean;
  phoneMasked?: string | null;
  /** Reporta el handler de "volver" (sub-vista → raíz) para que la flecha viva en
   *  el header de la cortina (anclada, igual que las demás). null = sin flecha. */
  onBackChange?: (back: (() => void) | null) => void;
};

// Label de sección — compacto (13px semibold MAYÚS, navy 0.62).
const sectionLabel = "text-[13px] font-semibold uppercase tracking-[0.14em]";
const sectionStyle = { color: 'rgba(21,35,59,0.62)' } as const;
const cardClass = "rounded-2xl px-4";
const cardStyle = { background: 'rgba(0,0,0,0.025)' } as const;
const divider = <div className="h-px" style={{ background: 'rgba(0,0,0,0.06)' }} />;

type View = 'main' | 'legal' | 'deposit' | 'withdraw';

const USDC_DECIMALS = 6;

export function ConfigTab({ email, phoneVerified, phoneMasked, onBackChange }: ConfigTabProps) {
  const { t } = useTranslation();
  const { mode, primaryWallet } = useWallet();
  const account = primaryWallet?.address ?? null;
  const isStellar = mode === 'stellar' && !!account;

  const [view, setView] = React.useState<View>('main');

  // "Disponible" (arriba) = balance del token en la wallet (incluye el loan).
  // Posición en el vault = lo retirable (lo que el user proveyó como liquidez).
  const [walletAssets, setWalletAssets] = React.useState<bigint | null>(null);
  const [vaultAssets, setVaultAssets] = React.useState<bigint | null>(null);
  const refreshBalance = React.useCallback(async () => {
    if (!account) return;
    try {
      const [wallet, vault] = await Promise.all([
        stellarReadWalletUsdc(account),
        stellarReadVaultBalance(account),
      ]);
      setWalletAssets(wallet);
      setVaultAssets(vault.assets);
    } catch (e) {
      console.error('[ConfigTab] balance read', e);
    }
  }, [account]);

  React.useEffect(() => {
    if (isStellar) void refreshBalance();
  }, [isStellar, refreshBalance]);

  // Exacto (no 2dp) → muestra el polvo/sobrante si lo hay.
  const balanceDisplay = walletAssets != null ? formatUSDCAmountExact(walletAssets) : '—';
  const vaultDisplay = vaultAssets != null ? formatUSDCAmountExact(vaultAssets) : '—';

  // Reportar el back a la cortina: en sub-vista → vuelve a 'main'; en 'main' → null.
  React.useEffect(() => {
    onBackChange?.(view !== 'main' ? () => setView('main') : null);
    return () => onBackChange?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const onConfirmed = () => {
    setView('main');
    void refreshBalance();
  };

  const items = [
    { icon: Mail, label: t("tabs.configScreen.email"), value: email || t("tabs.configScreen.notSet"), set: !!email },
    { icon: Phone, label: t("tabs.configScreen.phone"), value: phoneMasked || (phoneVerified ? t("tabs.configScreen.phoneVerified") : t("tabs.configScreen.notSet")), set: !!phoneVerified },
  ];

  const links = [
    { icon: FileText, label: t("pages.terms.title") },
    { icon: Shield, label: t("pages.privacy.title") },
  ];

  return (
    <div className="relative h-full overflow-hidden">
      <div
        className="flex h-full transition-transform duration-300 ease-out"
        style={{ width: '200%', transform: view === 'main' ? 'translateX(0)' : 'translateX(-50%)' }}
      >
        {/* ===================== PANEL 1 — Settings ===================== */}
        <div className="w-1/2 shrink-0 h-full overflow-y-auto overscroll-contain px-5 pt-5 pb-32">
          <h2 className="text-[24px] font-extrabold leading-tight mb-1" style={{ color: '#15233b' }}>{t("tabs.configScreen.title")}</h2>
          <p className="text-sm text-muted-foreground mb-5">{t("tabs.configScreen.subtitle")}</p>

          {/* Información (email / teléfono) */}
          <p className={`${sectionLabel} mb-2.5`} style={sectionStyle}>Información</p>
          <div className={`${cardClass} mb-5`} style={cardStyle}>
            {items.map(({ icon: Icon, value, set }, i) => (
              <React.Fragment key={i}>
                {i > 0 && divider}
                <div className="flex items-center gap-3.5 py-3.5">
                  <Icon className="h-[18px] w-[18px] text-muted-foreground shrink-0" />
                  <p className={`text-[15px] truncate flex-1 ${set ? "text-foreground" : "text-muted-foreground/50 italic"}`}>{value}</p>
                </div>
              </React.Fragment>
            ))}
          </div>

          {/* Cuenta Lendoor — 3 renglones: Disponible · Depositar · Retirar */}
          {isStellar && (
            <>
              <p className={`${sectionLabel} mb-2.5`} style={sectionStyle}>Cuenta Lendoor</p>
              <div className={`${cardClass} mb-5`} style={cardStyle}>
                <div className="flex items-center gap-3.5 py-3.5">
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                    style={{
                      background: 'linear-gradient(145deg, rgba(22,163,74,0.20) 0%, rgba(22,163,74,0.07) 100%)',
                      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.55), inset 0 0 0 1px rgba(22,163,74,0.14), 0 2px 7px rgba(22,163,74,0.13)',
                    }}
                  >
                    <Wallet className="h-[18px] w-[18px]" strokeWidth={2.5} style={{ color: '#16a34a' }} />
                  </span>
                  <span className="flex-1 text-[15px] font-medium" style={{ color: '#334155' }}>Disponible</span>
                  <span className="text-[18px] font-semibold tabular-nums" style={{ color: '#334155' }}>${balanceDisplay}</span>
                </div>
                {divider}
                <button
                  type="button"
                  onClick={() => setView('deposit')}
                  className="flex w-full items-center gap-3.5 py-3.5 text-left transition-opacity active:opacity-60"
                >
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                    style={{
                      background: 'linear-gradient(145deg, rgba(249,116,21,0.20) 0%, rgba(249,116,21,0.07) 100%)',
                      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.55), inset 0 0 0 1px rgba(249,116,21,0.14), 0 2px 7px rgba(249,116,21,0.13)',
                    }}
                  >
                    <ArrowDownLeft className="h-[18px] w-[18px]" strokeWidth={2.5} style={{ color: '#F97415' }} />
                  </span>
                  <span className="flex-1 text-[15px] font-medium" style={{ color: '#334155' }}>Depositar</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
                {divider}
                <button
                  type="button"
                  onClick={() => setView('withdraw')}
                  className="flex w-full items-center gap-3.5 py-3.5 text-left transition-opacity active:opacity-60"
                >
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                    style={{
                      background: 'linear-gradient(145deg, rgba(124,58,237,0.20) 0%, rgba(124,58,237,0.07) 100%)',
                      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.55), inset 0 0 0 1px rgba(124,58,237,0.14), 0 2px 7px rgba(124,58,237,0.13)',
                    }}
                  >
                    <ArrowUpRight className="h-[18px] w-[18px]" strokeWidth={2.5} style={{ color: '#7C3AED' }} />
                  </span>
                  <span className="flex-1 text-[15px] font-medium" style={{ color: '#334155' }}>Retirar</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              </div>
            </>
          )}

          {/* Legal — tocá un row → desliza al panel con TyC + Privacidad. */}
          <p className={`${sectionLabel} mb-2.5`} style={sectionStyle}>{t("tabs.configScreen.legal")}</p>
          <div className={cardClass} style={cardStyle}>
            {links.map(({ icon: Icon, label }, i) => (
              <React.Fragment key={label}>
                {i > 0 && divider}
                <button
                  type="button"
                  onClick={() => setView('legal')}
                  className="flex w-full items-center gap-3.5 py-3.5 text-left transition-opacity active:opacity-60"
                >
                  <Icon className="h-[18px] w-[18px] text-muted-foreground shrink-0" />
                  <span className="text-[15px] text-foreground flex-1">{label}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* ===================== PANEL 2 — Detalle (legal / deposit / withdraw) ===================== */}
        <div className="w-1/2 shrink-0 h-full overflow-hidden">
          {view === 'legal' && (
            <div className="h-full overflow-y-auto overscroll-contain px-5 pt-5 pb-32">
              <h2 className="text-[24px] font-extrabold leading-tight mb-5" style={{ color: '#15233b' }}>{t("tabs.configScreen.legal")}</h2>
              <div className="prose prose-sm max-w-none text-muted-foreground leading-relaxed">
                <h3 className="text-foreground">{t("pages.terms.title")}</h3>
                <TermsBody />
                <hr className="my-8" />
                <h3 className="text-foreground">{t("pages.privacy.title")}</h3>
                <PrivacyBody />
              </div>
            </div>
          )}
          {view === 'deposit' && account && (
            <RepayDepositView account={account} presetAmount={null} onConfirmed={onConfirmed} />
          )}
          {view === 'withdraw' && account && (
            <WithdrawSlideView
              account={account}
              balanceRaw={vaultAssets}
              balanceDecimals={USDC_DECIMALS}
              balanceDisplay={vaultDisplay}
              onConfirmed={onConfirmed}
            />
          )}
        </div>
      </div>
    </div>
  );
}
