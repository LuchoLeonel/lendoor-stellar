import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'borrow.repay.ctaConnect': 'Connect wallet',
        'borrow.repay.ctaPaying': 'Paying...',
        'borrow.repay.ctaPay': 'Pay',
        'borrow.repay.totalLabel': 'TOTAL DUE',
        'borrow.repay.lateFeeNote': 'Late fees accruing',
        'borrow.repay.depositButton': 'Deposit USDC',
        'borrow.repay.connectHint': 'Connect your wallet to pay',
        'borrow.repay.detailHeader': 'DETAILS',
        'borrow.repay.interestRow': 'Interest',
        'borrow.repay.balanceRow': 'Your balance',
        'borrow.repay.missingRow': 'Missing',
        'borrow.repay.termProgressLabel': 'Term progress',
        'borrow.repay.progressStart': 'Start',
        'borrow.repay.termProgressEnd': 'End',
        'borrow.market.creditActive': 'Active',
        'borrow.market.creditOverdue': 'Overdue',
      }
      if (params?.amount) return `Deposit ${params.amount} USDC`
      if (params?.rate) return `${params.rate}%`
      if (params?.days) return `${params.days} days`
      return map[key] ?? key
    },
  }),
}))

const mockSubmit = vi.fn().mockResolvedValue(true)
vi.mock('@/hooks/borrow/blockchain/useRepay', () => ({
  useRepay: () => ({ submit: mockSubmit, submitting: false }),
}))

vi.mock('@/providers/WalletProvider', () => ({
  useWallet: () => ({ isMiniApp: false, mode: 'webapp', primaryWallet: null }),
}))

// Spec 024 B.3 — RepayPanel now reads connectedAddress from ContractsProvider
// to wire the preflight live ticker. Tests don't need real contract wiring.
vi.mock('@/providers/ContractsProvider', () => ({
  useContracts: () => ({ connectedAddress: null }),
}))

// Spec 024 B.3 — preflight hook. Default: returns null (no preflight active),
// which keeps the existing static-amount UI behavior in tests.
vi.mock('@/hooks/borrow/blockchain/useRepayPreflight', () => ({
  useRepayPreflight: () => ({
    payload: null,
    displayRaw: null,
    displayHuman: null,
    perDayDelta: null,
    magnitudePct: null,
    daysToDefault: null,
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}))

vi.mock('@/hooks/useUsdcBalance', () => ({
  useUsdcBalance: () => ({
    raw: 100_000_000n, // 100 USDC
    decimals: 6,
    display: '100.00',
    loading: false,
  }),
}))

vi.mock('@/components/common/LemonFundsDialogs', () => ({
  LemonFundsDialogs: () => null,
}))

vi.mock('@/components/common/TransactionProgress', () => ({
  TransactionProgress: () => null,
  TxState: {},
}))

vi.mock('@/components/common/ConfirmationDialog', () => ({
  ConfirmationDialog: ({
    open,
    onConfirm,
    title,
  }: {
    open: boolean
    onConfirm: () => void
    title: string
  }) =>
    open ? (
      <div data-testid="confirm-dialog">
        <span>{title}</span>
        <button onClick={onConfirm}>Confirm</button>
      </div>
    ) : null,
}))

import { RepayPanel } from '../RepayPanel'

// ── Tests ────────────────────────────────────────────────────────────────────

describe('RepayPanel', () => {
  const baseProps = {
    isLoggedIn: true,
    loadingNetwork: false,
    onConnect: vi.fn(),
    outstandingAmount: '10.50',
    outstandingRaw: 10_500_000n,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── Display ──

  it('shows the outstanding amount', () => {
    render(<RepayPanel {...baseProps} />)
    expect(screen.getByText('10.50')).toBeInTheDocument()
    expect(screen.getByText('USDC')).toBeInTheDocument()
  })

  it('shows 0.00 when there is no debt', () => {
    render(<RepayPanel {...baseProps} outstandingAmount="0" outstandingRaw={0n} />)
    expect(screen.getByText('0.00')).toBeInTheDocument()
  })

  it('shows TOTAL DUE label', () => {
    render(<RepayPanel {...baseProps} />)
    expect(screen.getByText('TOTAL DUE')).toBeInTheDocument()
  })

  // ── Status ──

  it('shows Active status when not overdue', () => {
    render(<RepayPanel {...baseProps} />)
    expect(screen.getByText('Active')).toBeInTheDocument()
  })

  it('shows Overdue status when accruing late fees', () => {
    render(<RepayPanel {...baseProps} isAccruingLateFees />)
    expect(screen.getByText('Overdue')).toBeInTheDocument()
  })

  it('shows late fee warning when accruing', () => {
    render(<RepayPanel {...baseProps} isAccruingLateFees />)
    expect(screen.getByText('Late fees accruing')).toBeInTheDocument()
  })

  // ── CTA states ──

  it('shows Pay button when logged in with debt', () => {
    render(<RepayPanel {...baseProps} />)
    expect(screen.getByText('Pay')).toBeInTheDocument()
  })

  it('shows Connect wallet when not logged in', () => {
    render(<RepayPanel {...baseProps} isLoggedIn={false} />)
    expect(screen.getByText('Connect wallet')).toBeInTheDocument()
  })

  it('disables Pay button when no debt', () => {
    render(<RepayPanel {...baseProps} outstandingAmount="0" outstandingRaw={0n} />)
    const btn = screen.getByText('Pay').closest('button')
    expect(btn).toBeDisabled()
  })

  it('calls onConnect when not logged in and clicking CTA', async () => {
    const user = userEvent.setup()
    const onConnect = vi.fn()
    render(<RepayPanel {...baseProps} isLoggedIn={false} onConnect={onConnect} />)
    await user.click(screen.getByText('Connect wallet'))
    expect(onConnect).toHaveBeenCalled()
  })

  // ── Confirmation flow ──

  it('opens confirmation dialog on submit', async () => {
    const user = userEvent.setup()
    render(<RepayPanel {...baseProps} />)
    await user.click(screen.getByText('Pay'))
    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
  })

  // ── Progress bar ──

  it('shows term progress when daysRemaining and progressPct provided', () => {
    render(
      <RepayPanel {...baseProps} daysRemaining={5} termProgressPct={40} />,
    )
    expect(screen.getByText('Term progress')).toBeInTheDocument()
    expect(screen.getByText('40% transcurrido')).toBeInTheDocument()
  })

  it('hides progress bar when no timing info', () => {
    render(<RepayPanel {...baseProps} />)
    expect(screen.queryByText('Term progress')).not.toBeInTheDocument()
  })

  // ── Interest display ──

  it('shows interest rate when loanFeeBps provided', () => {
    render(<RepayPanel {...baseProps} loanFeeBps={429} />)
    expect(screen.getByText('Interest')).toBeInTheDocument()
    expect(screen.getByText('4.29%')).toBeInTheDocument()
  })
})
