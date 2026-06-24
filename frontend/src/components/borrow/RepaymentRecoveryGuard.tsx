import { useRepaymentRecovery } from '@/hooks/borrow/useRepaymentRecovery'

export function RepaymentRecoveryGuard({ children }: { children: React.ReactNode }) {
  useRepaymentRecovery()
  return <>{children}</>
}
