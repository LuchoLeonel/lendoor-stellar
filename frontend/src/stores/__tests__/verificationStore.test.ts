import { describe, it, expect, beforeEach } from 'vitest';
import { useVerificationStore } from '../verificationStore';

beforeEach(() => {
  useVerificationStore.setState({ isVerified: false, goToWaitlist: false, hasAcceptedTerms: false });
});

describe('verificationStore', () => {
  it('starts with all flags false', () => {
    const state = useVerificationStore.getState();
    expect(state.isVerified).toBe(false);
    expect(state.goToWaitlist).toBe(false);
    expect(state.hasAcceptedTerms).toBe(false);
  });

  it('reset restores initial values', () => {
    useVerificationStore.setState({ isVerified: true, goToWaitlist: true, hasAcceptedTerms: true });
    useVerificationStore.getState().reset();
    const state = useVerificationStore.getState();
    expect(state.isVerified).toBe(false);
    expect(state.goToWaitlist).toBe(false);
    expect(state.hasAcceptedTerms).toBe(false);
  });
});
