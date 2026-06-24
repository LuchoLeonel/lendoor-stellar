const STORAGE_KEY = 'lendoor:pendingRepayments'

export type PendingRepayment = {
  id: string
  walletAddress: string
  amountPaidHuman: string
  txHash: string | null
  createdAt: number
  attempts: number
  lastAttemptAt: number | null
}

function readAll(): PendingRepayment[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeAll(items: PendingRepayment[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  } catch {
    // localStorage may be unavailable (incognito, quota exceeded)
  }
}

export function getPendingForWallet(wallet: string): PendingRepayment[] {
  const normalized = wallet.toLowerCase()
  return readAll().filter((r) => r.walletAddress.toLowerCase() === normalized)
}

export function addPending(
  entry: Pick<PendingRepayment, 'walletAddress' | 'amountPaidHuman' | 'txHash'>,
): PendingRepayment {
  const item: PendingRepayment = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    walletAddress: entry.walletAddress.toLowerCase(),
    amountPaidHuman: entry.amountPaidHuman,
    txHash: entry.txHash,
    createdAt: Date.now(),
    attempts: 0,
    lastAttemptAt: null,
  }

  const all = readAll()
  all.push(item)
  writeAll(all)
  return item
}

export function removePending(id: string): void {
  const all = readAll()
  writeAll(all.filter((r) => r.id !== id))
}

export function updatePending(id: string, patch: Partial<PendingRepayment>): void {
  const all = readAll()
  const idx = all.findIndex((r) => r.id === id)
  if (idx !== -1) {
    all[idx] = { ...all[idx], ...patch }
    writeAll(all)
  }
}

export function clearStale(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): void {
  const now = Date.now()
  const all = readAll()
  writeAll(all.filter((r) => now - r.createdAt < maxAgeMs))
}
