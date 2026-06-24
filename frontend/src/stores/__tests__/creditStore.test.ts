import { describe, it, expect, beforeEach } from 'vitest';
import { useCreditStore } from '../creditStore';

beforeEach(() => {
  useCreditStore.setState({ creditScoreDisplay: null, creditScoreRaw: null });
});

describe('creditStore', () => {
  it('starts with null values', () => {
    const state = useCreditStore.getState();
    expect(state.creditScoreDisplay).toBeNull();
    expect(state.creditScoreRaw).toBeNull();
  });

  it('reset clears all fields', () => {
    useCreditStore.setState({ creditScoreDisplay: '3.5', creditScoreRaw: 720 });
    useCreditStore.getState().reset();
    const state = useCreditStore.getState();
    expect(state.creditScoreDisplay).toBeNull();
    expect(state.creditScoreRaw).toBeNull();
  });
});
