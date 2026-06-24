import { describe, it, expect, beforeEach } from 'vitest';
import { useLoanStatsStore } from '../loanStatsStore';

beforeEach(() => {
  useLoanStatsStore.setState({
    loansCount: null, closedLoansCount: null,
    loansOnTimeCount: null, openLoansCount: null,
    onTimePercent: null, loanStatsLoading: false,
  });
});

describe('loanStatsStore', () => {
  it('starts with null counts and loading false', () => {
    const state = useLoanStatsStore.getState();
    expect(state.loansCount).toBeNull();
    expect(state.closedLoansCount).toBeNull();
    expect(state.loansOnTimeCount).toBeNull();
    expect(state.openLoansCount).toBeNull();
    expect(state.onTimePercent).toBeNull();
    expect(state.loanStatsLoading).toBe(false);
  });

  it('reset restores initial values', () => {
    useLoanStatsStore.setState({
      loansCount: 10, closedLoansCount: 8,
      loansOnTimeCount: 7, openLoansCount: 2,
      onTimePercent: 87.5, loanStatsLoading: true,
    });
    useLoanStatsStore.getState().reset();
    const state = useLoanStatsStore.getState();
    expect(state.loansCount).toBeNull();
    expect(state.openLoansCount).toBeNull();
    expect(state.onTimePercent).toBeNull();
    expect(state.loanStatsLoading).toBe(false);
  });

  // Spec 055 — openLoansCount drives the phone-verify bypass.
  describe('openLoansCount (spec 055)', () => {
    it('setOpenLoansCount writes the value directly', () => {
      useLoanStatsStore.getState().setOpenLoansCount(3);
      expect(useLoanStatsStore.getState().openLoansCount).toBe(3);
    });

    it('setOpenLoansCount can decrement (no HWM lock)', () => {
      // Critical: openLoansCount must be able to go DOWN. Repaying a loan
      // decrements it from 1→0; if HWM were applied, the repay-time
      // optimistic update or the post-repay backend read would never settle
      // back to 0 and the user would stay falsely "in debt" in the UI.
      useLoanStatsStore.getState().setOpenLoansCount(2);
      useLoanStatsStore.getState().setOpenLoansCount(1);
      expect(useLoanStatsStore.getState().openLoansCount).toBe(1);
      useLoanStatsStore.getState().setOpenLoansCount(0);
      expect(useLoanStatsStore.getState().openLoansCount).toBe(0);
    });

    it('setOpenLoansCount accepts null (cleared on wallet change)', () => {
      useLoanStatsStore.getState().setOpenLoansCount(5);
      useLoanStatsStore.getState().setOpenLoansCount(null);
      expect(useLoanStatsStore.getState().openLoansCount).toBeNull();
    });
  });
});
