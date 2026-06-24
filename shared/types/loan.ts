export enum LoanStatus {
  OPEN = 'open',
  REPAID_ON_TIME = 'repaid_on_time',
  REPAID_LATE = 'repaid_late',
  DEFAULTED_IN_GRACE = 'defaulted_in_grace',
  DEFAULTED = 'defaulted',
}

export type LoanTermOption = {
  days: number;
  periodRatePercent: number;
  monthlyRatePercent: number;
  baseMonthlyRatePercent?: number;
  principalAmount: string;
  interestAmount: string;
  finalAmount: string;
  feeBps: number;
};

export type CreditTier = {
  level: number;
  minOnTimeLoans: number;
  limitUsdc: number;
  baseRateMonthly: number;
};
