// lib/format.ts
export function formatUsdcFromBigIntString(raw?: string) {
    if (!raw) return "—"
    const n = Number(raw) / 1e6
    if (!Number.isFinite(n)) return "—"
    return n.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }

export function formatCountFromBigIntString(raw?: string) {
  if (!raw) return "—"
  const n = Number(raw)
  if (!Number.isFinite(n)) return raw ?? "—"
  return n.toLocaleString()
}
