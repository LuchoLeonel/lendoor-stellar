import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LoanTermStrip } from '../LoanTermStrip'

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (params) return `${key}|${JSON.stringify(params)}`
      return key
    },
  }),
}))

describe('LoanTermStrip', () => {
  it('renders nothing when daysRemaining is null', () => {
    const { container } = render(
      <LoanTermStrip daysRemaining={null} progressPct={50} />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing when progressPct is null', () => {
    const { container } = render(
      <LoanTermStrip daysRemaining={5} progressPct={null} />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders the term header', () => {
    render(<LoanTermStrip daysRemaining={5} progressPct={30} />)
    expect(screen.getByText('borrow.term.header')).toBeInTheDocument()
  })

  it('shows "on time" status for positive days remaining', () => {
    render(<LoanTermStrip daysRemaining={5} progressPct={30} />)
    expect(screen.getByText('borrow.term.statusOnTime')).toBeInTheDocument()
  })

  it('shows "overdue" status for negative days remaining', () => {
    render(<LoanTermStrip daysRemaining={-2} progressPct={110} />)
    expect(screen.getByText('borrow.term.statusOverdue')).toBeInTheDocument()
  })

  it('shows "less than one day" label when 0 < days < 1', () => {
    render(<LoanTermStrip daysRemaining={0.5} progressPct={90} />)
    expect(
      screen.getByText('borrow.term.timeRemainingLessThanOne'),
    ).toBeInTheDocument()
  })

  it('shows "due today" label when -1 < days < 0', () => {
    render(<LoanTermStrip daysRemaining={-0.5} progressPct={100} />)
    expect(screen.getByText('borrow.term.timeDueToday')).toBeInTheDocument()
  })

  it('shows overdue days count for days < -1', () => {
    render(<LoanTermStrip daysRemaining={-3} progressPct={115} />)
    expect(
      screen.getByText(/borrow\.term\.timeOverdueDays/),
    ).toBeInTheDocument()
  })

  it('renders progress bar with correct width percentage', () => {
    render(<LoanTermStrip daysRemaining={5} progressPct={42} />)
    const bar = document.querySelector('[style*="width"]') as HTMLElement
    expect(bar).toBeTruthy()
    expect(bar.style.width).toBe('42%')
  })

  it('applies red classes when overdue', () => {
    const { container } = render(
      <LoanTermStrip daysRemaining={-2} progressPct={110} />,
    )
    // The outer div should have red border
    expect(container.firstChild).toHaveClass('border-red-200')
  })

  it('applies green bar class for low progress', () => {
    render(<LoanTermStrip daysRemaining={10} progressPct={20} />)
    const bar = document.querySelector('[style*="width"]') as HTMLElement
    expect(bar).toHaveClass('bg-emerald-500')
  })

  it('applies orange bar class for high progress (>=80%)', () => {
    render(<LoanTermStrip daysRemaining={1} progressPct={85} />)
    const bar = document.querySelector('[style*="width"]') as HTMLElement
    expect(bar).toHaveClass('bg-orange-500')
  })

  it('clamps bar width to 100% max', () => {
    render(<LoanTermStrip daysRemaining={-1} progressPct={130} />)
    const bar = document.querySelector('[style*="width"]') as HTMLElement
    expect(bar.style.width).toBe('100%')
  })
})
