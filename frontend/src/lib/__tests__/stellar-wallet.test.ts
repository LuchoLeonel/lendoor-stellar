import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

// Mock the Freighter API surface used by stellar-wallet.
vi.mock('@stellar/freighter-api', () => ({
  getAddress: vi.fn(),
  getNetworkDetails: vi.fn(),
  isAllowed: vi.fn(),
  isConnected: vi.fn(),
  requestAccess: vi.fn(),
  signMessage: vi.fn(),
  signTransaction: vi.fn(),
}));

import * as freighter from '@stellar/freighter-api';
import { requestFreighterAddress } from '../stellar-wallet';

const requestAccess = freighter.requestAccess as unknown as Mock;
const isConnected = freighter.isConnected as unknown as Mock;

const ADDR = 'GAIRISXKPLOWZBMFRPU5XRGUUX3VMA3ZEWKBM5MSNRU3CHV6P4PYZ74D';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('requestFreighterAddress (first-connect fix)', () => {
  it('returns the address by calling requestAccess directly (no racy pre-gate)', async () => {
    requestAccess.mockResolvedValue({ address: ADDR });
    // isConnected returns false (the racy first-connect state) — must NOT block.
    isConnected.mockResolvedValue(false);

    await expect(requestFreighterAddress()).resolves.toBe(ADDR);

    expect(requestAccess).toHaveBeenCalledTimes(1);
    // The fix: detection (isConnected) is NOT consulted on the happy path.
    expect(isConnected).not.toHaveBeenCalled();
  });

  it('surfaces a Freighter error message (e.g. user declined)', async () => {
    requestAccess.mockResolvedValue({ error: 'User declined access' });

    await expect(requestFreighterAddress()).rejects.toThrow('User declined access');
  });

  it('falls back to the "not detected" message only when the extension is truly absent', async () => {
    requestAccess.mockRejectedValue(new Error('not found'));
    isConnected.mockResolvedValue(false); // extension genuinely not present

    await expect(requestFreighterAddress()).rejects.toThrow(/not detected/i);
  });

  it('rethrows the original error when the extension IS present but the call failed', async () => {
    requestAccess.mockRejectedValue(new Error('popup closed'));
    isConnected.mockResolvedValue(true); // extension present

    await expect(requestFreighterAddress()).rejects.toThrow('popup closed');
  });
});
