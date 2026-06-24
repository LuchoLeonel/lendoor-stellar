// hooks/balances/useUsdcBalance.ts
'use client'

import * as React from 'react'
import { Contract } from 'ethers'

import { useContracts } from '@/providers/ContractsProvider'
import { useWallet } from '@/providers/WalletProvider'
import { formatAmount } from '@/lib/utils'
import { safeRead } from '@/lib/safeRead'

const ERC20_MIN_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
] as const

export function useUsdcBalance(pollMs = 10_000) {
  const { usdcAddress, usdcDecimals, connectedAddress, evault } = useContracts()
  const { primaryWallet } = useWallet()

  // runner = provider que ya estás usando para evault (rpc / signer)
  const runner = (evault as unknown as Record<string, unknown>)?.runner ?? undefined

  const [raw, setRaw] = React.useState<bigint | null>(null)
  const [decimals, setDecimals] = React.useState<number | null>(usdcDecimals ?? null)
  const [display, setDisplay] = React.useState<string>('—')
  const [loading, setLoading] = React.useState(false)

  // address que vamos a usar para balanceOf
  const primaryAddress = primaryWallet?.address ?? null
  const walletAddress = React.useMemo(() => {
    const addr = connectedAddress ?? primaryAddress
    return addr ? addr.toLowerCase() : null
  }, [connectedAddress, primaryAddress])

  const token = React.useMemo(() => {
    if (!runner || !usdcAddress) return null
    return new Contract(usdcAddress, ERC20_MIN_ABI, runner)
  }, [runner, usdcAddress])

  const read = React.useCallback(async () => {
    if (!token || !walletAddress) {
      setRaw(null)
      setDisplay('—')
      return
    }

    setLoading(true)
    try {
      const dec =
        decimals ??
        (await safeRead(
          async () => Number(await token.decimals()),
          6,
          'usdc:decimals',
          { toastOnError: false },
        ))

      if (decimals == null) setDecimals(dec)

      // Spec 033 follow-up — never reset to 0n on transient RPC failure.
      // Previous behavior used 0n as the safeRead fallback, which made
      // a failed poll silently set `raw = 0n`. RepayPanel then computed
      // `diff = outstandingRaw - 0n = full amountDue`, displaying e.g.
      // "Cargá 24.91 USDC" instead of "Cargá 0.91 USDC", before the
      // next successful poll restored the real balance — visible blink.
      //
      // Using `null` as the fallback lets us detect failure and skip
      // the setRaw call, preserving the last confirmed bigint value.
      const bal = await safeRead<bigint | null>(
        () => token.balanceOf(walletAddress) as Promise<bigint>,
        null,
        'usdc:balanceOf',
      )

      if (bal == null) {
        // RPC failed — keep previous raw/display, just clear loading.
        return
      }

      setRaw(bal)

      // exactamente 2 decimales (half-up), bigint-safe
      const pretty = formatAmount(bal, dec, 2, 2)
      setDisplay(prev => (prev === pretty ? prev : pretty))
    } catch {
      // On transient RPC errors, keep the previous raw/display values so
      // consumers do not see a flicker caused by a momentary null balance.
      // loading is cleared in finally so callers know the fetch completed.
    } finally {
      setLoading(false)
    }
  }, [token, walletAddress, decimals])

  React.useEffect(() => {
    void read()
    if (!pollMs || pollMs <= 0) return
    const id = setInterval(() => {
      void read()
    }, pollMs)
    return () => {
      clearInterval(id)
    }
  }, [read, pollMs])

  // Live refresh when transfers affect this address
  React.useEffect(() => {
    if (!token || !walletAddress) return
    const lower = walletAddress.toLowerCase()
    const onTransfer = (from: string, to: string) => {
      if (from?.toLowerCase() === lower || to?.toLowerCase() === lower) {
        void read()
      }
    }
    token.on('Transfer', onTransfer)
    return () => {
      token.off('Transfer', onTransfer)
    }
  }, [token, walletAddress, read])

  return { raw, decimals, display, loading, refresh: read }
}
