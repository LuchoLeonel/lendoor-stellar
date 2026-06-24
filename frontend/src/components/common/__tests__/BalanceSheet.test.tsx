import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { BalanceSheet } from '../HeaderUsdcArea';

// i18n stub — returns the last segment of the key so assertions read natural.
const t = (key: string) => key.split('.').pop() ?? key;

function createTouch(clientY: number): Touch {
  // jsdom Touch polyfill is partial — object cast with all coordinate
  // fields avoids "Cannot read clientX" errors from react-remove-scroll
  // which listens at document level and reads every touch event.
  return {
    clientX: 0,
    clientY,
    pageX: 0,
    pageY: clientY,
    screenX: 0,
    screenY: clientY,
    identifier: 0,
  } as unknown as Touch;
}

function touchEvent(_type: string, y: number): TouchEventInit {
  const touch = createTouch(y);
  return {
    bubbles: true,
    cancelable: true,
    touches: [touch],
    targetTouches: [touch],
    changedTouches: [touch],
  } as unknown as TouchEventInit;
}

describe('BalanceSheet', () => {
  beforeEach(() => {
    cleanup();
  });

  it('does not render content when closed', () => {
    render(
      <BalanceSheet
        open={false}
        onOpenChange={vi.fn()}
        t={t}
        onDeposit={vi.fn()}
        onWithdraw={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('balance-sheet')).toBeNull();
  });

  it('renders drag handle, deposit and withdraw options when open', () => {
    render(
      <BalanceSheet
        open={true}
        onOpenChange={vi.fn()}
        t={t}
        onDeposit={vi.fn()}
        onWithdraw={vi.fn()}
      />,
    );
    expect(screen.getByTestId('balance-sheet')).toBeInTheDocument();
    expect(screen.getByTestId('balance-sheet-handle')).toBeInTheDocument();
    expect(screen.getByTestId('balance-sheet-deposit')).toBeInTheDocument();
    expect(screen.getByTestId('balance-sheet-withdraw')).toBeInTheDocument();
  });

  it('calls onDeposit when the deposit option is clicked', () => {
    const onDeposit = vi.fn();
    render(
      <BalanceSheet
        open={true}
        onOpenChange={vi.fn()}
        t={t}
        onDeposit={onDeposit}
        onWithdraw={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('balance-sheet-deposit'));
    expect(onDeposit).toHaveBeenCalledTimes(1);
  });

  it('calls onWithdraw when the withdraw option is clicked', () => {
    const onWithdraw = vi.fn();
    render(
      <BalanceSheet
        open={true}
        onOpenChange={vi.fn()}
        t={t}
        onDeposit={vi.fn()}
        onWithdraw={onWithdraw}
      />,
    );
    fireEvent.click(screen.getByTestId('balance-sheet-withdraw'));
    expect(onWithdraw).toHaveBeenCalledTimes(1);
  });

  it('is positioned as a bottom sheet (fixed bottom-0, full width, rounded top)', () => {
    render(
      <BalanceSheet
        open={true}
        onOpenChange={vi.fn()}
        t={t}
        onDeposit={vi.fn()}
        onWithdraw={vi.fn()}
      />,
    );
    const sheet = screen.getByTestId('balance-sheet');
    expect(sheet.className).toContain('fixed');
    expect(sheet.className).toContain('bottom-0');
    expect(sheet.className).toContain('left-0');
    expect(sheet.className).toContain('right-0');
    expect(sheet.className).toContain('rounded-t-3xl');
  });

  it('closes when the user swipes down past the threshold (>80px)', () => {
    const onOpenChange = vi.fn();
    render(
      <BalanceSheet
        open={true}
        onOpenChange={onOpenChange}
        t={t}
        onDeposit={vi.fn()}
        onWithdraw={vi.fn()}
      />,
    );
    const sheet = screen.getByTestId('balance-sheet');
    fireEvent.touchStart(sheet, touchEvent('touchstart', 100));
    fireEvent.touchMove(sheet, touchEvent('touchmove', 220)); // dy = 120 (>80)
    fireEvent.touchEnd(sheet);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('stays open when the user swipes down only a little (<=80px)', () => {
    const onOpenChange = vi.fn();
    render(
      <BalanceSheet
        open={true}
        onOpenChange={onOpenChange}
        t={t}
        onDeposit={vi.fn()}
        onWithdraw={vi.fn()}
      />,
    );
    const sheet = screen.getByTestId('balance-sheet');
    fireEvent.touchStart(sheet, touchEvent('touchstart', 100));
    fireEvent.touchMove(sheet, touchEvent('touchmove', 150)); // dy = 50 (<80)
    fireEvent.touchEnd(sheet);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('ignores upward swipes (does not close)', () => {
    const onOpenChange = vi.fn();
    render(
      <BalanceSheet
        open={true}
        onOpenChange={onOpenChange}
        t={t}
        onDeposit={vi.fn()}
        onWithdraw={vi.fn()}
      />,
    );
    const sheet = screen.getByTestId('balance-sheet');
    fireEvent.touchStart(sheet, touchEvent('touchstart', 100));
    fireEvent.touchMove(sheet, touchEvent('touchmove', 0)); // dy = -100 (up)
    fireEvent.touchEnd(sheet);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('swipe-down on the opaque overlay also closes the sheet', () => {
    const onOpenChange = vi.fn();
    render(
      <BalanceSheet
        open={true}
        onOpenChange={onOpenChange}
        t={t}
        onDeposit={vi.fn()}
        onWithdraw={vi.fn()}
      />,
    );
    const overlay = screen.getByTestId('balance-sheet-overlay');
    fireEvent.touchStart(overlay, touchEvent('touchstart', 200));
    fireEvent.touchMove(overlay, touchEvent('touchmove', 320)); // dy=120 >80
    fireEvent.touchEnd(overlay);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('does not render a close X button (swipe/tap-outside only)', () => {
    render(
      <BalanceSheet
        open={true}
        onOpenChange={vi.fn()}
        t={t}
        onDeposit={vi.fn()}
        onWithdraw={vi.fn()}
      />,
    );
    // The shared DialogContent appends an absolutely-positioned Close button
    // with aria-label "Close" — we skip it here by using DialogPrimitive directly.
    expect(screen.queryByRole('button', { name: /close/i })).toBeNull();
  });
});
