// src/lib/tiers.ts
// Single source of truth for the credit-ladder tier definitions used across
// the borrow UI (PrestarTab, ProgresoTab, GamificationRoadmap, BorrowMarket).
//
// Mirrors backend/src/domain/services/credit-policy.service.ts CREDIT_LADDER
// for (score, limitUsdc) and shared/tierHelpers.ts for groupLabel mapping.
// If you change groupLabel here, also update shared/tierHelpers.ts.

import { MAX_SCORE, XP_PER_SCORE, MAX_CREDIT_LEVEL } from "@/lib/constants";

export interface TierDefinition {
  /** Lendoor score value (1–11) */
  score: number;
  /** Credit limit in USDC for this step */
  limitUsdc: number;
  /** Display name (full, e.g. "Nivel 1: Novato") */
  name: string;
  /** Colored emoji icon */
  emoji: string;
  /** Tier group label — matches shared/tierHelpers.ts */
  groupLabel: string;
}

export type TierState = "past" | "current" | "locked";

export const TIERS: TierDefinition[] = [
  { score: 1,  limitUsdc: 1,  name: "Nivel 1: Novato",     emoji: "🌱", groupLabel: "Novato"    },
  { score: 2,  limitUsdc: 3,  name: "Nivel 2: Novato",     emoji: "🌱", groupLabel: "Novato"    },
  { score: 3,  limitUsdc: 4,  name: "Nivel 3: Activo",     emoji: "🚀", groupLabel: "Activo"    },
  { score: 4,  limitUsdc: 6,  name: "Nivel 4: Activo",     emoji: "🚀", groupLabel: "Activo"    },
  { score: 5,  limitUsdc: 8,  name: "Nivel 5: Estable",    emoji: "🌍", groupLabel: "Estable"   },
  { score: 6,  limitUsdc: 10, name: "Nivel 6: Estable",    emoji: "🌍", groupLabel: "Estable"   },
  { score: 7,  limitUsdc: 12, name: "Nivel 7: Confiable",  emoji: "🛡️", groupLabel: "Confiable" },
  { score: 8,  limitUsdc: 15, name: "Nivel 8: Confiable",  emoji: "🛡️", groupLabel: "Confiable" },
  { score: 9,  limitUsdc: 18, name: "Nivel 9: Referente",  emoji: "⚡", groupLabel: "Referente" },
  { score: 10, limitUsdc: 22, name: "Nivel 10: Referente", emoji: "⚡", groupLabel: "Referente" },
  { score: 11, limitUsdc: 25, name: "Nivel 11: Leyenda",   emoji: "👑", groupLabel: "Leyenda"   },
];

/** Returns the tier matching a clamped score (1..MAX_CREDIT_LEVEL). */
export function getTierForScore(score: number): TierDefinition {
  const n = Number.isFinite(score) ? Math.round(score) : 1;
  const clamped = Math.max(1, Math.min(MAX_CREDIT_LEVEL, n));
  return TIERS[clamped - 1]!;
}

/** Tier group label (e.g. "Novato", "Referente"). Shared with backend via shared/tierHelpers.ts. */
export function getGroupLabelForScore(score: number): string {
  return getTierForScore(score).groupLabel;
}

/**
 * 🚨 LEGACY (pre spec 004). Returned the XP needed to reach `score` when
 * the UI showed progress as discrete XP units per tier. Replaced by the
 * continuous logarithmic reputation score (see `shared/reputationScore.ts`).
 * Not called by any component. Kept to avoid breaking external imports.
 *
 * DO NOT use this in new code. For "how far to next tier" use the
 * reputation score delta instead (`reputationScore(n+1) - reputationScore(n)`).
 */
export function xpThresholdForScore(score: number): number {
  return (score - 1) * XP_PER_SCORE;
}

/** Returns the tier state for a given tier based on the current score. */
export function tierState(
  tier: TierDefinition,
  currentScore: number,
  hasScore: boolean,
): TierState {
  if (!hasScore) return "locked";
  if (tier.score === currentScore) return "current";
  if (tier.score < currentScore) return "past";
  return "locked";
}

/**
 * 🚨 LEGACY (pre spec 004). Same caveat as `xpThresholdForScore`.
 * DO NOT use in new code.
 */
export function xpNeededToUnlock(
  tier: TierDefinition,
  xpSafe: number,
  hasXp: boolean,
): number {
  if (!hasXp) return xpThresholdForScore(tier.score);
  const threshold = xpThresholdForScore(tier.score);
  return Math.max(0, threshold - xpSafe);
}

// Re-export MAX_SCORE for convenience (some callers use it alongside TIERS).
export { MAX_SCORE };
