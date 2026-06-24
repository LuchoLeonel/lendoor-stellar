import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { CooldownPanel } from '../CoolDownPanel'

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

describe('CooldownPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('renders the title', () => {
    render(<CooldownPanel cooldownUntil={null} cooldownSecondsLeft={60} />)
    expect(screen.getByText('borrow.cooldown.title')).toBeInTheDocument()
  })

  it('renders the description', () => {
    render(<CooldownPanel cooldownUntil={null} cooldownSecondsLeft={60} />)
    expect(screen.getByText('borrow.cooldown.description')).toBeInTheDocument()
  })

  it('shows countdown when seconds remain', () => {
    render(<CooldownPanel cooldownUntil={null} cooldownSecondsLeft={3661} />)
    // 3661 seconds = 1h 1m 1s — multiple '01' elements, just check the header
    expect(screen.getByText('borrow.cooldown.countdownHeader')).toBeInTheDocument()
    expect(screen.getByText('hs')).toBeInTheDocument()
    expect(screen.getByText('min')).toBeInTheDocument()
    expect(screen.getByText('seg')).toBeInTheDocument()
  })

  it('shows ready message when no time remains', () => {
    render(<CooldownPanel cooldownUntil={null} cooldownSecondsLeft={0} />)
    expect(
      screen.getByText('borrow.cooldown.readyMessage'),
    ).toBeInTheDocument()
  })

  it('shows ready message when cooldownSecondsLeft is null', () => {
    render(<CooldownPanel cooldownUntil={null} cooldownSecondsLeft={null} />)
    expect(
      screen.getByText('borrow.cooldown.readyMessage'),
    ).toBeInTheDocument()
  })

  it('counts down over time', () => {
    render(<CooldownPanel cooldownUntil={null} cooldownSecondsLeft={5} />)

    // Initially 5 seconds → 00:00:05
    expect(screen.getByText('05')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(2000)
    })

    // After 2 seconds → 00:00:03
    expect(screen.getByText('03')).toBeInTheDocument()
  })

  it('shows days when cooldown is > 24h', () => {
    render(
      <CooldownPanel cooldownUntil={null} cooldownSecondsLeft={90000} />,
    )
    // 90000s = 1 day, 1h, 0m, 0s
    expect(screen.getByText('1')).toBeInTheDocument() // days
    expect(screen.getByText('días')).toBeInTheDocument()
  })

  afterEach(() => {
    vi.useRealTimers()
  })
})
