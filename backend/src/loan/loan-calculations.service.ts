// src/loan/loan-calculations.service.ts
// Offline late-fee calculator (no RPC). Moved from collections/ to loan/
// for the stellar base where the collections module is removed.
import { Injectable } from '@nestjs/common';

export interface LateFeesInput {
  amountDueAtOpenUsd: number;
  dueAtUnixSec: number;
  ratePerSecWad: bigint;
  gracePeriodSec: number;
  nowUnixSec?: number;
}

export interface LateFeesResult {
  lateFeesUsd: number;
  amountDueRealUsd: number;
  daysLate: number;
  inGracePeriod: boolean;
  perDayDeltaUsd: number;
  lateStartUnixSec: number;
}

@Injectable()
export class LoanCalculationsService {
  computeLateFees(input: LateFeesInput): LateFeesResult {
    const nowUnix = input.nowUnixSec ?? Math.floor(Date.now() / 1000);
    const lateStart = input.dueAtUnixSec + input.gracePeriodSec;

    const inGrace = nowUnix < lateStart;
    const moraDisabled = input.ratePerSecWad === 0n;

    if (inGrace || moraDisabled) {
      return {
        lateFeesUsd: 0,
        amountDueRealUsd: input.amountDueAtOpenUsd,
        daysLate: 0,
        inGracePeriod: inGrace,
        perDayDeltaUsd: 0,
        lateStartUnixSec: lateStart,
      };
    }

    const secondsPastLate = nowUnix - lateStart;
    const ratePerSecNum = Number(input.ratePerSecWad) / 1e18;
    const lateFees = input.amountDueAtOpenUsd * ratePerSecNum * secondsPastLate;
    const perDayDelta = input.amountDueAtOpenUsd * ratePerSecNum * 86400;
    const daysLate = secondsPastLate / 86400;

    return {
      lateFeesUsd: lateFees,
      amountDueRealUsd: input.amountDueAtOpenUsd + lateFees,
      daysLate,
      inGracePeriod: false,
      perDayDeltaUsd: perDayDelta,
      lateStartUnixSec: lateStart,
    };
  }

  daysOverdue(dueAtUnixSec: number, nowUnixSec?: number): number {
    const nowUnix = nowUnixSec ?? Math.floor(Date.now() / 1000);
    const diff = nowUnix - dueAtUnixSec;
    return Math.max(0, Math.ceil(diff / 86400));
  }

  formatAmountForVoice(amountUsd: number): { whole: number; cents: number } {
    const whole = Math.floor(amountUsd);
    const cents = Math.round((amountUsd - whole) * 100);
    return { whole, cents };
  }
}
