// src/providers/WalletProvider.tsx
'use client'

import * as React from 'react'
import {
  createContext,
  useContext,
  useMemo,
  type PropsWithChildren,
} from 'react'
import { useAccount, useConnect } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'

import { getNetworkDetails } from '@stellar/freighter-api'
import { isWebView as lemonIsWebView } from '@lemoncash/mini-app-sdk'
import { useFarcaster } from '@/providers/FarcasterProvider'
import type { WalletMode } from '@shared/types/platform'
import {
  getFreighterStatus,
  isStellarMode,
  requestFreighterAddress,
  type StellarWalletStatus,
} from '@/lib/stellar-wallet'
import { normalizeWalletAddress } from '@/lib/wallet-address'
import { dedupeToast as toast } from '@/lib/dedupeToast'

export type { WalletMode }

const DEBUG_WALLET = import.meta.env.VITE_DEBUG_WALLET === 'true'

type PrimaryWallet = {
  address: string
  chainId: number | null
}

type WalletContextType = {
  mode: WalletMode

  // flags de entorno
  isMiniApp: boolean
  isLemonMiniApp: boolean
  isFarcasterMiniApp: boolean

  // auth / conexión
  isLoggedIn: boolean
  sdkHasLoaded: boolean
  primaryWallet: PrimaryWallet | null
  loadingNetwork: boolean
  stellarLoading: boolean

  // abrir modal de conexión en web
  setShowAuthFlow: () => void
}

const WalletContext = createContext<WalletContextType | undefined>(undefined)

// eslint-disable-next-line react-refresh/only-export-components
export const useWallet = () => {
  const ctx = useContext(WalletContext)
  if (!ctx) {
    throw new Error('useWallet must be used within WalletProvider')
  }
  return ctx
}

function safeIsLemonMiniApp(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return lemonIsWebView() === true
  } catch {
    return false
  }
}

export function WalletProvider({ children }: PropsWithChildren) {
  const { address, chainId, status } = useAccount()
  const { connect, connectors } = useConnect()
  const { isMiniApp: isFarcasterMiniApp } = useFarcaster()
  const openConnectModal = useConnectModal()?.openConnectModal
  const stellarMode = isStellarMode()

  // Primero vemos Farcaster, y solo si NO es Farcaster dejamos pasar a Lemon
  const rawLemonMiniApp = safeIsLemonMiniApp()
  const isLemonMiniApp = rawLemonMiniApp && !isFarcasterMiniApp

  const isMiniApp = isLemonMiniApp || isFarcasterMiniApp

  const [sdkHasLoaded, setSdkHasLoaded] = React.useState(false)
  const [stellarStatus, setStellarStatus] =
    React.useState<StellarWalletStatus | null>(null)
  const [stellarLoading, setStellarLoading] = React.useState(false)

  React.useEffect(() => {
    setSdkHasLoaded(true)
  }, [])

  const refreshFreighter = React.useCallback(async () => {
    if (!stellarMode) return
    setStellarLoading(true)
    try {
      setStellarStatus(await getFreighterStatus())
    } catch (err) {
      console.warn('[WalletProvider] Freighter status error', err)
      setStellarStatus((current) => ({
        installed: current?.installed ?? false,
        address: current?.address ?? null,
        network: current?.network ?? null,
        networkPassphrase: current?.networkPassphrase ?? null,
        sorobanRpcUrl: current?.sorobanRpcUrl ?? null,
      }))
    } finally {
      setStellarLoading(false)
    }
  }, [stellarMode])

  React.useEffect(() => {
    void refreshFreighter()
  }, [refreshFreighter])

  const connectFreighter = React.useCallback(async () => {
    if (stellarLoading) return
    setStellarLoading(true)
    try {
      const address = await requestFreighterAddress()
      const details = await getNetworkDetails().catch(() => ({
        network: null,
        networkPassphrase: null,
        sorobanRpcUrl: null,
      }))
      setStellarStatus({
        installed: true,
        address,
        network: details.network ?? null,
        networkPassphrase: details.networkPassphrase ?? null,
        sorobanRpcUrl: details.sorobanRpcUrl ?? null,
      })
      console.log('[WalletProvider] Freighter connected', address)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to connect Freighter'
      console.error('[WalletProvider] Freighter connect error', err)
      toast.error(message)
    } finally {
      setStellarLoading(false)
    }
  }, [refreshFreighter, stellarLoading])

  const loadingNetwork =
    status === 'connecting' || status === 'reconnecting' || stellarLoading

  // Autoconnect en Farcaster mini-app para que wagmi exponga la address
  React.useEffect(() => {
    if (!isFarcasterMiniApp) return
    if (
      status === 'connected' ||
      status === 'connecting' ||
      status === 'reconnecting'
    ) {
      return
    }

    const fcConnector = connectors[0] // lo tenés primero en el createConfig
    if (!fcConnector) return

    try {
      void connect({ connector: fcConnector })
    } catch (err) {
      console.error('[WalletProvider] Farcaster autoconnect error', err)
    }
  }, [isFarcasterMiniApp, status, connect, connectors])

  // - Lemon mini-app: loggedIn siempre true
  // - Web / Farcaster: loggedIn solo cuando wagmi está "connected"
  const stellarAddress = stellarStatus?.address ?? null
  const isLoggedIn =
    isLemonMiniApp || (stellarMode ? !!stellarAddress : status === 'connected')

  // === mode para el resto de la app ===
  let mode: WalletMode = 'none'
  if (stellarMode) mode = 'stellar'
  else if (isLemonMiniApp) mode = 'lemon'
  else if (isFarcasterMiniApp) mode = 'farcaster'
  else if (status === 'connected') mode = 'webapp'

  React.useEffect(() => {
    if (!DEBUG_WALLET) return
    console.log('[WalletProvider] mode=', mode, {
      isLemonMiniApp,
      isFarcasterMiniApp,
      stellarMode,
      stellarAddress,
      status,
      address,
    })
  }, [
    mode,
    isLemonMiniApp,
    isFarcasterMiniApp,
    stellarMode,
    stellarAddress,
    status,
    address,
  ])

  const value = useMemo<WalletContextType>(
    () => ({
      mode,
      isMiniApp,
      isLemonMiniApp,
      isFarcasterMiniApp,
      isLoggedIn,
      sdkHasLoaded,
      primaryWallet:
        stellarMode && stellarAddress
          ? { address: stellarAddress, chainId: null }
          : address
            ? {
                address: normalizeWalletAddress(address, mode) ?? address,
                chainId: chainId ?? null,
              }
            : null,
      loadingNetwork,
      stellarLoading: stellarMode ? stellarLoading : false,
      setShowAuthFlow: stellarMode
        ? () => {
            void connectFreighter()
          }
        : openConnectModal ?? (() => {
            console.warn('[WalletProvider] openConnectModal not available yet')
          }),
    }),
    [
      mode,
      isMiniApp,
      isLemonMiniApp,
      isFarcasterMiniApp,
      isLoggedIn,
      sdkHasLoaded,
      stellarMode,
      stellarAddress,
      address,
      chainId,
      loadingNetwork,
      connectFreighter,
      openConnectModal,
      stellarLoading,
    ],
  )

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  )
}
