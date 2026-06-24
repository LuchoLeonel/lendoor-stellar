'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */

import * as React from 'react'
import { Contract } from 'ethers'
import { useContracts } from '@/providers/ContractsProvider'
import { safeRead } from '@/lib/safeRead'

const ONE_RAY = 10n ** 27n
const SECONDS_PER_YEAR = 31_536_000

const EVAULT_PPS_ABI = [
  'function psSeniorRay() view returns (uint256)',
  'function debugPps() view returns (uint256 psSen, uint256 psJun)',
] as const

const EVAULT_IRM_ABI = [
  'function interestRateModel() view returns (address)',
  'function irm() view returns (address)',
  'function IRM() view returns (address)',
  'function integrations() view returns (address evc,address irm,address oracle,address riskManager)',
] as const

const IIRM_ABI = [
  'function computeInterestRateView(address vault,uint256 cash,uint256 borrows) view returns (uint256)',
] as const

type Options = { pollMs?: number; minSampleSec?: number }

type Result = {
  apr: number | null
  apy: number | null
  displayAPR: string
  displayAPY: string
  source: 'irm' | 'pps' | 'none'
  irmAddress: `0x${string}` | null
  loading: boolean
  refresh: () => Promise<void>
}

const fmtPct = (x: number | null) => (x == null ? '—' : `${(x * 100).toFixed(2)}%`)
const isZeroAddr = (a?: string) => !a || a === '0x0000000000000000000000000000000000000000'

export function useSeniorYield({ pollMs = 30_000, minSampleSec = 10 }: Options = {}): Result {
  const { evault, evaultAddress } = useContracts()

  const [apr, setApr] = React.useState<number | null>(null)
  const [apy, setApy] = React.useState<number | null>(null)
  const [source, setSource] = React.useState<'irm' | 'pps' | 'none'>('none')
  const [irmAddress, setIrmAddress] = React.useState<`0x${string}` | null>(null)
  const [loading, setLoading] = React.useState(false)

  const prevRef = React.useRef<{ pps: bigint; t: number } | null>(null)

  const getRunner = React.useCallback(() => {
    return (evault as any)?.runner ?? (evault as any)?.provider ?? null
  }, [evault])

  const discoverIRM = React.useCallback(async (): Promise<`0x${string}` | null> => {
    if (!evaultAddress) return null
    const runner = getRunner()
    if (!runner) return null
    const v = new Contract(evaultAddress, EVAULT_IRM_ABI as any, runner)

    const ZERO = '0x0000000000000000000000000000000000000000'

    // Fire all discovery attempts in parallel
    const [a1, a2, a3, integrations] = await Promise.allSettled([
      safeRead(() => (v as any).interestRateModel(), ZERO, 'srYield:interestRateModel', { toastOnError: false }),
      safeRead(() => (v as any).irm(), ZERO, 'srYield:irm', { toastOnError: false }),
      safeRead(() => (v as any).IRM(), ZERO, 'srYield:IRM', { toastOnError: false }),
      safeRead(() => (v as any).integrations(), null as any, 'srYield:integrations', { toastOnError: false }),
    ])

    // Return the first valid address found (in priority order)
    for (const r of [a1, a2, a3]) {
      if (r.status === 'fulfilled' && !isZeroAddr(r.value as string)) {
        return r.value as `0x${string}`
      }
    }

    if (integrations.status === 'fulfilled' && integrations.value) {
      const a4: string | undefined = integrations.value?.irm ?? integrations.value?.[1]
      if (!isZeroAddr(a4)) return a4 as `0x${string}`
    }

    return null
  }, [evaultAddress, getRunner])

  const readPpsRay = React.useCallback(async (): Promise<bigint | null> => {
    if (!evaultAddress) return null
    try {
      const runner = getRunner()
      if (!runner) return null
      const v = new Contract(evaultAddress, EVAULT_PPS_ABI as any, runner)

      try {
        const out: any = await safeRead(
          () => (v as any).debugPps(),
          null as any,
          'srYield:debugPps',
          { toastOnError: false },
        )
        const ps: bigint | undefined = out?.psSen ?? out?.[0]
        if (ps && ps > 0n) return ps
      } catch { /* debugPps not available — fall through */ }
      const ps: bigint = await safeRead(
        () => (v as any).psSeniorRay(),
        0n,
        'srYield:psSeniorRay',
        { toastOnError: false },
      )
      return ps > 0n ? ps : null
    } catch {
      return null
    }
  }, [evaultAddress, getRunner])

  const readFromIRM = React.useCallback(
    async (irm: `0x${string}` | null): Promise<boolean> => {
      if (!irm || !evaultAddress) return false
      try {
        const runner = getRunner()
        if (!runner) return false
        const irmC = new Contract(irm, IIRM_ABI as any, runner)
        const rateRay: bigint = await safeRead(
          () => (irmC as any).computeInterestRateView(evaultAddress, 0, 0),
          0n,
          'srYield:irmRate',
        )
        if (!rateRay || rateRay === 0n) return false

        const rps = Number(rateRay.toString()) / Number(ONE_RAY.toString())
        const apr_ = rps * SECONDS_PER_YEAR
        const apy_ = Math.expm1(rps * SECONDS_PER_YEAR)

        setApr(apr_)
        setApy(apy_)
        setSource('irm')
        return true
      } catch {
        return false
      }
    },
    [evaultAddress, getRunner],
  )

  const readFromPpsDelta = React.useCallback(async (): Promise<boolean> => {
    const ps = await readPpsRay()
    if (ps == null || ps === 0n) return false

    const now = Math.floor(Date.now() / 1000)
    const prev = prevRef.current
    prevRef.current = { pps: ps, t: now }
    if (!prev || now <= prev.t) return false

    const dt = now - prev.t
    if (dt < minSampleSec || ps === prev.pps) return false

    const SCALE = 1_000_000_000_000n
    const dScaled = (ps - prev.pps) * SCALE / prev.pps
    const ratio = Number(dScaled) / Number(SCALE)

    const rps = ratio / dt
    const apr_ = rps * SECONDS_PER_YEAR
    const apy_ = Math.expm1(rps * SECONDS_PER_YEAR)

    setApr(apr_)
    setApy(apy_)
    setSource('pps')
    return true
  }, [minSampleSec, readPpsRay])

  const refresh = React.useCallback(async () => {
    setLoading(true)
    try {
      let irm = irmAddress
      if (!irm) {
        irm = await discoverIRM()
        setIrmAddress(irm)
      }
      if (await readFromIRM(irm)) return
      if (await readFromPpsDelta()) return
      setSource('none')
    } finally {
      setLoading(false)
    }
  }, [irmAddress, discoverIRM, readFromIRM, readFromPpsDelta])

  React.useEffect(() => {
    void refresh()
    if (!pollMs || pollMs <= 0) return
    const id = setInterval(() => void refresh(), pollMs)
    return () => clearInterval(id)
  }, [refresh, pollMs])

  return {
    apr,
    apy,
    displayAPR: fmtPct(apr),
    displayAPY: fmtPct(apy),
    source,
    irmAddress,
    loading,
    refresh,
  }
}