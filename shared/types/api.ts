import type { AchievementSummary } from './achievement';
import type { LoanTermOption } from './loan';
import type { Platform } from './platform';
import type { WorkType } from './work-type';

export type ReputationGainPayload = {
  delta: number;
  scoreChanged: boolean;
  groupChanged: boolean;
  newGroupLabel: string | null;
  newScore: number;
};

export type InformRepaymentResponse = {
  ok?: boolean;
  walletAddress?: string;
  score?: number;
  creditLimit?: number;
  xp?: number;
  loanId?: number;
  repaidOnTime?: boolean;
  newAchievements?: AchievementSummary[];
  reputationGain?: ReputationGainPayload | null;
};

export type GetLoanTermsResponse = {
  walletAddress: string;
  score: number | null;
  baseAmount: string;
  terms: LoanTermOption[];
  isPreferentialRate?: boolean;
  adjustedLimitUsdc?: number;
};

export type LemonProfilePayload = {
  walletAddress: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  lemonTag?: string | null;
  pep?: boolean | null;
  lemonCountry?: string | null;
};

export type LemonProfileResponse = {
  ok: true;
  updated: boolean;
  identityMatchScore: number | null;
};

// Suppress unused-import warnings for re-exported types used only in other files
export type { Platform, WorkType, AchievementSummary, LoanTermOption };
