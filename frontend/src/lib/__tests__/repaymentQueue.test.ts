import { describe, it, expect, beforeEach } from 'vitest';
import {
  getPendingForWallet,
  addPending,
  removePending,
  updatePending,
  clearStale,
  type PendingRepayment,
} from '../repaymentQueue';

const STORAGE_KEY = 'lendoor:pendingRepayments';

beforeEach(() => {
  localStorage.clear();
});

// ---- helpers ----------------------------------------------------------------

function seedStorage(items: PendingRepayment[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function readStorage(): PendingRepayment[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as PendingRepayment[]) : [];
}

function makeItem(overrides: Partial<PendingRepayment> = {}): PendingRepayment {
  return {
    id: 'test-repay-1',
    walletAddress: '0xabc',
    amountPaidHuman: '50',
    txHash: '0xdeadbeef',
    createdAt: Date.now(),
    attempts: 0,
    lastAttemptAt: null,
    ...overrides,
  };
}

// ---- getPendingForWallet ----------------------------------------------------

describe('getPendingForWallet', () => {
  it('returns empty array when localStorage is empty', () => {
    expect(getPendingForWallet('0xabc')).toEqual([]);
  });

  it('returns only items matching the wallet (case-insensitive)', () => {
    const item1 = makeItem({ id: '1', walletAddress: '0xabc' });
    const item2 = makeItem({ id: '2', walletAddress: '0xdef' });
    seedStorage([item1, item2]);

    const result = getPendingForWallet('0xABC');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  it('normalises wallet address to lowercase when comparing', () => {
    const item = makeItem({ walletAddress: '0xABCDEF' });
    seedStorage([item]);

    expect(getPendingForWallet('0xabcdef')).toHaveLength(1);
    expect(getPendingForWallet('0xABCDEF')).toHaveLength(1);
  });

  it('returns empty array when no items match the wallet', () => {
    seedStorage([makeItem({ walletAddress: '0xaaa' })]);
    expect(getPendingForWallet('0xbbb')).toEqual([]);
  });

  it('returns multiple items for the same wallet', () => {
    seedStorage([
      makeItem({ id: '1', walletAddress: '0xabc' }),
      makeItem({ id: '2', walletAddress: '0xabc' }),
    ]);
    expect(getPendingForWallet('0xabc')).toHaveLength(2);
  });

  it('returns empty array when storage contains malformed JSON', () => {
    localStorage.setItem(STORAGE_KEY, 'not-json{{{');
    expect(getPendingForWallet('0xabc')).toEqual([]);
  });

  it('returns empty array when storage contains a non-array JSON value', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ bad: true }));
    expect(getPendingForWallet('0xabc')).toEqual([]);
  });
});

// ---- addPending -------------------------------------------------------------

describe('addPending', () => {
  it('returns the newly created item', () => {
    const item = addPending({ walletAddress: '0xabc', amountPaidHuman: '75', txHash: '0x1' });

    expect(item.walletAddress).toBe('0xabc');
    expect(item.amountPaidHuman).toBe('75');
    expect(item.txHash).toBe('0x1');
    expect(item.attempts).toBe(0);
    expect(item.lastAttemptAt).toBeNull();
  });

  it('normalises walletAddress to lowercase', () => {
    const item = addPending({ walletAddress: '0xABCDEF', amountPaidHuman: '10', txHash: null });
    expect(item.walletAddress).toBe('0xabcdef');
  });

  it('assigns a unique id to each item', () => {
    const a = addPending({ walletAddress: '0xabc', amountPaidHuman: '10', txHash: null });
    const b = addPending({ walletAddress: '0xabc', amountPaidHuman: '20', txHash: null });
    expect(a.id).not.toBe(b.id);
  });

  it('persists the item to localStorage', () => {
    addPending({ walletAddress: '0xabc', amountPaidHuman: '10', txHash: null });
    const stored = readStorage();
    expect(stored).toHaveLength(1);
  });

  it('appends to existing items without overwriting them', () => {
    addPending({ walletAddress: '0xabc', amountPaidHuman: '10', txHash: null });
    addPending({ walletAddress: '0xabc', amountPaidHuman: '20', txHash: '0x2' });
    expect(readStorage()).toHaveLength(2);
  });

  it('records createdAt as a recent timestamp', () => {
    const before = Date.now();
    const item = addPending({ walletAddress: '0xabc', amountPaidHuman: '10', txHash: null });
    const after = Date.now();

    expect(item.createdAt).toBeGreaterThanOrEqual(before);
    expect(item.createdAt).toBeLessThanOrEqual(after);
  });
});

// ---- removePending ----------------------------------------------------------

describe('removePending', () => {
  it('removes the item with the matching id', () => {
    const item = addPending({ walletAddress: '0xabc', amountPaidHuman: '10', txHash: null });
    removePending(item.id);
    expect(readStorage()).toHaveLength(0);
  });

  it('only removes the matching item, leaving others intact', () => {
    const a = addPending({ walletAddress: '0xabc', amountPaidHuman: '10', txHash: null });
    const b = addPending({ walletAddress: '0xabc', amountPaidHuman: '20', txHash: null });

    removePending(a.id);

    const stored = readStorage();
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe(b.id);
  });

  it('is a no-op when the id does not exist', () => {
    addPending({ walletAddress: '0xabc', amountPaidHuman: '10', txHash: null });
    removePending('nonexistent-id');
    expect(readStorage()).toHaveLength(1);
  });
});

// ---- updatePending ----------------------------------------------------------

describe('updatePending', () => {
  it('patches the matching item in storage', () => {
    const item = addPending({ walletAddress: '0xabc', amountPaidHuman: '10', txHash: null });

    updatePending(item.id, { txHash: '0xcafe', attempts: 2 });

    const stored = readStorage();
    expect(stored[0].txHash).toBe('0xcafe');
    expect(stored[0].attempts).toBe(2);
  });

  it('does not overwrite fields not included in the patch', () => {
    const item = addPending({ walletAddress: '0xabc', amountPaidHuman: '100', txHash: '0x1' });

    updatePending(item.id, { attempts: 1 });

    expect(readStorage()[0].amountPaidHuman).toBe('100');
    expect(readStorage()[0].txHash).toBe('0x1');
  });

  it('is a no-op when the id does not exist', () => {
    addPending({ walletAddress: '0xabc', amountPaidHuman: '10', txHash: null });

    updatePending('nonexistent-id', { attempts: 99 });

    expect(readStorage()[0].attempts).toBe(0);
  });
});

// ---- clearStale -------------------------------------------------------------

describe('clearStale', () => {
  it('removes items older than maxAgeMs', () => {
    const stale = makeItem({ id: 'stale', createdAt: Date.now() - 8 * 24 * 60 * 60 * 1000 });
    const fresh = makeItem({ id: 'fresh', createdAt: Date.now() });
    seedStorage([stale, fresh]);

    clearStale(7 * 24 * 60 * 60 * 1000);

    const stored = readStorage();
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe('fresh');
  });

  it('keeps all items when none are stale', () => {
    seedStorage([
      makeItem({ id: '1', createdAt: Date.now() - 1000 }),
      makeItem({ id: '2', createdAt: Date.now() - 2000 }),
    ]);

    clearStale(7 * 24 * 60 * 60 * 1000);

    expect(readStorage()).toHaveLength(2);
  });

  it('removes all items when all are stale', () => {
    const ancient = Date.now() - 10 * 24 * 60 * 60 * 1000;
    seedStorage([
      makeItem({ id: '1', createdAt: ancient }),
      makeItem({ id: '2', createdAt: ancient }),
    ]);

    clearStale(7 * 24 * 60 * 60 * 1000);

    expect(readStorage()).toHaveLength(0);
  });

  it('uses 7 days as the default maxAgeMs', () => {
    const justOverSevenDays = Date.now() - 7 * 24 * 60 * 60 * 1000 - 1;
    seedStorage([makeItem({ id: 'old', createdAt: justOverSevenDays })]);

    clearStale(); // default 7 days

    expect(readStorage()).toHaveLength(0);
  });
});
