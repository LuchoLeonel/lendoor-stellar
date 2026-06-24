import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'common.errorBoundary.toastTitle': 'Something went wrong',
        'common.errorBoundary.uiTitle': 'Oops!',
        'common.errorBoundary.uiBody': 'An error occurred.',
        'common.errorBoundary.reloadCta': 'Reload',
      }
      return map[key] ?? key
    },
  }),
}))

vi.mock('@/providers/WalletProvider', () => ({
  useWallet: () => ({ mode: 'webapp' }),
}))

vi.mock('@/lib/dedupeToast', () => ({
  dedupeToast: { error: vi.fn(), success: vi.fn() },
}))

// Suppress console.error from React for the error boundary tests
const originalError = console.error
beforeEach(() => {
  console.error = vi.fn()
})

import AppErrorBoundary from '../AppErrorBoundary'

function ThrowingChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('Test crash')
  return <div>Child is fine</div>
}

describe('AppErrorBoundary', () => {
  afterAll(() => {
    console.error = originalError
  })

  it('renders children when no error', () => {
    render(
      <AppErrorBoundary>
        <ThrowingChild shouldThrow={false} />
      </AppErrorBoundary>,
    )
    expect(screen.getByText('Child is fine')).toBeInTheDocument()
  })

  it('renders error UI when child throws', () => {
    render(
      <AppErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </AppErrorBoundary>,
    )
    expect(screen.getByText('Oops!')).toBeInTheDocument()
    expect(screen.getByText('An error occurred.')).toBeInTheDocument()
  })

  it('renders a reload button in error state', () => {
    render(
      <AppErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </AppErrorBoundary>,
    )
    expect(
      screen.getByRole('button', { name: 'Reload' }),
    ).toBeInTheDocument()
  })

  it('does not render children when in error state', () => {
    render(
      <AppErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </AppErrorBoundary>,
    )
    expect(screen.queryByText('Child is fine')).not.toBeInTheDocument()
  })

  it('logs error to server via fetch', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response())

    render(
      <AppErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </AppErrorBoundary>,
    )

    expect(fetchSpy).toHaveBeenCalledWith(
      '/__client-log',
      expect.objectContaining({ method: 'POST' }),
    )
    fetchSpy.mockRestore()
  })

  it('reload button triggers window.location.reload', async () => {
    const user = userEvent.setup()
    const reloadMock = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload: reloadMock },
      writable: true,
    })

    render(
      <AppErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </AppErrorBoundary>,
    )

    await user.click(screen.getByRole('button', { name: 'Reload' }))
    expect(reloadMock).toHaveBeenCalled()
  })
})
