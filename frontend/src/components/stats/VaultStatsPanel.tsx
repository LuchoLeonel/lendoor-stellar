'use client'

import { useVaultStats } from '@/hooks/lend/useVaultStats'
import { CumulativeMetricCard } from '@/components/stats/CumulativeMetricCard'
import { useProtocolStat } from '@/hooks/stats/useProtocolStat'
import { formatCountFromBigIntString } from '@/lib/format'
import { BorrowRepayActivityList } from "@/components/stats/BorrowRepayActivityList"
import { useTranslation } from '@/i18n/useTranslation'
import { SpotlightCard } from '@/components/reactbits/SpotlightCard'
import { AnimatedContent } from '@/components/reactbits/AnimatedContent'

export function VaultStatsPanel() {
  const { t } = useTranslation()
  const {
    totalAssetsDisplay,
    totalAssetsRaw,
    loading: loadingVault,
  } = useVaultStats()

  const {
    stat,
    loading: loadingProtocol,
    error: protocolError,
  } = useProtocolStat()

  const loansText =
    loadingProtocol ? '—' : formatCountFromBigIntString(stat?.loansOriginated)

  // Capital turnover = principal originado (lifetime) / assets en el vault (hoy).
  // Mide cuántas veces el capital del vault fue prestado. Both values use 6
  // decimals (USDC), so the ratio cancels out decimals cleanly.
  // Shown only when both are loaded AND totalAssets > 0 (avoid div-by-zero).
  const turnoverText = (() => {
    if (loadingVault || loadingProtocol) return '—'
    if (!stat?.principalOriginated || !totalAssetsRaw) return '—'
    try {
      const originated = BigInt(stat.principalOriginated)
      if (totalAssetsRaw === 0n) return '—'
      // Preserve one decimal via ×10 math entirely in bigint, then format.
      const ratioTenths = (originated * 10n) / totalAssetsRaw
      const whole = Number(ratioTenths / 10n)
      const tenth = Number(ratioTenths % 10n)
      return `${whole}.${tenth}×`
    } catch {
      return '—'
    }
  })()

  return (
    <div className="max-w-4xl mx-auto space-y-6">

      {/* Page title */}
      <AnimatedContent delay={0}>
        <div className="mb-2">
          <h1 className="text-2xl md:text-3xl font-bold text-foreground tracking-tight">
            {t('stats.pageTitle')}
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">
            {t('stats.pageSubtitle')}
          </p>
        </div>
      </AnimatedContent>

      {/* Top row — Capital Turnover, Total Assets, Loans Originated */}
      <AnimatedContent delay={0.05}>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          <SpotlightCard className="p-5 md:p-6">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
              {t('stats.capitalTurnover.title')}
            </p>
            <p className="text-2xl md:text-3xl font-bold text-foreground font-mono">
              {turnoverText}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {t('stats.capitalTurnover.hint')}
            </p>
          </SpotlightCard>

          <SpotlightCard className="p-5 md:p-6">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
              {t('stats.totalAssets')}
            </p>
            <p className="text-2xl md:text-3xl font-bold text-foreground font-mono">
              {loadingVault ? '—' : `$${totalAssetsDisplay}`}
            </p>
            <p className="text-xs text-muted-foreground mt-1">USDC</p>
          </SpotlightCard>

          <SpotlightCard className="p-5 md:p-6">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
              {t('stats.loansOriginated')}
            </p>
            <p className="text-2xl md:text-3xl font-bold text-foreground font-mono">
              {loansText}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {t('stats.loansOriginatedHint')}
            </p>
          </SpotlightCard>
        </div>
      </AnimatedContent>

      {/* Cumulative charts — Principal Originated | Borrowers | Interest Earned */}
      <AnimatedContent delay={0.1}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-xl border border-border/50 bg-background p-5 md:p-6 shadow-sm">
            <CumulativeMetricCard metric="principalOriginated" compact />
          </div>
          <div className="rounded-xl border border-border/50 bg-background p-5 md:p-6 shadow-sm">
            <CumulativeMetricCard metric="uniqueBorrowers" compact />
          </div>
          <div className="rounded-xl border border-border/50 bg-background p-5 md:p-6 shadow-sm">
            <CumulativeMetricCard metric="interestRepaid" compact />
          </div>
        </div>
      </AnimatedContent>

      {/* Error */}
      {protocolError && (
        <div className="text-xs text-red-500 px-2">
          {t('stats.loadError')}: {protocolError}
        </div>
      )}

      {/* Activity — plain div instead of SpotlightCard to avoid overflow-hidden blocking scroll */}
      <AnimatedContent delay={0.15}>
        <div className="relative rounded-xl border border-border bg-card shadow-sm p-5 md:p-6 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-foreground">{t('stats.activityTitle')}</h3>
          </div>
          <BorrowRepayActivityList maxHeight={350} />
        </div>
      </AnimatedContent>

    </div>
  )
}
