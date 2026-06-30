// src/components/borrow/CreditMarket.tsx
'use client';

import * as React from 'react';

import { CalendarClock, CheckCircle2, ArrowRight, ChevronRight, ArrowDownLeft, ArrowUpRight, Crown, Sprout, Rocket, Globe, Shield, Zap, TrendingUp } from 'lucide-react';
import { GridBackground } from '@/components/common/GridBackground';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SplashLoader } from '@/components/common/SplashLoader';
import { LemonFundsDialogs } from '@/components/common/LemonFundsDialogs';
import { useHistoryBackGuard } from '@/hooks/useHistoryBackGuard';

import { PullPanel } from '@/components/borrow/PullPanel';
import { RepayPanel } from '@/components/borrow/RepayPanel';
import { TransactionProgress, TxState } from '@/components/common/TransactionProgress';

import { useCreditLine } from '@/hooks/borrow/blockchain/useCreditLine';
import { useUsdcBalance } from '@/hooks/useUsdcBalance';

import { CooldownPanel } from './CoolDownPanel';
import CreditScoreShowcase from './CreditScoreShowcase';
import CreditPerformanceStrip from './CreditPerformanceStrip';
import { MiniAppFundsBox } from './MiniAppFundsBox';
import { AchievementDialog } from './AchievementDialog';
import { formatUSDCAmount2dp } from '@/lib/utils';
import { useWallet } from '@/providers/WalletProvider';
import { useFarcaster } from '@/providers/FarcasterProvider';
import { HeaderUsdcArea } from '@/components/common/HeaderUsdcArea';
import SlidingScreens from '@/components/common/SlidingScreens';
import TermsAndConditionsCard from '@/components/terms-and-conditions/TermsAndConditionsCard';
import { useTranslation } from '@/i18n/useTranslation';
import { type Tab } from '@/components/common/BottomTabBar';
import { ProgresoTab } from '@/components/borrow/tabs/ProgresoTab';
import { BottomSheet } from '@/components/common/BottomSheet';
import { ConfigTab } from '@/components/borrow/tabs/ConfigTab';
import { PrestarTab } from '@/components/borrow/tabs/PrestarTab';
import { useCreditStore } from '@/stores/creditStore';
import { useLoanStatsStore } from '@/stores/loanStatsStore';
import { MAX_SCORE } from '@/lib/constants';
import { reputationScore } from '@/lib/reputationScore';
import { getTierForScore } from '@/lib/tiers';
import { LoanTermStrip } from '@/components/borrow/LoanTermStrip';
import { InfoTip } from '@/components/common/InfoTip';


// ===================== TIER LOOKUP =====================
// Spec 023 — pull score + groupLabel from the shared tiers.ts single source
// of truth, keep icon (lucide component) and iconColor local to this file
// since they are UI-only concerns.
interface TierInfo {
  name: string;
  icon: React.ElementType;
  iconColor: string;
  levelNumber: number;
}

// Tier icon colors. Lower tiers use the brand orange darkening progressively.
// Top tiers (Confiable, Referente, Leyenda) shift to a gold gradient — same
// progressive-darken idea, but the destination is "premium gold" instead of
// "brown". This makes the high tiers feel earned/premium, which the previous
// brown gradient (#C2570B → #9A4509) did not communicate.
const ICON_BY_GROUP: Record<string, { icon: React.ElementType; iconColor: string }> = {
  Novato:    { icon: Sprout,  iconColor: '#F97415' }, // brand orange
  Activo:    { icon: Rocket,  iconColor: '#EA6B0E' },
  Estable:   { icon: Globe,   iconColor: '#D4600C' },
  Confiable: { icon: Shield,  iconColor: '#D4A017' }, // gold-light (transition)
  Referente: { icon: Zap,     iconColor: '#C5870E' }, // gold-medium
  Leyenda:   { icon: Crown,   iconColor: '#B8860B' }, // DarkGoldenrod (premium)
};

function getTierInfo(score: number): TierInfo {
  const tier = getTierForScore(score);
  const meta = ICON_BY_GROUP[tier.groupLabel] ?? ICON_BY_GROUP.Novato!;
  return {
    name: tier.groupLabel,
    icon: meta.icon,
    iconColor: meta.iconColor,
    levelNumber: tier.score,
  };
}

// ===================== SCORE COMPACT CARD =====================
function ScoreCompactCard({ creditScoreRaw, isOverdue = false, onPress }: { creditScoreRaw: number | null; isOverdue?: boolean; onPress?: () => void }) {
  const { t } = useTranslation();
  const score =
    typeof creditScoreRaw === 'number' && Number.isFinite(creditScoreRaw)
      ? Math.max(0, creditScoreRaw)
      : 0;

  const hasScore =
    typeof creditScoreRaw === 'number' && Number.isFinite(creditScoreRaw);

  const loansOnTimeCount = useLoanStatsStore((s) => s.loansOnTimeCount);
  const repScore = reputationScore(loansOnTimeCount ?? 0);

  const progressPct = hasScore ? (repScore / MAX_SCORE) * 100 : 0;

  const tier = getTierInfo(hasScore ? score : 1);

  return (
    <div
      className="relative mt-3 rounded-2xl px-5 py-4 flex items-center gap-4 transition-all duration-300 cursor-pointer active:scale-[0.98]"
      style={{
        background: '#ffffff',
        border: '1px solid rgba(0,0,0,0.06)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02)',
        position: 'relative',
        zIndex: 2,
      }}
      onClick={onPress}
    >
      {/* Tier icon container */}
      <div className="flex h-11 w-11 items-center justify-center rounded-xl shrink-0" style={{ backgroundColor: 'rgba(0,0,0,0.04)' }}>
        <tier.icon className="h-5 w-5" style={{ color: tier.iconColor }} />
      </div>

      {/* Level name + score + bar */}
      <div className="flex-1 min-w-0">
        <p className="text-[15px] font-bold leading-tight" style={{ color: isOverdue ? '#ef4444' : undefined }}>
          Nivel {tier.levelNumber}: <span style={{ color: isOverdue ? '#ef4444' : 'inherit' }}>{tier.name}</span>
        </p>
        <p className="text-[12px] text-muted-foreground mt-0.5 flex items-center gap-1">
          Score {hasScore ? repScore : '—'} / {MAX_SCORE}
          <InfoTip text={t('borrow.market.scoreTooltip')} size={12} />
        </p>
        <div className="mt-2 h-1.5 w-full rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(249,116,21,0.12)' }}>
          <div
            className="h-full rounded-full transition-[width] duration-500 ease-out"
            style={{ width: `${Math.max(progressPct, 2)}%`, backgroundColor: isOverdue ? '#ef4444' : '#F97415' }}
          />
        </div>
        {/* Badge — below progress bar */}
        <div className="mt-2 flex items-center gap-1">
          <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider" style={{ backgroundColor: 'rgba(249,116,21,0.08)', color: '#D4600C' }}>
            {t('borrow.market.earlyUserBadge')}
          </span>
        </div>
      </div>
    </div>
  );
}

// ===================== CREDIT STATUS CARD =====================
// Cuántas actividades se muestran en el HOME. Si hay más, aparece "Ver
// historial completo"; si hay <= esto, se ven todas y el link se oculta.
const HOME_ACTIVITY_LIMIT = 5;

// Actividad mock (préstamos/repagos) para probar el scroll del historial.
// TODO: reemplazar por datos reales (hook de actividad on-chain).
const ACTIVITY_MOCK: { type: 'borrow' | 'repay'; amount: string; date: string }[] = [
  { type: 'borrow', amount: '3.00', date: 'Hoy' },
  { type: 'repay', amount: '1.50', date: 'Ayer' },
  { type: 'borrow', amount: '2.00', date: 'Hace 3 días' },
  { type: 'repay', amount: '2.00', date: 'Hace 5 días' },
  { type: 'borrow', amount: '1.00', date: 'Hace 1 semana' },
  { type: 'repay', amount: '1.00', date: 'Hace 9 días' },
  { type: 'borrow', amount: '2.50', date: 'Hace 2 semanas' },
  { type: 'repay', amount: '0.50', date: 'Hace 3 semanas' },
  { type: 'borrow', amount: '1.50', date: 'Hace 1 mes' },
];

// Lista de actividad reutilizable (home muestra 5; cortina muestra todas).
function ActivityList({ items }: { items: typeof ACTIVITY_MOCK }) {
  return (
    <div className="flex flex-col">
      {items.map((a, i) => {
        const isBorrow = a.type === 'borrow';
        return (
          <div
            key={i}
            className="flex items-center gap-3 py-3.5"
            style={{ borderBottom: i < items.length - 1 ? '1px solid rgba(0,0,0,0.06)' : 'none' }}
          >
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
              style={{ background: isBorrow ? 'rgba(249,116,21,0.10)' : 'rgba(22,163,74,0.10)' }}
            >
              {isBorrow
                ? <ArrowDownLeft className="h-5 w-5" style={{ color: '#F97415' }} />
                : <ArrowUpRight className="h-5 w-5" style={{ color: '#16a34a' }} />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold leading-tight" style={{ color: '#1a1a1a' }}>
                {isBorrow ? 'Préstamo' : 'Repago'}
              </p>
              <p className="mt-0.5 text-[13px]" style={{ color: '#8a8f98' }}>{a.date}</p>
            </div>
            <p className="shrink-0 text-[15px] font-semibold tabular-nums" style={{ color: isBorrow ? '#1a1a1a' : '#16a34a' }}>
              {isBorrow ? '+' : '−'}${a.amount}
            </p>
          </div>
        );
      })}
    </div>
  );
}

// Chip de score reputacional (liquid glass) para la esquina del hero.
// Anillo de progreso + número. Mockeado por ahora; tap → cortina Progreso.
function ReputationScoreBadge({
  score,
  max,
  onPress,
}: {
  score: number;
  max: number;
  onPress?: () => void;
}) {
  const pct = Math.max(0, Math.min(1, score / max));
  const r = 14;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - pct);
  return (
    <button
      type="button"
      onClick={onPress}
      aria-label={`Score ${score} de ${max}`}
      className="relative flex h-11 items-center gap-2 rounded-full pl-1.5 pr-3 transition-transform active:scale-95"
      style={{
        // Glass falso (sin backdrop-blur) → GPU puro, sin costo al scrollear.
        // Pill horizontal: simple pero alargado, con chevron → invita al tap.
        background: 'rgba(255,255,255,0.13)',
        border: '1px solid rgba(255,255,255,0.22)',
        boxShadow: '0 2px 12px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.18)',
      }}
    >
      {/* Anillo de progreso con el score adentro */}
      <span className="relative flex h-8 w-8 shrink-0 items-center justify-center">
        <svg width="32" height="32" viewBox="0 0 32 32" className="absolute -rotate-90">
          <defs>
            <linearGradient id="repRing" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#FDBA74" />
              <stop offset="100%" stopColor="#F97415" />
            </linearGradient>
          </defs>
          <circle cx="16" cy="16" r={r} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="2.5" />
          <circle
            cx="16"
            cy="16"
            r={r}
            fill="none"
            stroke="url(#repRing)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={offset}
          />
        </svg>
        <span className="relative text-[12px] font-bold leading-none" style={{ color: '#ffffff' }}>
          {score}
        </span>
      </span>
      {/* Label + chevron → affordance de "tocá para ver" */}
      <span className="text-[13px] font-semibold" style={{ color: 'rgba(255,255,255,0.85)' }}>
        Score
      </span>
      <ChevronRight className="h-[18px] w-[18px] shrink-0" style={{ color: 'rgba(255,255,255,0.5)' }} />
    </button>
  );
}

// Variante visual de la "unión" hero ↔ contenido (UX redesign).
// Alternar este valor para probar en vivo:
//   'blue-curve'    → el panel oscuro termina redondeado abajo (la curva la
//                     tiene el azul; el blanco queda recto detrás).
//   'white-curtain' → el contenido blanco sube con esquina redondeada arriba,
//                     como una cortina que emerge sobre el azul recto (mismo
//                     lenguaje que las cortinas de Depositar/Retirar/Cuenta).
const HERO_VARIANT: 'blue-curve' | 'white-curtain' = 'blue-curve';
// Radio de la unión azul↔blanco. 0 = línea divisoria recta (sin cortina).
const HERO_CURVE_RADIUS = 0;

type CreditStatusCardProps = {
  hasDebt: boolean;
  cooldownActive: boolean;
  isAccruingLateFees: boolean;
  borrowedDisplay: string;
  limitDisplay: string;
  daysRemaining: number | null;
  termProgressPct: number | null;
  loanFeeBps: number | null;
  cooldownSecondsLeft: number | null;
  onGoToPrestar: () => void;
  /** Sin recuadro propio (bg/borde/sombra): el contenido vive sobre el
      panel "cortina" del hero, que ya provee el fondo. Default false. */
  bare?: boolean;
};

function CreditStatusCard({
  hasDebt,
  cooldownActive,
  isAccruingLateFees,
  borrowedDisplay,
  limitDisplay,
  daysRemaining,
  termProgressPct,
  cooldownSecondsLeft,
  onGoToPrestar,
  bare = false,
}: CreditStatusCardProps) {
  // Chrome del recuadro (solo cuando NO es bare). En bare el panel hero manda.
  const cardClass = bare
    ? 'group relative flex flex-1 min-h-0 flex-col'
    : 'group relative rounded-2xl px-6 pt-6 pb-5 transition-all duration-300 cursor-pointer active:scale-[0.98] overflow-hidden';
  const { t } = useTranslation();
  // Spec 046 — `hasDebt` takes priority over `cooldownActive`. Users with
  // an active loan + pending amountDue (incl. post-writeOff state) must
  // see the repay flow, not the cooldown wait. Cooldown is borrow-side.
  // ---- HAS DEBT state (priority) ----
  // (moved to first branch — see ../specs/046-repay-during-cooldown-fix/spec.md)
  // ---- COOLDOWN state ----
  if (cooldownActive && !hasDebt) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={onGoToPrestar}
        onKeyDown={(e) => e.key === 'Enter' && onGoToPrestar()}
        className={cardClass}
        style={bare ? undefined : {
          background: `
            radial-gradient(ellipse 80% 60% at 100% 0%, rgba(34,197,94,0.10) 0%, transparent 50%),
            linear-gradient(155deg, #0a0e17 0%, #121a2b 35%, #182438 65%, #0f1520 100%)
          `,
          boxShadow: '0 8px 32px rgba(0,0,0,0.25), 0 2px 6px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.07)',
        }}
      >
        {/* Top row — logo */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <img src="/favicon.png" alt="" className="h-7 w-7" style={{ opacity: 0.9 }} />
            <span className="text-[14px] font-bold mono-text tracking-wide" style={{ color: '#F97415' }}>LENDOOR</span>
          </div>
          <CheckCircle2 className="h-5 w-5" style={{ color: '#4ade80' }} />
        </div>

        {/* Status */}
        <div className="mb-4">
          <p className="text-[18px] font-bold leading-tight" style={{ color: '#ffffff' }}>
            {t('borrow.market.repayProcessed')}
          </p>
          <p className="mt-1.5 text-[13px]" style={{ color: 'rgba(255,255,255,0.50)' }}>
            {t('borrow.market.nextCreditIn')}{' '}
            <span className="font-semibold" style={{ color: '#4ade80' }}>
              {Math.floor((cooldownSecondsLeft ?? 0) / 86400)} {Math.floor((cooldownSecondsLeft ?? 0) / 86400) === 1 ? 'día' : 'días'}
            </span>
          </p>
        </div>

        {/* Separator */}
        <div style={{ height: '1px', background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.07) 20%, rgba(255,255,255,0.09) 50%, rgba(255,255,255,0.07) 80%, transparent 100%)' }} />

        {/* Bottom row — label + CTA */}
        <div className="flex items-center justify-between mt-4">
          <span className="text-[11px] uppercase tracking-[0.12em] font-medium" style={{ color: 'rgba(255,255,255,0.40)' }}>
            En espera
          </span>
          <div className="flex items-center gap-1.5 rounded-full px-4 py-1.5 transition-all duration-200 group-hover:gap-2" style={{ border: '1px solid rgba(34,197,94,0.25)', background: 'rgba(34,197,94,0.06)' }}>
            <span className="text-[12px] font-semibold" style={{ color: '#4ade80' }}>Ver detalle</span>
            <ArrowRight className="h-3.5 w-3.5" style={{ color: '#4ade80' }} />
          </div>
        </div>
      </div>
    );
  }

  // ---- HAS DEBT state ----
  if (hasDebt) {
    const hasTiming =
      typeof daysRemaining === 'number' &&
      Number.isFinite(daysRemaining) &&
      typeof termProgressPct === 'number' &&
      Number.isFinite(termProgressPct);

    const progressPct = hasTiming
      ? Math.max(0, Math.min(100, termProgressPct as number))
      : 0;

    const isOverdue = hasTiming && (daysRemaining as number) < 0;

    const daysLabel = hasTiming
      ? (() => {
          const d = daysRemaining as number;
          if (d > 1) return t('borrow.market.dueInDays', { days: Math.ceil(d) });
          if (d > 0) return t('borrow.market.dueInLessDay');
          if (d > -1) return t('borrow.market.dueToday');
          return t('borrow.market.overdueDays', { days: Math.abs(Math.floor(d)) });
        })()
      : null;

    return (
      <>
      {isOverdue && (
        <style>{`
          @keyframes pulse-border {
            0%, 100% { border-color: rgba(220,38,38,0.15); }
            50% { border-color: rgba(220,38,38,0.35); }
          }
        `}</style>
      )}
      <div
        role="button"
        tabIndex={0}
        onClick={onGoToPrestar}
        onKeyDown={(e) => e.key === 'Enter' && onGoToPrestar()}
        className={cardClass}
        style={bare ? undefined : {
          background: isOverdue
            ? `radial-gradient(ellipse 80% 60% at 100% 0%, rgba(220,38,38,0.10) 0%, transparent 50%),
               linear-gradient(155deg, #170a0a 0%, #251212 35%, #2d1616 65%, #1a0c0c 100%)`
            : `radial-gradient(ellipse 80% 60% at 100% 0%, rgba(249,116,21,0.12) 0%, transparent 50%),
               radial-gradient(ellipse 60% 80% at 0% 100%, rgba(99,102,241,0.09) 0%, transparent 50%),
               linear-gradient(155deg, #0a0e17 0%, #121a2b 35%, #182438 65%, #0f1520 100%)`,
          boxShadow: isOverdue
            ? '0 8px 32px rgba(220,38,38,0.15), 0 2px 6px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.04)'
            : '0 8px 32px rgba(0,0,0,0.30), 0 2px 6px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.05)',
          border: isOverdue ? '1px solid rgba(220,38,38,0.15)' : '1px solid rgba(255,255,255,0.07)',
          animation: isOverdue ? 'pulse-border 3s ease-in-out infinite' : undefined,
        }}
      >
        {/* Top row — logo (credit card layout) */}
        <div className="mb-4">
          <div className="flex items-center gap-2">
            <img src="/favicon.png" alt="" className="h-7 w-7" style={{ opacity: 0.9 }} />
            <span className="text-[14px] font-bold mono-text tracking-wide" style={{ color: '#F97415' }}>LENDOOR</span>
          </div>
        </div>

        {/* Amount — "$" mismo tamaño que el número (sin logo ni sufijo). */}
        <div className="flex items-end mb-3">
          <p className="text-[2.5rem] font-bold leading-none tracking-tight min-w-0 truncate" style={{ color: isOverdue ? '#fca5a5' : '#ffffff' }}>
            ${borrowedDisplay}
          </p>
        </div>

        {/* Metadata row */}
        {daysLabel && (
          <div className="flex items-center gap-4 text-[12px] mb-3" style={{ color: 'rgba(255,255,255,0.50)' }}>
            <span className="flex items-center gap-1.5">
              <CalendarClock className="h-3.5 w-3.5 shrink-0" />
              {daysLabel}
            </span>
          </div>
        )}

        {/* Progress bar — only when not overdue */}
        {hasTiming && !isOverdue && (
          <div className="h-1.5 w-full overflow-hidden rounded-full mb-3" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}>
            <div
              className="h-full rounded-full transition-[width] duration-500 ease-out"
              style={{ width: `${progressPct}%`, background: '#F97415' }}
            />
          </div>
        )}

        {/* Late fee single message — replaces progress bar when overdue */}
        {isOverdue && (
          <p className="text-[11px] font-medium mb-3" style={{ color: 'rgba(248,113,113,0.80)' }}>
            Se acumulan intereses por mora
          </p>
        )}

        {/* Bottom row — status + CTA */}
        <div className="flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-[0.12em] font-medium" style={{ color: isOverdue ? 'rgba(248,113,113,0.7)' : 'rgba(255,255,255,0.40)' }}>
            {isAccruingLateFees ? t('borrow.market.creditOverdue') : t('borrow.market.creditActive')}
          </span>
          <div className="flex items-center gap-1.5 rounded-full px-4 py-1.5 transition-all duration-200 group-hover:gap-2" style={{ border: `1px solid ${isOverdue ? 'rgba(248,113,113,0.25)' : 'rgba(249,116,21,0.25)'}`, background: isOverdue ? 'rgba(248,113,113,0.06)' : 'rgba(249,116,21,0.06)' }}>
            <span className="text-[12px] font-semibold" style={{ color: isOverdue ? '#f87171' : '#F97415' }}>
              {isAccruingLateFees ? t('borrow.market.payNow') : t('borrow.market.viewTermsLink')}
            </span>
            <ArrowRight className="h-3.5 w-3.5" style={{ color: isOverdue ? '#f87171' : '#F97415' }} />
          </div>
        </div>
      </div>
      </>
    );
  }

  // ---- NO DEBT state — available credit ----
  // En `bare` la card NO es clickeable entera: solo el botón "Solicitar"
  // dispara la acción (tocar el número/límite no debe hacer nada).
  return (
    <div
      {...(bare
        ? {}
        : {
            role: 'button',
            tabIndex: 0,
            onClick: onGoToPrestar,
            onKeyDown: (e: React.KeyboardEvent) => e.key === 'Enter' && onGoToPrestar(),
          })}
      className={cardClass}
      style={bare ? undefined : {
        background: `
          radial-gradient(ellipse 80% 60% at 100% 0%, rgba(249,116,21,0.12) 0%, transparent 50%),
          radial-gradient(ellipse 60% 80% at 0% 100%, rgba(99,102,241,0.09) 0%, transparent 50%),
          linear-gradient(155deg, #0a0e17 0%, #121a2b 35%, #182438 65%, #0f1520 100%)
        `,
        boxShadow: '0 8px 32px rgba(0,0,0,0.30), 0 2px 6px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.05)',
        border: '1px solid rgba(255,255,255,0.07)',
      }}
    >

      {/* Bloque Límite + número — centrado verticalmente en el espacio sobre
          el botón (se acomoda a la altura de la tarjeta). */}
      <div className="flex flex-1 flex-col justify-center">
        <p className="mb-2 text-[12.6px] font-medium uppercase tracking-[0.16em]" style={{ color: 'rgba(255,255,255,0.50)' }}>
          Límite
        </p>
        <div className="flex items-center">
          {/* "$" mismo tamaño/tipo que el número (sin logo USDC ni sufijo, para
              no confundir con el naming "dólar digital" de Lemon). Responsive. */}
          <p className="text-[clamp(3.57rem,16.8vw,4.62rem)] font-bold leading-none tracking-tight" style={{ color: '#ffffff' }}>
            ${limitDisplay}
          </p>
        </div>
      </div>

      {/* CTA grande — anclado al FONDO de la tarjeta (shrink-0). */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onGoToPrestar(); }}
        className="shrink-0 w-full h-[56px] rounded-full text-[16px] font-semibold text-white transition-all active:scale-[0.98]"
        style={{
          // CTA primario sólido — naranja fuerte (#F97415).
          backgroundColor: '#F97415',
          boxShadow: '0 6px 20px rgba(249,116,21,0.35)',
        }}
      >
        <span className="flex items-center justify-center gap-2">
          {t('borrow.market.requestCta')}
          <ArrowRight className="h-4.5 w-4.5" strokeWidth={2.5} />
        </span>
      </button>
    </div>
  );
}

// ===================== MAIN COMPONENT =====================
type CreditMarketProps = {
  setShowQR: (show: boolean) => void;
  userEmail?: string | null;
  userPhoneVerified?: boolean;
  userPhoneMasked?: string | null;
};

export function CreditMarket({ setShowQR, userEmail, userPhoneVerified, userPhoneMasked }: CreditMarketProps) {
  const { isLoggedIn, setShowAuthFlow, loadingNetwork, isMiniApp, mode } = useWallet();
  const { t } = useTranslation();
  const { displayName } = useFarcaster();
  const creditScoreRaw = useCreditStore((s) => s.creditScoreRaw);

  // Spec 034 — own the TransactionProgress state at this level so the
  // celebration overlay survives RepayPanel's unmount (which fires
  // the moment `outstandingRaw` hits 0 right after a successful repay).
  const [repayTxState, setRepayTxState] = React.useState<TxState>('idle');
  const [repayTxError, setRepayTxError] = React.useState<string | undefined>(undefined);
  const handleRepayTxStateChange = React.useCallback(
    (state: TxState, error?: string) => {
      setRepayTxState(state);
      setRepayTxError(error);
    },
    [],
  );

  const {
    borrowedRaw,
    borrowedDisplay,
    limitRaw,
    limitDisplay,
    loading: creditLoading,
    cooldownActive,
    cooldownUntil,
    cooldownSecondsLeft,
    hasActiveLoan,
    daysRemaining,
    termProgressPct,
    isAccruingLateFees,
    loanFeeBps,
  } = useCreditLine();

  const { raw: usdcRaw, decimals: usdcDecimals } = useUsdcBalance(10_000);

  // Deposit shortfall: how much more the user needs to deposit to cover the loan
  const depositShortfall = React.useMemo(() => {
    if (borrowedRaw == null || borrowedRaw <= 0n || usdcRaw == null || usdcDecimals == null) return null;
    const diff = borrowedRaw - usdcRaw;
    if (diff <= 0n) return null;
    const num = Number(diff) / 10 ** usdcDecimals;
    return (Math.ceil(num * 100) / 100).toFixed(2);
  }, [borrowedRaw, usdcRaw, usdcDecimals]);

  // ---- Loader inicial (sólo la PRIMER vez, sin flicker) ----
  const [initialReady, setInitialReady] = React.useState(false);

  // Deposit dialog (Lemon mini-app)
  const [openDeposit, setOpenDeposit] = React.useState(false);
  const [openWithdraw, setOpenWithdraw] = React.useState(false);
  const isLemon = mode === 'lemon';

  // subVista: 'main' (borrow/repay/cooldown) o 'terms' (TyC)
  const [subView, setSubView] = React.useState<'main' | 'terms'>('main');

  // Tab activo para mini-app
  const [activeTab, setActiveTab] = React.useState<Tab>('inicio');

  // Cuenta y Progreso son OVERLAYS (bottom sheets reutilizables), no tabs —
  // la home queda visible detrás. Toda la lógica de gesto/transición vive en
  // <BottomSheet>.
  const [showConfig, setShowConfig] = React.useState(false);
  // Back de la cortina Cuenta: si hay sub-vista abierta (deposit/withdraw/legal),
  // el ConfigTab reporta su handler acá → la flecha del header vuelve a 'main'.
  const [configBack, setConfigBack] = React.useState<(() => void) | null>(null);
  const [showProgreso, setShowProgreso] = React.useState(false);
  const [progresoImprove, setProgresoImprove] = React.useState(false); // sub-vista "Mejorar score"
  const [progresoWalletConnect, setProgresoWalletConnect] = React.useState(false); // sub-vista "Conectar wallet"
  const [showHistorial, setShowHistorial] = React.useState(false); // cortina historial completo
  const [showPrestar, setShowPrestar] = React.useState(false);

  // Hint "tocá atrás de nuevo para salir" (doble-tap en inicio).
  const [exitHint, setExitHint] = React.useState(false);
  const exitHintTimer = React.useRef<number | null>(null);

  // Back nativo (flecha de Lemon) — cadena de más profundo a más superficial.
  // Devuelve true si consumió el gesto (no salir); false solo en inicio sin
  // nada abierto (habilita el doble-tap para salir del mini-app).
  const handleNativeBack = React.useCallback((): boolean => {
    if (progresoWalletConnect) { setProgresoWalletConnect(false); return true; }
    if (progresoImprove) { setProgresoImprove(false); return true; }
    if (showProgreso) { setShowProgreso(false); setProgresoImprove(false); setProgresoWalletConnect(false); return true; }
    if (showHistorial) { setShowHistorial(false); return true; }
    if (showConfig) { if (configBack) { configBack(); return true; } setShowConfig(false); return true; }
    if (showPrestar) {
      if (subView === 'terms') { setSubView('main'); return true; }
      setShowPrestar(false); return true;
    }
    if (activeTab !== 'inicio') { setActiveTab('inicio'); return true; }
    return false; // inicio + nada abierto → permitir salida (doble tap)
  }, [progresoWalletConnect, progresoImprove, showProgreso, showHistorial, showConfig, showPrestar, subView, activeTab]);

  useHistoryBackGuard({
    onBack: handleNativeBack,
    namespace: 'borrow-tabs',
    onArmExit: () => {
      setExitHint(true);
      if (exitHintTimer.current) window.clearTimeout(exitHintTimer.current);
      exitHintTimer.current = window.setTimeout(() => setExitHint(false), 2000);
    },
  });

  // Scroll to top when switching tabs
  const inicioRef = React.useRef<HTMLDivElement>(null);
  const prestarRef = React.useRef<HTMLDivElement>(null);
  const progresoRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    inicioRef.current?.scrollTo(0, 0);
    prestarRef.current?.scrollTo(0, 0);
    progresoRef.current?.scrollTo(0, 0);
  }, [activeTab]);



  // Delay the transition slightly so the real content has time to mount
  // before the splash disappears — prevents a white flash between states.
  React.useEffect(() => {
    if (
      !initialReady &&
      !creditLoading &&
      limitRaw !== null &&
      borrowedRaw !== null
    ) {
      const id = requestAnimationFrame(() => setInitialReady(true));
      return () => cancelAnimationFrame(id);
    }
  }, [initialReady, creditLoading, limitRaw, borrowedRaw]);

  // Loader inicial
  if (!initialReady) {
    return (
      <TooltipProvider delayDuration={150}>
        <SplashLoader label={t('borrow.market.loading')} />
      </TooltipProvider>
    );
  }

  const safeLimitRaw = limitRaw ?? 0n;
  const safeBorrowedRaw = borrowedRaw ?? 0n;

  const hasDebt = safeBorrowedRaw > 0n;

  const availableDisplay = formatUSDCAmount2dp(safeLimitRaw - safeBorrowedRaw);

  const daysForRepay =
    hasDebt && hasActiveLoan && daysRemaining != null ? daysRemaining : null;

  const progressForRepay =
    hasDebt && hasActiveLoan && termProgressPct != null
      ? termProgressPct
      : null;

  // ===================== VISTA PRINCIPAL (inicio tab / non-miniapp) =====================
  // Spec 046 — `hasDebt` takes priority over `cooldownActive`.
  //
  // Cooldown (`nextBorrowTime`) is a borrow-side lock-out — the contract
  // ignores it on `Borrowing.repay()`. Users with an active loan that has
  // pending `amountDue` (including post-writeOff state where vault.debtOf=0
  // but LoanManager.amountDue>0) MUST be able to repay regardless of
  // cooldown. Audit 2026-05-06 found 195 wallets stuck in this state with
  // ~$664.88 cumulative pending.
  //
  // `borrowedRaw` is sourced from `loan.amountDue` (or `previewLoanWithLate`
  // when accruing) in `useCreditLine.ts` — already correct for the
  // post-writeOff case. This change is purely flow-control reorder.
  let screenKey: string;
  let mainBlock: React.ReactNode;

  if (hasDebt) {
    screenKey = 'repay';
    mainBlock = (
      <div className="space-y-3">
        <LoanTermStrip
          daysRemaining={daysForRepay ?? undefined}
          progressPct={progressForRepay ?? undefined}
        />
        <RepayPanel
          isLoggedIn={!!isLoggedIn}
          loadingNetwork={loadingNetwork}
          onConnect={() => setShowAuthFlow()}
          outstandingLabel={t('borrow.market.outstandingLabel')}
          outstandingAmount={borrowedDisplay}
          outstandingRaw={borrowedRaw ?? null}
          isAccruingLateFees={isAccruingLateFees}
          onTxStateChange={handleRepayTxStateChange}
        />
      </div>
    );
  } else if (cooldownActive) {
    screenKey = 'cooldown';
    mainBlock = (
      <CooldownPanel
        cooldownUntil={cooldownUntil}
        cooldownSecondsLeft={cooldownSecondsLeft}
      />
    );
  } else {
    screenKey = 'borrow';
    mainBlock = (
      <PullPanel
        isLoggedIn={!!isLoggedIn}
        loadingNetwork={loadingNetwork}
        onConnect={() => setShowAuthFlow()}
        onPull={() => {}}
        setShowQR={setShowQR}
        availableAmount={availableDisplay}
        lineDisplay={limitDisplay}
      />
    );
  }

  // ===================== MINI-APP: tabbed layout =====================
  if (isMiniApp || mode === 'stellar') {
    return (
      <TooltipProvider delayDuration={150}>
        {/* Tab content with crossfade */}
        <div className="relative" style={{ height: '100dvh' }}>

          {/* ===== Inicio — hero OPACO azul (imagen de fondo, SIN nube naranja).
              Al ser opaco tapa el azul del scroller, así el gradiente del scroller
              puede ser BLANCO desde el 52% sin que se vea (el hero lo cubre arriba).
              Resultado: el rebote inferior cae sobre BLANCO (no azul), incluso con
              historial corto, sin franja navy. Trade-off: hero ya no transparente. */}
          <div
            ref={inicioRef}
            className="absolute inset-0 overflow-x-hidden transition-opacity duration-300 ease-in-out"
            style={{
              opacity: activeTab === 'inicio' ? 1 : 0,
              pointerEvents: activeTab === 'inicio' ? 'auto' : 'none',
              zIndex: activeTab === 'inicio' ? 1 : 0,
              overflowY: (showConfig || showProgreso || showPrestar || showHistorial) ? 'hidden' : 'auto',
              overscrollBehavior: 'contain',
              touchAction: 'pan-y',
              WebkitOverflowScrolling: 'touch',
              // Azul SÓLIDO 0-46% (mismo color que el hero → sin costura al
              // scrollear) → BLANCO desde 52%. El rebote inferior pinta blanco.
              background: isAccruingLateFees
                ? `linear-gradient(to bottom, #1c1010 0%, #1c1010 46%, #ffffff 52%, #ffffff 100%)`
                : `linear-gradient(to bottom, #0e1626 0%, #0e1626 46%, #ffffff 52%, #ffffff 100%)`,
            }}
          >
            {/* ===== Hero OPACO (fondo azul, sin nube). Acá iría una <img> de
                fondo azul si se quiere; por ahora gradiente azul plano. ===== */}
            <div
              className="relative mx-auto w-full max-w-md flex flex-col px-5 overflow-hidden"
              style={{
                paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1.1rem)',
                paddingBottom: '2.6rem',
                minHeight: '52dvh',
                // SÓLIDO opaco — MISMO color que el azul del scroller (#0e1626) →
                // empalme perfecto al scrollear, sin la unión/costura de antes.
                backgroundColor: isAccruingLateFees ? '#1c1010' : '#0e1626',
              }}
            >
              {/* Chips: avatar (izq) + score (der) */}
              <div className="relative flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  {/* Avatar con inicial del nombre/mail + dot naranja Lendoor.
                      Tappable → abre Cuenta (config). */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setShowConfig(true)}
                    onKeyDown={(e) => e.key === 'Enter' && setShowConfig(true)}
                    className="relative shrink-0 cursor-pointer transition-transform active:scale-95"
                    aria-label="Cuenta"
                  >
                    <div
                      className="flex h-11 w-11 items-center justify-center rounded-full"
                      style={{
                        // Glass falso (sin backdrop-blur) → sin lag al scrollear.
                        background: 'rgba(255,255,255,0.13)',
                        border: '1px solid rgba(255,255,255,0.22)',
                        boxShadow: '0 2px 12px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.18)',
                      }}
                    >
                      <span className="text-[17px] font-semibold" style={{ color: '#ffffff' }}>
                        {(displayName || userEmail || '?').trim().charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <span
                      className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full"
                      style={{ background: '#F97415', border: '2px solid rgba(10,14,23,0.9)' }}
                    />
                  </div>
                </div>
                {/* Score reputacional (mock 245/1000) — tap → cortina Progreso. */}
                <ReputationScoreBadge score={265} max={1000} onPress={() => { setProgresoImprove(false); setShowProgreso(true); }} />
              </div>

              {/* Monto — ocupa el alto del hero; número arriba, botón abajo */}
              <div className="relative flex-1 flex flex-col pt-7">
                <CreditStatusCard
                  bare
                  hasDebt={hasDebt}
                  cooldownActive={cooldownActive}
                  isAccruingLateFees={isAccruingLateFees}
                  borrowedDisplay={borrowedDisplay}
                  limitDisplay={availableDisplay}
                  daysRemaining={daysForRepay}
                  termProgressPct={progressForRepay}
                  loanFeeBps={loanFeeBps}
                  cooldownSecondsLeft={cooldownSecondsLeft}
                  onGoToPrestar={() => setShowPrestar(true)}
                />
              </div>
            </div>

            {/* ===== Historial BLANCO — cortina redondeada que solapa el azul
                (-mt-6). El hero opaco arriba + gradiente blanco-desde-52% del
                scroller hacen que el rebote inferior caiga sobre blanco. ===== */}
            <div
              className="relative mx-auto w-full max-w-md -mt-6 rounded-t-3xl px-5 pt-5 bg-background"
              style={{
                paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.4rem)',
                boxShadow: '0 -12px 28px rgba(0,0,0,0.10)',
              }}
            >
              {/* Nudge: subí tu límite → dispara el flow de Conectar cuentas
                  (Progreso en modo "Mejorar score / Conectá tus cuentas"). */}
              <button
                type="button"
                onClick={() => { setProgresoImprove(true); setShowProgreso(true); }}
                className="mt-1 flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 text-left transition-all active:scale-[0.98]"
                style={{ background: 'rgba(249,116,21,0.08)', border: '1px solid rgba(249,116,21,0.22)' }}
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ background: 'rgba(249,116,21,0.14)' }}>
                  <TrendingUp className="h-5 w-5" style={{ color: '#F97415' }} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold leading-tight" style={{ color: '#15233b' }}>Aumentá tu límite</p>
                  <p className="mt-0.5 text-[13px] leading-tight text-muted-foreground">Conectá tus cuentas para pedir más</p>
                </div>
                <ChevronRight className="h-5 w-5 shrink-0" style={{ color: 'rgba(249,116,21,0.7)' }} />
              </button>

              {/* Actividad — últimas 5 (el resto en la cortina "historial completo") */}
              <div className="pt-6">
                <h2 className="mb-1 text-[15px] font-semibold" style={{ color: '#1a1a1a' }}>
                  Actividad
                </h2>
                <ActivityList items={ACTIVITY_MOCK.slice(0, HOME_ACTIVITY_LIMIT)} />

                {/* "Ver historial completo" SOLO si hay más de las que mostramos
                    (si entran todas, no tiene sentido el link → se oculta). */}
                {ACTIVITY_MOCK.length > HOME_ACTIVITY_LIMIT && (
                  <button
                    type="button"
                    onClick={() => setShowHistorial(true)}
                    className="mt-2 w-full flex items-center justify-center gap-1 py-2 text-[14px] font-semibold transition-transform active:scale-[0.98]"
                    style={{ color: '#F97415' }}
                  >
                    Ver historial completo
                    <ChevronRight className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>{/* /cortina */}
          </div>



        </div>

        {/* Botones fijos de cooldown (Retirar + Ver progreso) removidos: no van
            en la versión nueva. "Ver progreso" hacía setActiveTab('progreso')
            (tab sin vista → pantalla blanca). El acceso al progreso sigue por el
            score badge (cortina). */}

        {/* Solicitar/Pagar — cortina reutilizable (se abre desde los botones Solicitar) */}
        <BottomSheet open={showPrestar} onClose={() => setShowPrestar(false)}>
          <PrestarTab setShowQR={setShowQR} onBackToInicio={() => setShowPrestar(false)} isActive={showPrestar} />
        </BottomSheet>

        {/* Cuenta — cortina reutilizable (se abre desde el avatar) */}
        <BottomSheet
          open={showConfig}
          onClose={() => { setConfigBack(null); setShowConfig(false); }}
          onBack={configBack ?? undefined}
        >
          <ConfigTab
            email={userEmail}
            phoneVerified={userPhoneVerified}
            phoneMasked={userPhoneMasked}
            onBackChange={(fn) => setConfigBack(() => fn)}
          />
        </BottomSheet>

        {/* Progreso — cortina reutilizable (se abre tocando el score/nivel).
            Sub-vista 'Mejorar score' (conectar cuentas) con slide + flecha volver. */}
        <BottomSheet
          open={showProgreso}
          onClose={() => { setShowProgreso(false); setProgresoImprove(false); setProgresoWalletConnect(false); }}
          onBack={
            progresoWalletConnect
              ? () => setProgresoWalletConnect(false)
              : progresoImprove
                ? () => setProgresoImprove(false)
                : undefined
          }
        >
          <ProgresoTab
            isOverdue={isAccruingLateFees}
            improve={progresoImprove}
            onImprove={() => setProgresoImprove(true)}
            walletConnect={progresoWalletConnect}
            onWalletConnect={() => setProgresoWalletConnect(true)}
            onWalletDone={() => { setProgresoWalletConnect(false); setProgresoImprove(false); }}
          />
        </BottomSheet>

        {/* Historial completo — cortina (desde "Ver historial completo") */}
        <BottomSheet open={showHistorial} onClose={() => setShowHistorial(false)}>
          <div className="mx-auto w-full max-w-md px-5 pt-4 pb-10">
            <h2 className="mb-2 text-[18px] font-bold" style={{ color: '#1a1a1a' }}>Historial</h2>
            <ActivityList items={ACTIVITY_MOCK} />
          </div>
        </BottomSheet>

        {/* Hint doble-tap para salir (inicio + flecha nativa) */}
        <div
          className="pointer-events-none fixed inset-x-0 z-[70] flex justify-center"
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 1.5rem)' }}
        >
          <div
            className="rounded-full px-4 py-2.5 text-[13px] font-medium text-white transition-all duration-300"
            style={{
              background: 'rgba(20,20,20,0.88)',
              opacity: exitHint ? 1 : 0,
              transform: exitHint ? 'translateY(0)' : 'translateY(8px)',
            }}
          >
            Tocá atrás de nuevo para salir
          </div>
        </div>

        {/* Modal de logros (overlay) */}
        <AchievementDialog />

        {/* Deposit dialog triggered by action button */}
        <LemonFundsDialogs
          openDeposit={openDeposit}
          onOpenDepositChange={setOpenDeposit}
          openWithdraw={openWithdraw}
          onOpenWithdrawChange={setOpenWithdraw}
          enabled={isLemon}
          depositPresetAmount={hasDebt ? (depositShortfall ?? borrowedDisplay) : null}
        />

        {/* Spec 034 — repay celebration overlay (mini-app branch). */}
        <TransactionProgress
          state={repayTxState}
          errorMessage={repayTxError}
          onDismiss={() => {
            setRepayTxState('idle');
            setRepayTxError(undefined);
          }}
        />
      </TooltipProvider>
    );
  }

  // ===================== NON-MINI-APP: original sliding layout =====================
  const effectiveScreenKey = subView === 'terms' ? 'terms' : screenKey;
  const onBackToCreditLine = () => setSubView('main');

  return (
    <TooltipProvider delayDuration={150}>
      <SlidingScreens viewKey={effectiveScreenKey}>
        {subView === 'terms' ? (
          // ===================== VISTA DE TÉRMINOS =====================
          <div className="mx-auto w-full max-w-md pb-6 pt-4">
            <TermsAndConditionsCard
              isAccepted
              showBackToCreditLine
              onBackToCreditLine={onBackToCreditLine}
            />
          </div>
        ) : (
          // ===================== VISTA NORMAL (borrow/repay/cooldown) =====================
          <>
            {/* Panel principal */}
            <div className="mx-auto w-full max-w-md px-4 pb-6 pt-4 space-y-3">
              {mainBlock}
            </div>

            {/* Extras (score, performance, fondos) */}
            <CreditScoreShowcase />
            <CreditPerformanceStrip />
            <MiniAppFundsBox />
          </>
        )}
      </SlidingScreens>

      {/* Footer para volver a ver los TyC solo en la vista normal */}
      {subView === 'main' && (
        <div className="mx-auto w-full max-w-md px-4 pb-4 pt-2">
          <button
            type="button"
            onClick={() => setSubView('terms')}
            className="w-full text-center text-[11px] text-muted-foreground hover:underline underline-offset-2"
          >
            {t('borrow.market.viewTerms')}
          </button>
        </div>
      )}

      {/* Modal de logros (overlay) */}
      <AchievementDialog />

      {/*
       * Spec 034 — repay celebration overlay rendered at this level so
       * it survives RepayPanel's unmount (which happens the moment
       * `outstandingRaw` hits 0 right after a successful repay).
       * `onDismiss` resets state so the overlay can re-trigger on a
       * future repay within the same session.
       */}
      <TransactionProgress
        state={repayTxState}
        errorMessage={repayTxError}
        onDismiss={() => {
          setRepayTxState('idle');
          setRepayTxError(undefined);
        }}
      />
    </TooltipProvider>
  );
}
