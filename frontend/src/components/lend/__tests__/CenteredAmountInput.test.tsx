import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CenteredAmountInput } from '../CenteredAmountInput'

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'lend.centeredAmountInput.placeholder': '0.00',
        'lend.centeredAmountInput.ariaLabel': 'Amount',
      }
      return map[key] ?? key
    },
  }),
}))

describe('CenteredAmountInput', () => {
  it('renders with the dollar symbol by default', () => {
    render(<CenteredAmountInput value="" onChange={vi.fn()} />)
    expect(screen.getByText('$')).toBeInTheDocument()
  })

  it('renders with a custom symbol', () => {
    render(<CenteredAmountInput value="" onChange={vi.fn()} symbol="€" />)
    expect(screen.getByText('€')).toBeInTheDocument()
  })

  it('renders the input with the correct aria-label', () => {
    render(<CenteredAmountInput value="" onChange={vi.fn()} />)
    expect(screen.getByLabelText('Amount')).toBeInTheDocument()
  })

  it('displays the value in the input', () => {
    render(<CenteredAmountInput value="42.5" onChange={vi.fn()} />)
    const input = screen.getByLabelText('Amount') as HTMLInputElement
    expect(input.value).toBe('42.5')
  })

  it('calls onChange when the user types', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<CenteredAmountInput value="" onChange={onChange} />)

    const input = screen.getByLabelText('Amount')
    await user.type(input, '100')

    expect(onChange).toHaveBeenCalled()
    expect(onChange).toHaveBeenCalledWith(expect.stringContaining('1'))
  })

  it('shows placeholder when value is empty', () => {
    render(<CenteredAmountInput value="" onChange={vi.fn()} />)
    const input = screen.getByLabelText('Amount') as HTMLInputElement
    expect(input.placeholder).toBe('0.00')
  })

  it('uses decimal inputMode for mobile keyboard', () => {
    render(<CenteredAmountInput value="" onChange={vi.fn()} />)
    const input = screen.getByLabelText('Amount')
    expect(input).toHaveAttribute('inputMode', 'decimal')
  })

  it('applies custom className', () => {
    render(
      <CenteredAmountInput
        value="10"
        onChange={vi.fn()}
        className="custom-class"
      />,
    )
    const input = screen.getByLabelText('Amount')
    expect(input.className).toContain('custom-class')
  })
})
