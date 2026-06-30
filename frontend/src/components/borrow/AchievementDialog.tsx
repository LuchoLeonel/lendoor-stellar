// src/components/borrow/AchievementDialog.tsx
'use client';

import * as React from 'react';
import { CheckCircle2, Zap } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { useGamificationStore } from '@/stores/gamificationStore';
import { useTranslation } from '@/i18n/useTranslation';
import CountUp from '@/components/reactbits/CountUp';
import { getTierForScore } from '@/lib/tiers';
import type { ReputationGainPayload } from '@shared/types/api';

const ACHIEVEMENT_DIALOG_DELAY_MS = 1300;

// ===========================================================================
// AchievementDialog — shows either:
//   (A) A catalog achievement (FIRST_LOAN_REPAID, STREAK_THREE, etc.) with
//       title/description/xp from the backend.
//   (B) A reputation-points celebration for on-time repayments that did NOT
//       unlock a catalog achievement (spec 023 RepGainDialog branch).
//
// Priority rule (spec 023 §4.2.6): if both are present, (A) wins — the
// catalog copy is richer. The rep-gain payload is silently consumed on
// dialog close so it does not re-fire on next mount.
// ===========================================================================

export function AchievementDialog() {
  const latestAchievements = useGamificationStore((s) => s.latestAchievements);
  const setLatestAchievements = useGamificationStore(
    (s) => s.setLatestAchievements,
  );
  const pendingRepGain = useGamificationStore((s) => s.pendingRepGain);
  const setPendingRepGain = useGamificationStore((s) => s.setPendingRepGain);
  const { t } = useTranslation();

  const hasAchievements =
    Array.isArray(latestAchievements) && latestAchievements.length > 0;
  const hasRepGain =
    pendingRepGain != null && pendingRepGain.delta > 0;

  // Priority rule: if both are present, catalog wins. Consume rep-gain
  // silently when catalog dialog closes (handleClose).
  if (hasAchievements) {
    return (
      <CatalogAchievementDialog
        achievements={latestAchievements!}
        onClose={() => {
          setLatestAchievements(null);
          // Clear rep-gain too so it does not fire right after.
          setPendingRepGain(null);
        }}
        t={t}
      />
    );
  }

  if (hasRepGain) {
    return (
      <RepGainDialog
        payload={pendingRepGain}
        onClose={() => setPendingRepGain(null)}
        t={t}
      />
    );
  }

  return null;
}

// ===========================================================================
// (A) Catalog achievement dialog — visual layout unchanged from pre-spec-023
// ===========================================================================

type AchievementsList = NonNullable<
  ReturnType<typeof useGamificationStore.getState>['latestAchievements']
>;

function CatalogAchievementDialog({
  achievements,
  onClose,
  t,
}: {
  achievements: AchievementsList;
  onClose: () => void;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  const main = achievements[0];
  const extra = achievements.length > 1 ? achievements.slice(1) : [];

  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    setVisible(false);
    const timer = window.setTimeout(() => {
      setVisible(true);
    }, ACHIEVEMENT_DIALOG_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [achievements]);

  const handleClose = () => {
    setVisible(false);
    onClose();
  };

  if (!main) return null;

  return (
    <Dialog
      open={visible}
      onOpenChange={(isOpen) => {
        if (!isOpen) handleClose();
      }}
    >
      <DialogContent
        className="
          fixed left-1/2 top-1/2 z-50
          flex w-[calc(100%-2.5rem)] max-w-[340px]
          -translate-x-1/2 -translate-y-1/2
          flex-col rounded-2xl
          bg-white
          p-0 overflow-hidden
          shadow-xl
          outline-none
        "
        closeClassName="top-4 right-4 cursor-pointer"
        style={{
          border: '1px solid rgba(0,0,0,0.06)',
          boxShadow:
            '0 20px 60px rgba(0,0,0,0.15), 0 4px 16px rgba(0,0,0,0.08)',
        }}
      >
        <DialogTitle className="sr-only">{main.title}</DialogTitle>
        <DialogDescription className="sr-only">
          {main.description}
        </DialogDescription>

        {/* Top accent bar */}
        <div
          className="h-1 w-full"
          style={{ background: 'linear-gradient(90deg, #F97415, #fb923c)' }}
        />

        <div className="px-5 pt-5 pb-5">
          {/* Badge */}
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
              {t('borrow.achievements.badge')}
            </span>
          </div>

          {/* Title */}
          <h3 className="text-[18px] font-bold text-foreground leading-tight">
            {main.title}
          </h3>

          <p className="mt-1.5 text-[13px] leading-snug text-muted-foreground">
            {main.description}
          </p>

          {/* XP earned */}
          <div className="mt-4 rounded-xl bg-muted/30 border border-border/40 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-medium text-muted-foreground">
                {t('borrow.achievements.xpTitle')}
              </span>
              <span className="text-[14px] font-bold text-primary tabular-nums">
                +
                <CountUp to={main.xp} from={0} duration={1.2} className="inline" />{' '}
                XP
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground/80">
              {t('borrow.achievements.xpDescription')}
            </p>
          </div>

          {/* Extra achievements */}
          {extra.length > 0 && (
            <div className="mt-3 space-y-1.5">
              <p className="text-[11px] font-medium text-muted-foreground">
                {t('borrow.achievements.extraUnlocked', { count: extra.length })}
              </p>
              <ul className="max-h-32 space-y-1.5 overflow-y-auto">
                {extra.map((ach) => (
                  <li
                    key={ach.code}
                    className="flex items-center justify-between gap-2 rounded-lg bg-muted/20 px-3 py-1.5"
                  >
                    <span className="truncate text-[11px] text-foreground/70">
                      {ach.title}
                    </span>
                    <span className="text-[11px] font-semibold text-primary tabular-nums">
                      +{ach.xp} XP
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* CTA */}
          <button
            type="button"
            onClick={handleClose}
            className="mt-5 w-full h-[48px] rounded-2xl text-[15px] font-semibold text-white flex items-center justify-center active:scale-[0.98] transition-all"
            style={{
              backgroundColor: '#F97415',
              boxShadow: '0 4px 16px rgba(249,116,21,0.25)',
            }}
          >
            {t('borrow.achievements.ctaContinue')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ===========================================================================
// (B) RepGainDialog — spec 023. Same visual shell as CatalogAchievementDialog,
// different copy. Shown when the user earned reputation points without
// hitting a catalog achievement (e.g. their 7th on-time loan, which doesn't
// have its own achievement in the catalog).
// ===========================================================================

function RepGainDialog({
  payload,
  onClose,
  t,
}: {
  payload: ReputationGainPayload;
  onClose: () => void;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    setVisible(false);
    const timer = window.setTimeout(() => {
      setVisible(true);
    }, ACHIEVEMENT_DIALOG_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [payload]);

  const handleClose = () => {
    setVisible(false);
    onClose();
  };

  // Tier info for the icon (uses the user's new score from the backend).
  const tier = getTierForScore(payload.newScore);

  // Copy rule:
  //  - Group changed (e.g. 8→9, Confiable→Referente): "¡Alcanzaste X!"
  //  - Same group: "Seguís creciendo"
  // All copy via i18n keys (borrow.repGain.*). Subtitle never mentions
  // the credit limit or a USDC amount — only the reputation idea.
  const title =
    payload.groupChanged && payload.newGroupLabel
      ? t('borrow.repGain.titleGroupChange', { group: payload.newGroupLabel })
      : t('borrow.repGain.titleKeepGrowing');

  const subtitle = payload.groupChanged
    ? t('borrow.repGain.subtitleGroupChange')
    : t('borrow.repGain.subtitleKeepGrowing');

  return (
    <Dialog
      open={visible}
      onOpenChange={(isOpen) => {
        if (!isOpen) handleClose();
      }}
    >
      <DialogContent
        className="
          fixed left-1/2 top-1/2 z-50
          flex w-[calc(100%-2.5rem)] max-w-[340px]
          -translate-x-1/2 -translate-y-1/2
          flex-col rounded-2xl
          bg-white
          p-0 overflow-hidden
          shadow-xl
          outline-none
        "
        closeClassName="top-4 right-4 cursor-pointer"
        style={{
          border: '1px solid rgba(0,0,0,0.06)',
          boxShadow:
            '0 20px 60px rgba(0,0,0,0.15), 0 4px 16px rgba(0,0,0,0.08)',
        }}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{subtitle}</DialogDescription>

        {/* Top accent bar — same visual identity as CatalogAchievementDialog */}
        <div
          className="h-1 w-full"
          style={{ background: 'linear-gradient(90deg, #F97415, #fb923c)' }}
        />

        <div className="px-5 pt-5 pb-5">
          {/* Badge */}
          <div className="flex items-center gap-2 mb-4">
            <Zap className="h-4 w-4 text-primary" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
              {t('borrow.repGain.badge')}
            </span>
          </div>

          {/* Title with tier emoji */}
          <h3 className="text-[18px] font-bold text-foreground leading-tight">
            <span className="mr-1.5" aria-hidden>
              {tier.emoji}
            </span>
            {title}
          </h3>

          <p className="mt-1.5 text-[13px] leading-snug text-muted-foreground">
            {subtitle}
          </p>

          {/* Points earned */}
          <div className="mt-4 rounded-xl bg-muted/30 border border-border/40 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-medium text-muted-foreground">
                {t('borrow.repGain.pointsTitle')}
              </span>
              <span className="text-[14px] font-bold text-primary tabular-nums">
                +
                <CountUp
                  to={payload.delta}
                  from={0}
                  duration={1.2}
                  className="inline"
                />{' '}
                {t('borrow.repGain.pointsUnit')}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground/80">
              {t('borrow.repGain.pointsDescription')}
            </p>
          </div>

          {/* CTA */}
          <button
            type="button"
            onClick={handleClose}
            className="mt-5 w-full h-[48px] rounded-2xl text-[15px] font-semibold text-white flex items-center justify-center active:scale-[0.98] transition-all"
            style={{
              backgroundColor: '#F97415',
              boxShadow: '0 4px 16px rgba(249,116,21,0.25)',
            }}
          >
            {t('borrow.repGain.ctaContinue')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
