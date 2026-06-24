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

import { isWebView as lemonIsWebView } from '@lemoncash/mini-app-sdk'
import { useFarcaster } from '@/providers/FarcasterProvider'
import type { WalletMode } from '@shared/types/platform'

export type { WalletMode }

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

  // Primero vemos Farcaster, y solo si NO es Farcaster dejamos pasar a Lemon
  const rawLemonMiniApp = safeIsLemonMiniApp()
  const isLemonMiniApp = rawLemonMiniApp && !isFarcasterMiniApp

  const isMiniApp = isLemonMiniApp || isFarcasterMiniApp

  const [sdkHasLoaded, setSdkHasLoaded] = React.useState(false)

  React.useEffect(() => {
    setSdkHasLoaded(true)
  }, [])

  const loadingNetwork =
    status === 'connecting' || status === 'reconnecting'

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
  const isLoggedIn = isLemonMiniApp || status === 'connected'

  // === mode para el resto de la app ===
  let mode: WalletMode = 'none'
  if (isLemonMiniApp) mode = 'lemon'
  else if (isFarcasterMiniApp) mode = 'farcaster'
  else if (status === 'connected') mode = 'webapp'

  React.useEffect(() => {
    console.log('[WalletProvider] mode=', mode, {
      isLemonMiniApp,
      isFarcasterMiniApp,
      status,
      address,
    })
  }, [mode, isLemonMiniApp, isFarcasterMiniApp, status, address])

  const value = useMemo<WalletContextType>(
    () => ({
      mode,
      isMiniApp,
      isLemonMiniApp,
      isFarcasterMiniApp,
      isLoggedIn,
      sdkHasLoaded,
      primaryWallet: address
        ? { address: address.toLowerCase(), chainId: chainId ?? null }
        : null,
      loadingNetwork,
      setShowAuthFlow: openConnectModal ?? (() => {
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
      address,
      chainId,
      loadingNetwork,
      openConnectModal,
    ],
  )

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  )
}
