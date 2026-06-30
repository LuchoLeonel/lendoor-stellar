import { describe, it, expect, beforeEach } from 'vitest';
import {
  getPendingOpensForWallet,
  addPendingOpen,
  removePendingOpen,
  updatePendingOpen,
  clearStaleLoanOpens,
  type PendingLoanOpen,
} from '../loanOpenQueue';

const STORAGE_KEY = 'lendoor:pendingLoanOpens';

// Direcciones EVM completas (40 hex): el patrón EVM exige el largo completo, así
// que los fixtures cortos ('0xabc') no se normalizaban. Lower/Upper de la MISMA
// address para los casos de case-insensitive.
const W1_LOWER = '0xabc0000000000000000000000000000000000abc';
const W1_UPPER = '0xABC0000000000000000000000000000000000ABC';
const W2_LOWER = '0xdef0000000000000000000000000000000000def';

beforeEach(() => {
  localStorage.clear();
});

// ---- helpers ----------------------------------------------------------------

function seedStorage(items: PendingLoanOpen[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function readStorage(): PendingLoanOpen[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as PendingLoanOpen[]) : [];
}

function makeItem(overrides: Partial<PendingLoanOpen> = {}): PendingLoanOpen {
  return {
    id: 'test-id-1',
    walletAddress: '0xabc',
    amountHuman: '100',
    tenorDays: 30,
    txHash: '0xdeadbeef',
    createdAt: Date.now(),
    attempts: 0,
    lastAttemptAt: null,
    ...overrides,
  };
}

// ---- getPendingOpensForWallet -----------------------------------------------

describe('getPendingOpensForWallet', () => {
  it('returns empty array when localStorage is empty', () => {
    expect(getPendingOpensForWallet('0xabc')).toEqual([]);
  });

  it('returns only items matching the wallet (case-insensitive)', () => {
    const item1 = makeItem({ id: '1', walletAddress: W1_LOWER });
    const item2 = makeItem({ id: '2', walletAddress: W2_LOWER });
    seedStorage([item1, item2]);

    const result = getPendingOpensForWallet(W1_UPPER);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  it('normalises wallet address to lowercase when comparing', () => {
    const item = makeItem({ walletAddress: W1_UPPER });
    seedStorage([item]);

    expect(getPendingOpensForWallet(W1_LOWER)).toHaveLength(1);
    expect(getPendingOpensForWallet(W1_UPPER)).toHaveLength(1);
  });

  it('returns empty array when no items match the wallet', () => {
    seedStorage([makeItem({ walletAddress: '0xaaa' })]);

    expect(getPendingOpensForWallet('0xbbb')).toEqual([]);
  });

  it('returns multiple items for the same wallet', () => {
    const items = [
      makeItem({ id: '1', walletAddress: W1_LOWER }),
      makeItem({ id: '2', walletAddress: W1_LOWER }),
    ];
    seedStorage(items);

    expect(getPendingOpensForWallet(W1_LOWER)).toHaveLength(2);
  });

  it('returns empty array when storage contains malformed JSON', () => {
    localStorage.setItem(STORAGE_KEY, 'not-json{{{');

    expect(getPendingOpensForWallet('0xabc')).toEqual([]);
  });

  it('returns empty array when storage contains a non-array JSON value', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ oops: true }));

    expect(getPendingOpensForWallet('0xabc')).toEqual([]);
  });
});

// ---- addPendingOpen ---------------------------------------------------------

describe('addPendingOpen', () => {
  it('returns the newly created item', () => {
    const item = addPendingOpen({
      walletAddress: '0xabc',
      amountHuman: '50',
      tenorDays: 7,
      txHash: null,
    });

    expect(item.walletAddress).toBe('0xabc');
    expect(item.amountHuman).toBe('50');
    expect(item.tenorDays).toBe(7);
    expect(item.txHash).toBeNull();
    expect(item.attempts).toBe(0);
    expect(item.lastAttemptAt).toBeNull();
  });

  it('normalises walletAddress to lowercase', () => {
    const item = addPendingOpen({
      walletAddress: W1_UPPER,
      amountHuman: '100',
      tenorDays: 30,
      txHash: null,
    });

    expect(item.walletAddress).toBe(W1_LOWER);
  });

  it('assigns a unique id to each item', () => {
    const a = addPendingOpen({ walletAddress: '0xabc', amountHuman: '10', tenorDays: 7, txHash: null });
    const b = addPendingOpen({ walletAddress: '0xabc', amountHuman: '20', tenorDays: 7, txHash: null });

    expect(a.id).not.toBe(b.id);
  });

  it('persists the item to localStorage', () => {
    addPendingOpen({ walletAddress: '0xabc', amountHuman: '10', tenorDays: 7, txHash: null });

    const stored = readStorage();
    expect(stored).toHaveLength(1);
    expect(stored[0].walletAddress).toBe('0xabc');
  });

  it('appends to existing items without overwriting them', () => {
    addPendingOpen({ walletAddress: '0xabc', amountHuman: '10', tenorDays: 7, txHash: null });
    addPendingOpen({ walletAddress: '0xabc', amountHuman: '20', tenorDays: 14, txHash: '0x1' });

    expect(readStorage()).toHaveLength(2);
  });

  it('records createdAt as a recent timestamp', () => {
    const before = Date.now();
    const item = addPendingOpen({ walletAddress: '0xabc', amountHuman: '10', tenorDays: 7, txHash: null });
    const after = Date.now();

    expect(item.createdAt).toBeGreaterThanOrEqual(before);
    expect(item.createdAt).toBeLessThanOrEqual(after);
  });
});

// ---- removePendingOpen ------------------------------------------------------

describe('removePendingOpen', () => {
  it('removes the item with the matching id', () => {
    const item = addPendingOpen({ walletAddress: '0xabc', amountHuman: '10', tenorDays: 7, txHash: null });

    removePendingOpen(item.id);

    expect(readStorage()).toHaveLength(0);
  });

  it('only removes the matching item, leaving others intact', () => {
    const a = addPendingOpen({ walletAddress: '0xabc', amountHuman: '10', tenorDays: 7, txHash: null });
    const b = addPendingOpen({ walletAddress: '0xabc', amountHuman: '20', tenorDays: 14, txHash: null });

    removePendingOpen(a.id);

    const stored = readStorage();
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe(b.id);
  });

  it('is a no-op when the id does not exist', () => {
    addPendingOpen({ walletAddress: '0xabc', amountHuman: '10', tenorDays: 7, txHash: null });

    removePendingOpen('nonexistent-id');

    expect(readStorage()).toHaveLength(1);
  });
});

// ---- updatePendingOpen ------------------------------------------------------

describe('updatePendingOpen', () => {
  it('patches the matching item in storage', () => {
    const item = addPendingOpen({ walletAddress: '0xabc', amountHuman: '10', tenorDays: 7, txHash: null });

    updatePendingOpen(item.id, { txHash: '0xdeadbeef', attempts: 1 });

    const stored = readStorage();
    expect(stored[0].txHash).toBe('0xdeadbeef');
    expect(stored[0].attempts).toBe(1);
  });

  it('does not overwrite fields not included in the patch', () => {
    const item = addPendingOpen({ walletAddress: '0xabc', amountHuman: '100', tenorDays: 30, txHash: null });

    updatePendingOpen(item.id, { attempts: 2 });

    const stored = readStorage();
    expect(stored[0].amountHuman).toBe('100');
    expect(stored[0].tenorDays).toBe(30);
  });

  it('is a no-op when the id does not exist', () => {
    addPendingOpen({ walletAddress: '0xabc', amountHuman: '10', tenorDays: 7, txHash: null });

    updatePendingOpen('nonexistent-id', { attempts: 99 });

    expect(readStorage()[0].attempts).toBe(0);
  });
});

// ---- clearStaleLoanOpens ----------------------------------------------------

describe('clearStaleLoanOpens', () => {
  it('removes items older than maxAgeMs', () => {
    const stale = makeItem({ id: 'stale', createdAt: Date.now() - 8 * 24 * 60 * 60 * 1000 });
    const fresh = makeItem({ id: 'fresh', createdAt: Date.now() });
    seedStorage([stale, fresh]);

    clearStaleLoanOpens(7 * 24 * 60 * 60 * 1000);

    const stored = readStorage();
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe('fresh');
  });

  it('keeps all items when none are stale', () => {
    const items = [
      makeItem({ id: '1', createdAt: Date.now() - 1000 }),
      makeItem({ id: '2', createdAt: Date.now() - 2000 }),
    ];
    seedStorage(items);

    clearStaleLoanOpens(7 * 24 * 60 * 60 * 1000);

    expect(readStorage()).toHaveLength(2);
  });

  it('removes all items when all are stale', () => {
    const ancient = Date.now() - 10 * 24 * 60 * 60 * 1000;
    seedStorage([
      makeItem({ id: '1', createdAt: ancient }),
      makeItem({ id: '2', createdAt: ancient }),
    ]);

    clearStaleLoanOpens(7 * 24 * 60 * 60 * 1000);

    expect(readStorage()).toHaveLength(0);
  });

  it('uses 7 days as the default maxAgeMs', () => {
    const justOverSevenDays = Date.now() - 7 * 24 * 60 * 60 * 1000 - 1;
    seedStorage([makeItem({ id: 'old', createdAt: justOverSevenDays })]);

    clearStaleLoanOpens(); // default 7 days

    expect(readStorage()).toHaveLength(0);
  });
});
