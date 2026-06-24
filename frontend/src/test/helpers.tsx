// src/test/helpers.tsx
// Shared test utilities and mocks for component tests
import { vi } from 'vitest'

/**
 * Mock useTranslation — returns the key as-is so tests can assert on translation keys.
 * Must be called in vi.mock() before imports.
 */
export function mockTranslation() {
  vi.mock('@/i18n/useTranslation', () => ({
    useTranslation: () => ({
      t: (key: string, params?: Record<string, unknown>) => {
        if (params) return `${key}|${JSON.stringify(params)}`
        return key
      },
    }),
  }))
}

/**
 * Mock useWallet — returns a disconnected web wallet by default.
 */
export function mockWallet(overrides: Record<string, unknown> = {}) {
  vi.mock('@/providers/WalletProvider', () => ({
    useWallet: () => ({
      mode: 'webapp' as const,
      isMiniApp: false,
      isLemonMiniApp: false,
      isFarcasterMiniApp: false,
      isLoggedIn: false,
      sdkHasLoaded: true,
      primaryWallet: null,
      loadingNetwork: false,
      setShowAuthFlow: vi.fn(),
      ...overrides,
    }),
  }))
}
