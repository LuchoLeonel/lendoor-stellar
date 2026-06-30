// src/components/borrow/tabs/ProgresoTab.tsx
"use client";

import * as React from "react";
import {
  Award,
  CheckCircle2,
  ChevronRight,
  Clock,
  Copy,
  Crown,
  Globe,
  Landmark,
  Loader2,
  Lock,
  Monitor,
  Rocket,
  Shield,
  Sprout,
  Trophy,
  Wallet,
  Zap,
} from "lucide-react";
import { useCreditStore } from "@/stores/creditStore";
import { useGamificationStore } from "@/stores/gamificationStore";
import { useLoanStatsStore } from "@/stores/loanStatsStore";
import { MAX_SCORE, MAX_CREDIT_LEVEL } from "@/lib/constants";
import { reputationScore } from "@/lib/reputationScore";
import { TIERS, type TierDefinition, type TierState } from "@/lib/tiers";
import { InfoTip } from "@/components/common/InfoTip";
import { useApi } from "@/hooks/useApi";
import { useContracts } from "@/providers/ContractsProvider";
import { useTranslation } from "@/i18n/useTranslation";

// ---------------------------------------------------------------------------
// TIERS / TierDefinition / TierState come from @/lib/tiers (spec 023).
// Note: tier.name is now "Nivel N: GroupName" (full). Short label for UI
// chips and icon lookups comes from `tier.groupLabel`.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Tier icon map — Lucide icons keyed by tier name
// ---------------------------------------------------------------------------

function TierIcon({ name, className }: { name: string; className?: string }) {
  const cls = className ?? "h-4 w-4";
  switch (name) {
    case "Novato":     return <Sprout className={cls} />;
    case "Activo":     return <Rocket className={cls} />;
    case "Estable":    return <Globe  className={cls} />;
    case "Confiable":  return <Shield className={cls} />;
    case "Referente":  return <Zap    className={cls} />;
    case "Leyenda":    return <Crown  className={cls} />;
    default:           return <Sprout className={cls} />;
  }
}

// ---------------------------------------------------------------------------
// Current-level card
// ---------------------------------------------------------------------------

function CurrentTierCard({ tier, isOverdue = false }: { tier: TierDefinition; isOverdue?: boolean }) {
  const { t } = useTranslation();
  const overdueColor = "#ef4444";
  return (
    <div className="relative z-10 mt-4">
      {/* NIVEL ACTUAL badge — sits above the card */}
      <div className="absolute -top-3 left-4 z-20">
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-medium text-white ${isOverdue ? '' : 'bg-primary'}`}
          style={isOverdue ? { backgroundColor: overdueColor } : undefined}
        >
          {isOverdue ? "⚠ Nivel en riesgo" : "Nivel actual"}
        </span>
      </div>

      <div
        className="relative z-10 rounded-2xl bg-white px-4 py-4"
        style={{
          border: isOverdue ? "1px solid rgba(239,68,68,0.3)" : "1px solid rgba(249,116,21,0.25)",
          boxShadow: isOverdue ? "0 2px 12px rgba(239,68,68,0.1)" : "0 2px 12px rgba(249,116,21,0.07)",
        }}
      >
        {/* Tier header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
              style={{ backgroundColor: isOverdue ? "rgba(239,68,68,0.08)" : "rgba(249,116,21,0.08)" }}
            >
              <TierIcon name={tier.groupLabel} className="h-4 w-4" style={{ color: isOverdue ? overdueColor : undefined }} />
            </div>
            <span className="text-[14px] font-bold leading-tight" style={{ color: isOverdue ? overdueColor : undefined }}>
              Nivel {tier.score}: {tier.groupLabel}
            </span>
          </div>
          <CheckCircle2 className="h-5 w-5 shrink-0" style={{ color: isOverdue ? overdueColor : undefined }} />
        </div>

        {/* Stat pills */}
        <div className="mt-3 flex gap-2">
          <div className="flex flex-1 flex-col items-center rounded-xl bg-muted/40 px-3 py-2">
            <span className="text-[9px] font-medium text-muted-foreground/70 tracking-wide">
              Tu límite
            </span>
            <span className="mt-0.5 text-[14px] font-bold tabular-nums text-foreground leading-tight">
              ${tier.limitUsdc} USDC
            </span>
          </div>
        </div>

        {/* Rate info note */}
        <p className="mt-2 text-[10px] text-muted-foreground/60 text-center leading-snug">
          {t('borrow.pull.rateCalculatedOnRequest')}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Past-level card (already completed, above current)
// ---------------------------------------------------------------------------

function PastTierCard({ tier }: { tier: TierDefinition }) {
  return (
    <div
      className="relative z-10 rounded-2xl bg-white px-5 py-4"
      style={{
        border: "1px solid #e5e7eb",
        boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100">
            <TierIcon name={tier.groupLabel} className="h-4 w-4 text-muted-foreground" />
          </div>
          <span className="text-[14px] font-semibold text-foreground/70 leading-tight">
            Nivel {tier.score}: {tier.groupLabel}
          </span>
        </div>
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
      </div>

      <div className="mt-3 flex gap-2">
        <div className="flex flex-1 flex-col items-center rounded-xl px-3 py-2 bg-slate-50">
          <span className="text-[9px] font-medium text-muted-foreground tracking-wide">
            Límite
          </span>
          <span className="mt-0.5 text-[13px] font-semibold tabular-nums text-foreground/70 leading-tight">
            ${tier.limitUsdc} USDC
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Locked-level card
// ---------------------------------------------------------------------------

function LockedTierCard({ tier, repagosNeeded }: { tier: TierDefinition; repagosNeeded: number }) {
  return (
    <div
      className="relative z-10 rounded-2xl bg-white px-4 py-3"
      style={{
        border: "1px solid #e5e7eb",
        boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100">
            <TierIcon name={tier.groupLabel} className="h-4 w-4 text-muted-foreground" />
          </div>
          <div>
            <p className="text-[13px] font-semibold text-foreground/60 leading-tight">
              Nivel {tier.score}: {tier.groupLabel}
            </p>
            <p className="mt-0.5 text-[10px] font-medium text-primary">
              {repagosNeeded} repago(s) más
            </p>
          </div>
        </div>
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100">
          <Lock className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
      </div>

      {/* Stat pills */}
      <div className="mt-3 flex gap-2">
        <div className="flex flex-1 flex-col items-center rounded-xl bg-slate-50 px-3 py-2">
          <span className="text-[9px] font-medium text-muted-foreground tracking-wide">
            Límite
          </span>
          <span className="mt-0.5 text-[14px] font-bold tabular-nums text-foreground/50 leading-tight">
            ${tier.limitUsdc} USDC
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProgresoTab
// ---------------------------------------------------------------------------

// Fuentes para mejorar el score. On-chain = wallets; Off-chain = apps de
// ingresos (gig/freelance). `logo` = archivo local en /public/logos (preferido);
// si no, se usa Clearbit (logo.clearbit.com/<dominio>) como fallback.
// TODO: descargar los demás logos a /public/logos para no depender del CDN.
const OFFCHAIN_SOURCES: { name: string; domain: string; logo?: string; fill?: boolean }[] = [
  { name: 'Upwork', domain: 'upwork.com', logo: '/logos/upwork.jpg?v=2', fill: true },
  { name: 'Uber', domain: 'uber.com', logo: '/logos/uber.png?v=2', fill: true },
  { name: 'DiDi', domain: 'didiglobal.com', logo: '/logos/didi.png', fill: true },
  { name: 'Cabify', domain: 'cabify.com', logo: '/logos/cabify.png', fill: true },
];

// Color del gauge según la posición del tick (0 = peor, 1 = mejor):
// rojo → naranja → amarillo → verde → azul. Sweep de hue por HSL.
function gaugeColor(t: number): string {
  const hue = 8 + Math.max(0, Math.min(1, t)) * 202; // 8° (rojo) → 210° (azul)
  return `hsl(${hue}, 72%, 52%)`;
}

// Gauge semicircular de ticks (estilo medidor de score). SVG liviano (líneas),
// sin lag. Los ticks llenos van con degradado (rojo→azul) según su posición;
// el resto en gris. En `overdue` el lleno es rojo sólido.
function ScoreGauge({ score, max, overdue = false }: { score: number; max: number; overdue?: boolean }) {
  const pct = Math.max(0, Math.min(1, score / max));
  const N = 48;
  const cx = 154, cy = 156, r1 = 98, r2 = 128;
  const ticks = Array.from({ length: N }, (_, i) => {
    const t = i / (N - 1);
    const a = ((180 - t * 180) * Math.PI) / 180;
    return {
      x1: cx + r1 * Math.cos(a), y1: cy - r1 * Math.sin(a),
      x2: cx + r2 * Math.cos(a), y2: cy - r2 * Math.sin(a),
      filled: t <= pct,
      color: overdue ? '#ef4444' : gaugeColor(t),
    };
  });
  const ad = ((180 - pct * 180) * Math.PI) / 180;
  const rMid = (r1 + r2) / 2;
  const dotX = cx + rMid * Math.cos(ad);
  const dotY = cy - rMid * Math.sin(ad);
  const dotColor = overdue ? '#ef4444' : gaugeColor(pct);
  return (
    <div className="relative mx-auto" style={{ width: 308 }}>
      <svg width="308" height="178" viewBox="0 0 308 178" className="mx-auto block">
        {ticks.map((tk, i) => (
          <line
            key={i}
            x1={tk.x1} y1={tk.y1} x2={tk.x2} y2={tk.y2}
            stroke={tk.filled ? tk.color : '#e7e9ee'}
            strokeWidth="5"
            strokeLinecap="round"
          />
        ))}
        <circle cx={dotX} cy={dotY} r="8" fill={dotColor} stroke="#ffffff" strokeWidth="3" />
      </svg>
      {/* Número centrado dentro del arco */}
      <div className="absolute inset-x-0 flex flex-col items-center" style={{ top: 72 }}>
        <span className="text-[54px] font-extrabold leading-none tabular-nums" style={{ color: '#1a1a1a' }}>
          {score}
        </span>
        <span className="mt-1.5 text-[14px] font-medium text-muted-foreground">de {max}</span>
      </div>
    </div>
  );
}

export function ProgresoTab({
  isOverdue = false,
  improve = false,
  onImprove,
  walletConnect = false,
  onWalletConnect,
  onWalletDone,
}: {
  isOverdue?: boolean;
  improve?: boolean;
  onImprove?: () => void;
  walletConnect?: boolean;
  onWalletConnect?: () => void;
  onWalletDone?: () => void;
}) {
  const creditScoreRaw    = useCreditStore((s) => s.creditScoreRaw);
  const achievementsCount = useGamificationStore((s) => s.achievementsCount);
  const loansCount        = useLoanStatsStore((s) => s.loansCount);
  const loansOnTimeCount  = useLoanStatsStore((s) => s.loansOnTimeCount);
  const onTimePercent     = useLoanStatsStore((s) => s.onTimePercent);

  // Smart wallet del user (la que el SDK de Lemon expone vía ContractsProvider —
  // NO wagmi useAccount, que en el webview está vacío) + wallets externas.
  const { connectedAddress: lendoorAddr } = useContracts();
  const api = useApi();
  const [externalWallets, setExternalWallets] = React.useState<{ address: string; verifiedAt?: string }[]>([]);
  React.useEffect(() => {
    let alive = true;
    api.walletLinkStatus()
      .then((s) => { if (alive) setExternalWallets(s.wallets ?? []); })
      .catch(() => { /* sin token / aún sin vincular */ });
    return () => { alive = false; };
    // refetch al cerrar el sub-flujo de conectar (volvió de verificar)
  }, [api, walletConnect]);

  // ---- Derived score ----
  const hasScore =
    typeof creditScoreRaw === "number" && Number.isFinite(creditScoreRaw);
  const score = hasScore
    ? Math.max(1, Math.min(MAX_CREDIT_LEVEL, creditScoreRaw as number))
    : 0;

  // ---- Reputation score ----
  const repScore = reputationScore(loansOnTimeCount ?? 0);
  const progressPct = Math.max(0, Math.min(100, Math.round((repScore / MAX_SCORE) * 100)));

  // ---- Stats ----
  const totalLoans = loansCount ?? 0;
  const onTimePct =
    typeof onTimePercent === "number" && Number.isFinite(onTimePercent)
      ? Math.round(onTimePercent)
      : 0;
  const totalAchievements = achievementsCount ?? 0;

  // ---- Tier helpers ----
  function tierState(tier: TierDefinition): TierState {
    if (!hasScore) return "locked";
    if (tier.score === score) return "current";
    if (tier.score < score)  return "past";
    return "locked";
  }

  function repagosNeededForTier(tier: TierDefinition): number {
    return Math.max(0, (tier.score - 1) - (loansOnTimeCount ?? 0));
  }

  // ---- Determine which tiers to display ----
  const currentIndex = hasScore ? Math.max(0, score - 1) : 0;
  const visibleTiers: TierDefinition[] = TIERS.slice(currentIndex, currentIndex + 3);

  const padB = 'calc(env(safe-area-inset-bottom, 0px) + 1.25rem)';

  return (
    <div className="relative h-full overflow-hidden">
      <div
        className="flex h-full"
        style={{
          width: '200%',
          transform: improve ? 'translateX(-50%)' : 'translateX(0)',
          transition: 'transform 400ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        {/* ===================== VISTA: SCORE ===================== */}
        <div className="w-1/2 shrink-0 h-full flex flex-col bg-background px-5 pt-5" style={{ paddingBottom: padB }}>
          <p className="text-center text-[12px] font-semibold uppercase tracking-[0.18em] text-primary mb-1">
            Lendoor Score
          </p>
          {/* TODO: mensaje dinámico según el score */}
          <div className="flex items-center justify-center gap-1 mb-1">
            <h1 className="text-[27px] font-extrabold leading-tight" style={{ color: '#15233b' }}>
              ¡Vas muy bien!
            </h1>
            <InfoTip text="Tu Lendoor Score mide tu reputación crediticia. Conectá y verificá más cuentas para subirlo y aumentar tu límite." size={16} />
          </div>

          {/* TODO: score real (mock 265/1000 por ahora) */}
          <ScoreGauge score={265} max={1000} overdue={isOverdue} />

          {/* ---- Cuentas conectadas ---- */}
          <div className="mt-7">
            <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70 mb-3">
              Cuentas conectadas
            </p>
            <div className="rounded-2xl px-4" style={{ background: 'rgba(0,0,0,0.025)' }}>
              {/* Cuenta Lendoor = la smart wallet (la que el SDK crea para la
                  mini-app, users.walletAddress). Todo user la tiene desde el día 1
                  → siempre conectada. La EOA "Cuenta Bitso" se resuelve aparte
                  (penny-drop) y vive en "Conectá tus cuentas → On-chain". */}
              <div className="flex items-center gap-3 py-3.5">
                <img src="/favicon.png" alt="Lendoor" className="h-10 w-10 rounded-full shrink-0" style={{ background: '#fff' }} />
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold leading-tight" style={{ color: '#1a1a1a' }}>Cuenta Lendoor</p>
                  <p className="mt-0.5 text-[12.5px] font-mono text-muted-foreground">{shortAddr(lendoorAddr)}</p>
                </div>
                <CheckCircle2 className="h-[18px] w-[18px] shrink-0" style={{ color: '#22c55e' }} />
              </div>
              {/* Wallets externas verificadas (reales, vía /wallet-link/status). */}
              {externalWallets.map((w) => (
                <React.Fragment key={w.address}>
                  <div className="h-px" style={{ background: 'rgba(0,0,0,0.06)' }} />
                  <div className="flex items-center gap-3 py-3.5">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white" style={{ border: '1px solid rgba(0,0,0,0.08)' }}>
                      <FoxIcon className="h-6 w-6 object-contain" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-semibold leading-tight" style={{ color: '#1a1a1a' }}>Wallet externa</p>
                      <p className="mt-0.5 text-[12.5px] font-mono text-muted-foreground">{shortAddr(w.address)}</p>
                    </div>
                    <CheckCircle2 className="h-[18px] w-[18px] shrink-0" style={{ color: '#22c55e' }} />
                  </div>
                </React.Fragment>
              ))}
            </div>
          </div>

          {/* CTA — Mejorar score (slide a la sub-vista) */}
          <button
            type="button"
            onClick={onImprove}
            className="mt-auto w-full h-[56px] rounded-full text-[16px] font-semibold text-white transition-all active:scale-[0.98]"
            style={{ backgroundColor: '#F97415', boxShadow: '0 6px 20px rgba(249,116,21,0.30)' }}
          >
            Mejorar score
          </button>
        </div>

        {/* ===================== VISTA: MEJORAR SCORE ===================== */}
        <div className="w-1/2 shrink-0 h-full flex flex-col bg-background px-5 pt-6" style={{ paddingBottom: padB }}>
          <h1 className="text-[26px] font-extrabold leading-tight" style={{ color: '#15233b' }}>
            Conectá tus cuentas
          </h1>
          <p className="text-[15px] text-muted-foreground mt-1.5 mb-7 leading-snug">
            Validá tus activos e ingresos para subir tu Lendoor Score.
          </p>

          {/* On-chain */}
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70 mb-2.5">
            On-chain
          </p>
          <div className="rounded-2xl px-4 mb-7" style={{ background: 'rgba(0,0,0,0.025)' }}>
            {/* Cuenta Bitso = la cuenta principal del user (su billetera gastable).
                Se conecta vía penny-drop (resolución por retiro) — flujo futuro. */}
            <ConnectRow name="Cuenta Bitso" sub="Conectá tu cuenta principal" logo="/bitso-icon.png" fill last={false} soon />
            <ConnectRow name="Conectar wallet" last onClick={onWalletConnect} />
          </div>

          {/* Off-chain */}
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70 mb-2.5">
            Off-chain
          </p>
          <div className="rounded-2xl px-4" style={{ background: 'rgba(0,0,0,0.025)' }}>
            {OFFCHAIN_SOURCES.map((s, i) => (
              <ConnectRow key={s.name} name={s.name} domain={s.domain} logo={s.logo} fill={s.fill} last={i === OFFCHAIN_SOURCES.length - 1} soon />
            ))}
          </div>
        </div>
      </div>

      {/* ===================== OVERLAY: CONECTAR WALLET =====================
          La flecha "volver" la provee la cortina (BottomSheet onBack), por eso
          esta vista no tiene su propio header. */}
      <WalletConnectView open={walletConnect} padB={padB} onDone={onWalletDone} />
    </div>
  );
}

// Sub-vista "Conectar wallet" — overlay que se desliza desde la derecha sobre
// "Mejorar score". Estilo minimalista propio (no UV): acento naranja, pill
// suave para "esperando conexión", companion link para la compu.
const COMPANION_URL = 'link.lendoor.xyz';

// "0x1234…abcd" — para mostrar addresses cortas.
function shortAddr(a?: string | null): string {
  if (!a || a.length < 10) return a ?? '—';
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

// Logo de MetaMask robusto: `?v=2` evita el cache viejo del webview/navegador y,
// si el svg fallara, cae al ícono de wallet en vez de mostrar roto.
function FoxIcon({ className }: { className?: string }) {
  const [failed, setFailed] = React.useState(false);
  if (failed) return <Wallet className={className} style={{ color: '#F97415' }} />;
  return <img src="/logos/metamask.svg?v=2" alt="MetaMask" className={className} onError={() => setFailed(true)} />;
}

function WalletConnectView({ open, padB, onDone }: { open: boolean; padB: string; onDone?: () => void }) {
  const api = useApi();
  const [copied, setCopied] = React.useState(false);
  const [linked, setLinked] = React.useState(false);
  const [lastAddr, setLastAddr] = React.useState<string | null>(null);
  // URL real del companion: el mismo origen que sirve el mini-app + /link
  // (en prod = el dominio; en dev = el tunnel). Antes era hardcode a
  // link.lendoor.xyz, que aún no existe → copiaba un link roto.
  const companionUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/link` : `https://${COMPANION_URL}`;
  const companionHost = companionUrl.replace(/^https?:\/\//, '');
  const copy = () => {
    navigator.clipboard?.writeText(companionUrl).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  // Polling de /wallet-link/status: snapshot baseline al abrir y detectar cuando
  // aparece una wallet nueva (la verificación la hace la web companion; el
  // estado vive en la DB → si el user cierra el cel, al reabrir igual lo ve).
  React.useEffect(() => {
    if (!open) { setLinked(false); return; }
    let alive = true;
    let baseline = -1;
    let timer: number | null = null;

    const tick = async () => {
      try {
        const s = await api.walletLinkStatus();
        if (!alive) return;
        if (baseline < 0) { baseline = s.linkedCount; }      // snapshot inicial
        else if (s.linkedCount > baseline) {                  // wallet nueva
          setLinked(true);
          setLastAddr(s.wallets?.[0]?.address ?? null);
          return;                                             // frena el loop
        }
      } catch { /* sin token / red: reintenta en el próximo tick */ }
      if (alive) timer = window.setTimeout(tick, 3500);       // ~3.5s, backoff suave
    };
    tick();

    // Al volver al foreground, re-chequear de una (pudo verificarse con el cel
    // cerrado/en background).
    const onVis = () => { if (document.visibilityState === 'visible' && alive && !linked) tick(); };
    document.addEventListener('visibilitychange', onVis);

    return () => { alive = false; if (timer) window.clearTimeout(timer); document.removeEventListener('visibilitychange', onVis); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const steps = [
    <>Entrá a <span className="font-semibold break-all" style={{ color: '#15233b' }}>{companionHost}</span></>,
    <>Iniciá sesión con el email de tu cuenta</>,
    <>Conectá y firmá con tu wallet</>,
  ];

  // ── Pantalla de éxito (cuando el polling detecta la wallet) ─────────────
  // Igual a la "Wallet linked ✓" de Ultraviolet: check grande, dirección y un
  // botón "Listo" que cierra y vuelve al Score (ya con la cuenta en la lista).
  if (linked) {
    return (
      <div
        className="absolute inset-0 z-20 flex h-full flex-col items-center bg-background px-6 pt-5 text-center"
        style={{
          paddingBottom: padB,
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 400ms cubic-bezier(0.22, 1, 0.36, 1)',
          pointerEvents: open ? 'auto' : 'none',
        }}
      >
        <div className="flex flex-1 flex-col items-center justify-center">
          {/* Tilde verde animado (pop + check dibujándose + halo) */}
          <div className="relative" style={{ width: 84, height: 84 }}>
            <span className="lk-ring absolute inset-0 rounded-full" style={{ background: 'rgba(34,197,94,0.45)' }} />
            <svg className="lk-pop relative" width={84} height={84} viewBox="0 0 52 52" aria-hidden style={{ filter: 'drop-shadow(0 8px 24px rgba(34,197,94,0.35))' }}>
              <circle cx="26" cy="26" r="26" fill="#22c55e" />
              <path className="lk-draw" d="M15 27 l7.5 7.5 L37.5 19" fill="none" stroke="#fff" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>

          <h1 className="lk-step-in mt-7 text-[26px] font-extrabold leading-tight" style={{ color: '#15233b' }}>
            ¡Wallet conectada!
          </h1>
          <p className="mt-2.5 text-[15px] leading-snug text-muted-foreground">
            Tu wallet externa quedó verificada y<br />ya suma para tu score.
          </p>

          {lastAddr && (
            <div
              className="mt-6 inline-flex items-center gap-2.5 rounded-full px-4 py-2.5"
              style={{ background: 'rgba(0,0,0,0.04)' }}
            >
              <FoxIcon className="h-5 w-5" />
              <span className="text-[14px] font-semibold tracking-tight" style={{ color: '#15233b' }}>
                {lastAddr.slice(0, 6)}…{lastAddr.slice(-4)}
              </span>
              <CheckCircle2 className="h-[15px] w-[15px]" style={{ color: '#22c55e' }} />
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onDone}
          className="flex w-full items-center justify-center gap-2 h-[56px] rounded-full text-[15px] font-semibold text-white transition-all active:scale-[0.98]"
          style={{ backgroundColor: '#F97415', boxShadow: '0 6px 20px rgba(249,116,21,0.30)' }}
        >
          Listo
        </button>
      </div>
    );
  }

  return (
    <div
      className="absolute inset-0 z-20 flex h-full flex-col bg-background px-5 pt-5"
      style={{
        paddingBottom: padB,
        transform: open ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 400ms cubic-bezier(0.22, 1, 0.36, 1)',
        pointerEvents: open ? 'auto' : 'none',
      }}
    >
      {/* Ícono protagonista */}
      <div className="mt-2 flex h-16 w-16 items-center justify-center rounded-2xl" style={{ background: 'rgba(249,116,21,0.10)' }}>
        <Monitor className="h-8 w-8" style={{ color: '#F97415' }} />
      </div>

      <h1 className="mt-5 text-[26px] font-extrabold leading-tight" style={{ color: '#15233b' }}>
        Conectá tu wallet<br />desde la computadora
      </h1>
      <p className="text-[15px] text-muted-foreground mt-2 mb-8 leading-snug">
        Validá tu wallet externa para potenciar tu límite. Por seguridad, la conexión se hace en tu compu.
      </p>

      {/* Pasos minimalistas */}
      <div className="space-y-4">
        {steps.map((s, i) => (
          <div key={i} className="flex items-start gap-3.5">
            <span
              className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-[13px] font-bold"
              style={{ background: 'rgba(249,116,21,0.12)', color: '#F97415' }}
            >
              {i + 1}
            </span>
            <p className="text-[15px] leading-snug text-muted-foreground pt-0.5">{s}</p>
          </div>
        ))}
      </div>

      {/* Pill de estado: esperando la conexión desde la compu */}
      <div
        className="mt-8 inline-flex items-center gap-2 self-start rounded-full px-3.5 py-2"
        style={{ background: 'rgba(249,116,21,0.08)' }}
      >
        <Loader2 className="h-4 w-4 animate-spin" style={{ color: '#F97415' }} />
        <span className="text-[13px] font-medium" style={{ color: '#F97415' }}>Esperando conexión…</span>
      </div>

      {/* Copiar link — anclado abajo */}
      <button
        type="button"
        onClick={copy}
        className="mt-auto flex w-full items-center justify-center gap-2 h-[56px] rounded-full text-[15px] font-semibold text-white transition-all active:scale-[0.98]"
        style={{ backgroundColor: '#F97415', boxShadow: '0 6px 20px rgba(249,116,21,0.30)' }}
      >
        {copied ? <CheckCircle2 className="h-[18px] w-[18px]" /> : <Copy className="h-[18px] w-[18px]" />}
        {copied ? '¡Link copiado!' : 'Copiar link'}
      </button>
    </div>
  );
}

// Fila para conectar (mismo estilo que "Cuentas conectadas", con flecha → en
// vez del tilde). `logo` (archivo local) tiene prioridad; si no, `domain` usa
// Clearbit; sin ninguno, icono de wallet.
function ConnectRow({ name, sub, domain, logo, fill, last, onClick, soon }: { name: string; sub?: string; domain?: string; logo?: string; fill?: boolean; last: boolean; onClick?: () => void; soon?: boolean }) {
  const src = logo ?? (domain ? `https://logo.clearbit.com/${domain}` : null);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={soon}
      className={`flex w-full items-center gap-3.5 py-3.5 text-left ${soon ? 'cursor-default' : 'transition-all active:opacity-60'}`}
      style={{ borderBottom: last ? 'none' : '1px solid rgba(0,0,0,0.06)' }}
    >
      <div
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full overflow-hidden"
        style={{ background: fill ? undefined : '#fff', border: fill ? 'none' : '1px solid rgba(0,0,0,0.08)', opacity: soon ? 0.5 : 1 }}
      >
        {src
          ? <img src={src} alt={name} className={fill ? 'h-full w-full object-cover' : 'h-7 w-7 object-contain'} loading="lazy" />
          : <Wallet className="h-5 w-5" style={{ color: '#F97415' }} />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[16px] font-semibold leading-tight" style={{ color: soon ? '#9b9b9b' : '#1a1a1a' }}>{name}</p>
        {sub && <p className="mt-0.5 text-[12.5px]" style={{ color: '#8a8f98' }}>{sub}</p>}
      </div>
      {soon
        ? <span className="shrink-0 rounded-full px-2.5 py-[5px] text-[11px] font-semibold" style={{ background: 'rgba(0,0,0,0.05)', color: '#9b9b9b' }}>Próximamente</span>
        : <ChevronRight className="h-5 w-5 shrink-0" style={{ color: 'rgba(0,0,0,0.3)' }} />}
    </button>
  );
}

export default ProgresoTab;
