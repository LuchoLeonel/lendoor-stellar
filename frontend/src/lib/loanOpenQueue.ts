import { normalizeWalletAddress } from '@/lib/wallet-address'

const STORAGE_KEY = 'lendoor:pendingLoanOpens'

export type PendingLoanOpen = {
  id: string
  walletAddress: string
  amountHuman: string
  tenorDays: number
  txHash: string | null
  createdAt: number
  attempts: number
  lastAttemptAt: number | null
}

function readAll(): PendingLoanOpen[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeAll(items: PendingLoanOpen[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  } catch {
    // localStorage may be unavailable
  }
}

export function getPendingOpensForWallet(wallet: string): PendingLoanOpen[] {
  const normalized = normalizeWalletAddress(wallet) ?? wallet
  return readAll().filter(
    (r) => normalizeWalletAddress(r.walletAddress) === normalized,
  )
}

export function addPendingOpen(
  entry: Pick<PendingLoanOpen, 'walletAddress' | 'amountHuman' | 'tenorDays' | 'txHash'>,
): PendingLoanOpen {
  const item: PendingLoanOpen = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    walletAddress: normalizeWalletAddress(entry.walletAddress) ?? entry.walletAddress,
    amountHuman: entry.amountHuman,
    tenorDays: entry.tenorDays,
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

export function removePendingOpen(id: string): void {
  const all = readAll()
  writeAll(all.filter((r) => r.id !== id))
}

export function updatePendingOpen(id: string, patch: Partial<PendingLoanOpen>): void {
  const all = readAll()
  const idx = all.findIndex((r) => r.id === id)
  if (idx !== -1) {
    all[idx] = { ...all[idx], ...patch }
    writeAll(all)
  }
}

export function clearStaleLoanOpens(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): void {
  const now = Date.now()
  const all = readAll()
  writeAll(all.filter((r) => now - r.createdAt < maxAgeMs))
}
