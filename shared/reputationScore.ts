export function reputationScore(onTimeLoans: number): number {
  if (!Number.isFinite(onTimeLoans) || onTimeLoans <= 0) return 0;
  return Math.min(1000, Math.round(250 * Math.log10(1 + onTimeLoans)));
}
