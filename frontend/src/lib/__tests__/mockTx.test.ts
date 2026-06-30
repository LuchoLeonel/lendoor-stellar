import { describe, it, expect, beforeEach } from 'vitest';
import { isMockTx, mockTxParam } from '../mockTx';

beforeEach(() => {
  sessionStorage.clear();
});

describe('mockTx', () => {
  it('is off by default (no query param, empty storage)', () => {
    expect(mockTxParam()).toBeNull();
    expect(isMockTx()).toBe(false);
  });

  it('reads a previously-stored flag from sessionStorage', () => {
    // Simulates a prior navigation that captured ?mockTx=1 into storage.
    sessionStorage.setItem('lendoor.mockTx', '1');
    expect(mockTxParam()).toBe('1');
    expect(isMockTx()).toBe(true);
  });
});
