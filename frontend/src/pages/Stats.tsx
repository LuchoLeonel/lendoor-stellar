'use client'

import { VaultStatsPanel } from '@/components/stats/VaultStatsPanel'
import { B2BStatsHeader } from '@/components/stats/B2BStatsHeader'
import { CohortChart } from '@/components/stats/CohortChart'
import { TrustSignals } from '@/components/stats/TrustSignals'

export default function StatsPage() {
  return (
    <div className="relative min-h-[calc(100dvh-4rem)] overflow-hidden bg-white">
      <div className="relative z-10 mx-auto w-full max-w-5xl pt-8 pb-12 px-4 sm:px-6">
        {/* Capa B2B-friendly arriba: KPIs partner-readable + cohort chart */}
        <B2BStatsHeader />
        <CohortChart />

        {/* Panel detallado del vault — para LPs / data nerds */}
        <div className="mt-12 pt-8 border-t border-zinc-200">
          <p className="text-xs uppercase tracking-widest text-zinc-500 mb-2 font-semibold">
            Detalle del vault
          </p>
          <h2 className="text-2xl font-bold text-zinc-900 mb-6">
            Salud del pool y actividad reciente
          </h2>
          <VaultStatsPanel />
        </div>

        {/* Footer: contratos on-chain, audit, contacto */}
        <TrustSignals />
      </div>
    </div>
  )
}
