// src/domain/services/credit-policy.service.ts
import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import type { CreditTier } from 'src/domain/entities/loan.entity';

/**
 * Late fee rate in WAD (1e18) per second — spec 024 calibration.
 *
 * 5% monthly on amountDue (USDC 6 decimals), proportional, no cap:
 *   rate = 0.05 / (30 * 86400) * 1e18 ≈ 19_290_123_457
 *
 * Verification: $1 loan × 30 days late → $0.05 late fee (5% monthly).
 *
 * History:
 *   - Originally 96_450_617_284n (25% monthly). Disabled protocol-wide
 *     2026-04-18 after the "loan 2885 / Lukas Benitez" incident where a
 *     user got permanently stuck unable to repay. Root cause: missing
 *     accrueLate calls + strict-equal repay check (see spec 024 §1).
 *   - Re-enabled 2026-04-28 at 19_290_123_457n (5% monthly) per spec 024
 *     §2.1, alongside the moving-target fix (frontend uses
 *     repay(MaxUint256), backend calls accrueLate before repay).
 */
export const LATE_RATE_PER_SEC_WAD = BigInt('19290123457');

// ── 5-Tier Dynamic Pricing ──────────────────────────────────────────

export type WalletQuality = 'buena' | 'media' | 'fea';

export type PricingTierName =
  | 'Prime+'
  | 'Prime'
  | 'Standard'
  | 'Near-Prime'
  | 'Developing';

export interface PricingTierResult {
  tier: PricingTierName;
  monthlyRate: number; // e.g. 0.14 for 14%
}

export interface CreditLadderStep {
  /** Cantidad mínima de préstamos repagados on-time para estar en este escalón. */
  minOnTimeLoans: number;
  /** Score lógico de 1 a 1000. */
  score: number;
  /** Límite de crédito máximo para este escalón (en USDC, valor humano: 3, 4, 6, 10, 500, 1000, etc.). */
  limitUsdc: number;
  /**
   * XP "base" esperada para este escalón.
   * Por ahora es solo referencial. No se usa directamente todavía,
   * porque tu XP lo maneja AchievementService.
   */
  xpBase: number;
}

/**
 * Escalera discreta de reputación (11 niveles):
 * - súper conservadora al principio (1 → 3 → 4 → 6 → 8 → 10…)
 * - nivel intermedio de $4 después de $3 para suavizar la curva
 * - $25 recién con 10 préstamos on-time (score 11)
 *
 * IMPORTANTE:
 * - onTimeLoans = cantidad de préstamos repagados en tiempo.
 * - podés tunear estos números tranquilo, es puro config.
 */
const CREDIT_LADDER: CreditLadderStep[] = [
  { minOnTimeLoans: 0, score: 1, limitUsdc: 1, xpBase: 1 },
  { minOnTimeLoans: 1, score: 2, limitUsdc: 3, xpBase: 11 },
  { minOnTimeLoans: 2, score: 3, limitUsdc: 4, xpBase: 21 },
  { minOnTimeLoans: 3, score: 4, limitUsdc: 6, xpBase: 31 },
  { minOnTimeLoans: 4, score: 5, limitUsdc: 8, xpBase: 41 },
  { minOnTimeLoans: 5, score: 6, limitUsdc: 10, xpBase: 51 },
  { minOnTimeLoans: 6, score: 7, limitUsdc: 12, xpBase: 61 },
  { minOnTimeLoans: 7, score: 8, limitUsdc: 15, xpBase: 71 },
  { minOnTimeLoans: 8, score: 9, limitUsdc: 18, xpBase: 81 },
  { minOnTimeLoans: 9, score: 10, limitUsdc: 22, xpBase: 91 },
  { minOnTimeLoans: 10, score: 11, limitUsdc: 25, xpBase: 101 },
];

/**
 * Tabla de tasas base por score.
 *
 * La idea:
 * - score bajo ⇒ tasa mensual ~25%
 * - score medio ⇒ baja de a pequeños escalones
 * - score muy alto ⇒ tasa mejor (todavía alta porque es producto riesgoso)
 */
@Injectable()
export class CreditPolicyService {
  /**
   * Devuelve el escalón de reputación que le corresponde a un usuario
   * con N préstamos repagados a tiempo.
   */
  getStepForOnTimeLoans(onTimeLoans: number): CreditLadderStep {
    let best = CREDIT_LADDER[0];
    for (const step of CREDIT_LADDER) {
      if (onTimeLoans >= step.minOnTimeLoans) {
        best = step;
      } else {
        break;
      }
    }
    return best;
  }

  /**
   * Devuelve el escalón de la escalera que corresponde al score dado (1–1000).
   * Busca el último escalón cuyo campo `score` sea <= al score recibido.
   */
  getStepForScore(score: number): CreditLadderStep {
    let best = CREDIT_LADDER[0];
    for (const step of CREDIT_LADDER) {
      if (score >= step.score) {
        best = step;
      } else {
        break;
      }
    }
    return best;
  }

  /**
   * Dado un score (1–1000) devuelve la tasa mensual base como Decimal:
   *   0.25 = 25% mensual.
   *
   * Esto después se ajusta por plazo (7, 14, 21 días) como ya hacés.
   */
  getBaseMonthlyRateForScore(score: number | null | undefined): Decimal {
    const s = score ?? 1;

    if (s <= 3) return new Decimal(0.25); // 25% mensual
    if (s <= 5) return new Decimal(0.24);
    if (s <= 10) return new Decimal(0.23);
    if (s <= 15) return new Decimal(0.22);
    return new Decimal(0.21);
  }

  /**
   * Get risk-adjusted monthly rate (LEGACY, pre-5-tier).
   *
   * Used as fallback when 5-tier context (tieredParams) is not available
   * in LoanService.getRatesForTerm. The 5-tier system (getTieredMonthlyRate)
   * is the primary pricing path.
   *
   * The credit ladder defines the BASE rate per score.
   * The risk model adjusts it based on p_default:
   *   - p_default < 0.10 (Prime): -5pp discount
   *   - p_default 0.10-0.20 (Standard): no adjustment (base rate)
   *   - p_default 0.20-0.30 (Cautious): +5pp surcharge
   *   - p_default 0.30-0.50 (Restricted): +8pp surcharge, capped at 30%
   *   - Clamped to [15%, 30%]
   *
   * Null-pDefault policy (NEUTRAL): returns the score-based base rate
   * without adjustment. This is intentionally different from
   * getTieredMonthlyRate (which treats null as worst case). See B12 in
   * the pre-deploy audit: the legacy path must stay neutral so existing
   * users don't see rate jumps on missing risk data.
   */
  getRiskAdjustedMonthlyRate(
    score: number | null,
    pDefault: number | null,
  ): Decimal {
    const baseRate = this.getBaseMonthlyRateForScore(score);
    // Null or invalid pDefault → neutral (no adjustment). See docblock.
    if (
      pDefault == null ||
      !Number.isFinite(pDefault) ||
      pDefault < 0 ||
      pDefault > 1
    ) {
      return baseRate;
    }

    let adjustment: number;
    if (pDefault < 0.1)
      adjustment = -0.05; // Prime discount
    else if (pDefault < 0.2)
      adjustment = 0; // Standard
    else if (pDefault < 0.3)
      adjustment = 0.05; // Cautious surcharge
    else adjustment = 0.08; // Restricted surcharge

    const adjusted = baseRate.plus(adjustment);
    // Clamp to [15%, 30%]
    const MIN_RATE = new Decimal(0.15);
    const MAX_RATE = new Decimal(0.3);
    return Decimal.max(MIN_RATE, Decimal.min(MAX_RATE, adjusted));
  }

  // ── 5-Tier Dynamic Pricing with Seasoning ──────────────────────────
  //
  // Tiers (from best to worst rate):
  //   Prime+     (14%): pDefault < 5%  + wallet buena + 7+ on-time + ≤1 late
  //   Prime      (18%): pDefault < 10% + wallet buena/media + 5+ on-time + ≤2 lates
  //   Standard   (20-24%): 3+ on-time OR pDefault < 15% (±2pp wallet adj)
  //   Near-Prime (24-28%): 1+ on-time OR pDefault < 25% (±2pp wallet adj)
  //   Developing (28%): 0 on-time (first loan, no adjustment)
  //
  // Loyalty override (anti-farming, volume-gated):
  //   buena override: 30+ on-time + $200+ repaid + 0 lates → Prime+ 14%
  //   media override: 20+ on-time + $50+ repaid + <3 lates → Prime 18%
  //   Wallet fea caps at Standard without override.

  /**
   * sv-weighted thresholds aligned with risk-model/scoring/api/routes.
   *
   * Distribution on backfilled 990 borrowers: ~10% buena / ~39% media / ~51% fea.
   *
   * Rationale:
   * - `buena` requires either very high stablecoin volume ($1K+ in external
   *   stables is nearly impossible to fake via Lendoor loans, which cap at
   *   ~$25 per loan) or moderate volume PLUS multi-chain presence PLUS
   *   wallet age. Rewards demonstrated DeFi footprint.
   * - `media` requires any one of: decent stable volume ($20+), multi-chain
   *   activity (2+ chains), or real gas spend on an established wallet.
   * - `fea` = no external signal. Pure-Lendoor users land here; they can
   *   still reach Prime via loyalty override (30+ on-time + $200+ repaid).
   */
  classifyWalletQuality(params: {
    stablecoinVolume: number;
    walletAgeDays: number;
    totalTxCount: number;
    chainsActive?: number;
    gasSpentUsd?: number;
  }): WalletQuality {
    const {
      stablecoinVolume,
      walletAgeDays,
      chainsActive = 0,
      gasSpentUsd = 0,
    } = params;

    if (
      stablecoinVolume > 1000 ||
      (stablecoinVolume > 200 && chainsActive >= 3 && walletAgeDays > 200)
    ) {
      return 'buena';
    }
    if (
      stablecoinVolume > 20 ||
      chainsActive >= 2 ||
      (gasSpentUsd >= 0.5 && walletAgeDays > 150)
    ) {
      return 'media';
    }
    return 'fea';
  }

  /**
   * 5-tier pricing with seasoning and loyalty overrides.
   *
   * Null-pDefault policy (CONSERVATIVE): null/invalid pDefault is treated
   * as the worst case (1.0), which forces the user into the Developing
   * tier (28%) until a real risk score exists. This is intentional: a
   * user with no risk data has not earned a better tier yet. Contrast
   * with getRiskAdjustedMonthlyRate (legacy) which stays neutral on null.
   */
  getTieredMonthlyRate(
    pDefault: number | null,
    onTimeLoans: number,
    walletQuality: WalletQuality,
    totalRepaidUsd: number = 0,
    lateLoans: number = 0,
  ): PricingTierResult {
    const pd =
      pDefault != null && Number.isFinite(pDefault) && pDefault >= 0 && pDefault <= 1
        ? pDefault
        : 1; // treat missing pDefault as worst case (see docblock)

    // ── Loyalty override (anti-farming, late-gated) ──
    const buenaOverride =
      onTimeLoans >= 30 && totalRepaidUsd >= 200 && lateLoans === 0;
    const mediaOverride =
      onTimeLoans >= 20 && totalRepaidUsd >= 50 && lateLoans < 3;

    if (buenaOverride) {
      return { tier: 'Prime+', monthlyRate: 0.14 };
    }
    if (mediaOverride) {
      return { tier: 'Prime', monthlyRate: 0.18 };
    }

    // Spec 072 §7ter.3 — walletQuality REMOVED from pricing. The granular v4.1
    // p_default already carries the wallet signal (chains_active, stablecoin_volume
    // etc. are model features), so gating on the coarse buena/media/fea
    // double-counted it AND unfairly penalized the 58% 'fea' — many of whom are
    // 'fea' only because GoldRush was down, not because they're risky. Pricing now
    // depends on real risk (p_default) + behaviour (on-time/late), not wallet bucket.
    // `walletQuality` is kept in the signature for caller compatibility but unused.

    // Prime+ (14%): 7+ on-time + pDefault < 5% + ≤1 late
    if (pd < 0.05 && onTimeLoans >= 7 && lateLoans <= 1) {
      return { tier: 'Prime+', monthlyRate: 0.14 };
    }

    // Prime (18%): 5+ on-time + pDefault < 10% + ≤2 lates
    if (pd < 0.1 && onTimeLoans >= 5 && lateLoans <= 2) {
      return { tier: 'Prime', monthlyRate: 0.18 };
    }

    // Standard (22% ± 2pp): 3+ on-time OR pDefault < 15%. The ±2pp now comes from
    // the GRANULAR p_default within the band (lower pd → cheaper), replacing the
    // coarse walletQuality adjustment.
    if (onTimeLoans >= 3 || pd < 0.15) {
      const adj = Math.max(-0.02, Math.min(0.02, (pd / 0.15 - 0.5) * 0.04));
      return { tier: 'Standard', monthlyRate: 0.22 + adj };
    }

    // Near-Prime (26% ± 2pp): 1+ on-time OR pDefault < 25%. ±2pp from granular p_default.
    if (onTimeLoans >= 1 || pd < 0.25) {
      const adj = Math.max(-0.02, Math.min(0.02, (pd / 0.25 - 0.5) * 0.04));
      return { tier: 'Near-Prime', monthlyRate: 0.26 + adj };
    }

    // Developing (28%): everything else (first loan, no adjustment)
    return { tier: 'Developing', monthlyRate: 0.28 };
  }

  /**
   * Returns the full credit ladder as an array of CreditTier objects.
   * The frontend uses this to render the gamification roadmap and tier
   * progression without hardcoding values.
   */
  getLadder(): CreditTier[] {
    return CREDIT_LADDER.map((step) => ({
      level: step.score,
      minOnTimeLoans: step.minOnTimeLoans,
      limitUsdc: step.limitUsdc,
      baseRateMonthly: Number(this.getBaseMonthlyRateForScore(step.score)),
    }));
  }
}
