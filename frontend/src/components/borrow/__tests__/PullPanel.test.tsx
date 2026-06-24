import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'borrow.pull.title': 'Request credit',
        'borrow.pull.subtitle': 'Choose how much',
        'borrow.pull.amountHeader': 'AMOUNT',
        'borrow.pull.amountHelper': 'Select with the slider',
        'borrow.pull.noCredit': 'No credit available',
        'borrow.pull.termsTitle': 'Choose term',
        'borrow.pull.confirmAndContinue': 'Confirm',
        'borrow.pull.back': 'Back',
        'borrow.pull.confirmProcessing': 'Processing...',
        'borrow.pull.termsExplanation': 'Interest explanation',
        'borrow.pull.termPopular': 'Popular',
      }
      if (params?.score) return `Score: ${params.score}`
      if (params?.amount && key.includes('sliderMax')) return `Max: ${params.amount}`
      if (params?.amount && key.includes('selected')) return `${params.amount} USDC`
      if (params?.amount && key.includes('limit')) return `Limit: ${params.amount}`
      if (params?.days && key.includes('termDays')) return `${params.days} days`
      if (params?.rate) return `${params.rate}% interest`
      if (params?.max) return `Max: ${params.max}`
      return map[key] ?? key
    },
  }),
}))

const mockUsePullPanel = {
  isVerified: true,
  isLemon: false,
  cta: 'Continue',
  isDisabled: false,
  verifyError: null,
  isBorrowing: false,
  hasAvailable: true,
  availableAmountToShow: '25',
  termOpen: false,
  handleDialogOpenChange: vi.fn(),
  handleSubmit: vi.fn((e?: { preventDefault?: () => void }) => { e?.preventDefault?.() }),
  confirmTermAndBorrow: vi.fn(),
  loanTerms: [
    { days: 7, periodRatePercent: 5.83, interestAmount: 0.58, finalAmount: 10.58 },
    { days: 14, periodRatePercent: 8.17, interestAmount: 0.82, finalAmount: 10.82 },
    { days: 21, periodRatePercent: 10.5, interestAmount: 1.05, finalAmount: 11.05 },
  ],
  selectedTermIndex: 0,
  setSelectedTermIndex: vi.fn(),
  baseAmountToShow: '10',
  verifyingLemon: false,
  loadingTerms: false,
  requestedAmountHuman: '10',
  maxBorrowUnits: 25,
  requestedUnits: 10,
  setRequestedUnits: vi.fn(),
  authLoading: false,
}

vi.mock('@/hooks/borrow/backend/usePullPanel', () => ({
  usePullPanel: () => mockUsePullPanel,
  formatAmountHuman: (v: number) => v.toFixed(2),
  PullPanelProps: {},
}))

vi.mock('@/stores/creditStore', () => ({
  useCreditStore: (selector: (s: { creditScoreDisplay: string }) => string) =>
    selector({ creditScoreDisplay: '3' }),
}))

vi.mock('@/components/common/ConfirmationDialog', () => ({
  ConfirmationDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="confirm-dialog">Confirm</div> : null,
}))

vi.mock('@/components/common/TransactionProgress', () => ({
  TransactionProgress: () => null,
  TxState: {},
}))

import { PullPanel } from '../PullPanel'

// ── Tests ────────────────────────────────────────────────────────────────────

const baseProps = {
  isLoggedIn: true,
  loadingNetwork: false,
  onConnect: vi.fn(),
  onPull: vi.fn(),
  availableAmount: '25',
  lineDisplay: '25 USDC',
  setShowQR: vi.fn(),
}

describe('PullPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUsePullPanel.termOpen = false
    mockUsePullPanel.isBorrowing = false
    mockUsePullPanel.maxBorrowUnits = 25
  })

  // ── Amount screen ──

  it('renders the title', () => {
    render(<PullPanel {...baseProps} />)
    expect(screen.getByText('Request credit')).toBeInTheDocument()
  })

  it('shows the requested amount in the hero display', () => {
    render(<PullPanel {...baseProps} />)
    // The amount appears in a large font span inside the amount card
    const amountElements = screen.getAllByText('10')
    expect(amountElements.length).toBeGreaterThanOrEqual(1)
  })

  it('shows score label', () => {
    render(<PullPanel {...baseProps} />)
    expect(screen.getByText('Score: 3')).toBeInTheDocument()
  })

  it('shows "no credit" message when maxBorrowUnits is 0', () => {
    mockUsePullPanel.maxBorrowUnits = 0
    render(<PullPanel {...baseProps} />)
    expect(screen.getByText('No credit available')).toBeInTheDocument()
  })

  it('disables CTA when no credit available', () => {
    mockUsePullPanel.maxBorrowUnits = 0
    render(<PullPanel {...baseProps} />)
    const btn = screen.getByText('Continue').closest('button')
    expect(btn).toBeDisabled()
  })

  it('calls handleSubmit when clicking Continue', async () => {
    const user = userEvent.setup()
    render(<PullPanel {...baseProps} />)
    await user.click(screen.getByText('Continue'))
    expect(mockUsePullPanel.handleSubmit).toHaveBeenCalled()
  })

  // ── Term screen ──

  it('shows term selection when termOpen is true', () => {
    mockUsePullPanel.termOpen = true
    render(<PullPanel {...baseProps} />)
    expect(screen.getByText('Choose term')).toBeInTheDocument()
  })

  it('renders all 3 term options', () => {
    mockUsePullPanel.termOpen = true
    render(<PullPanel {...baseProps} />)
    expect(screen.getByText('7 days')).toBeInTheDocument()
    expect(screen.getByText('14 days')).toBeInTheDocument()
    expect(screen.getByText('21 days')).toBeInTheDocument()
  })

  it('marks the first term as "Popular"', () => {
    mockUsePullPanel.termOpen = true
    render(<PullPanel {...baseProps} />)
    expect(screen.getByText('Popular')).toBeInTheDocument()
  })

  it('shows Confirm button on term screen', () => {
    mockUsePullPanel.termOpen = true
    render(<PullPanel {...baseProps} />)
    expect(screen.getByText('Confirm')).toBeInTheDocument()
  })

  it('shows Back button on term screen', () => {
    mockUsePullPanel.termOpen = true
    render(<PullPanel {...baseProps} />)
    expect(screen.getByText('Back')).toBeInTheDocument()
  })
})
