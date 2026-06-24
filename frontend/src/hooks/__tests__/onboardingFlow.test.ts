/**
 * Pure logic test for the early-user screenKey decision tree in Borrow.tsx.
 *
 * The helper mirrors only the early-user branch (journey.isEarlyUser === true,
 * loansCount === 0) so we can exercise every condition without React, providers,
 * or browser APIs.
 */
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EarlyUserScreenOpts = {
  otpCompleted: boolean;
  phoneVerified: boolean;
  phoneJustVerified: boolean;
  isVerified: boolean;
  unlockedBorrow: boolean;
  verifyingFromOtp: boolean;
  verifyError: string | null;
  verifying: boolean;
  selfVerifiedInSession: boolean;
  mode: string;
};

// ---------------------------------------------------------------------------
// Mirror of the early-user block inside Borrow.tsx screenKey useMemo.
// Inputs: exactly the variables that affect the early-user branch when
// journey.isEarlyUser === true and loansCount === 0.
// Returns: one of the screen key strings.
// ---------------------------------------------------------------------------

function computeEarlyUserScreen(opts: EarlyUserScreenOpts): string {
  const {
    otpCompleted,
    phoneVerified,
    phoneJustVerified,
    isVerified,
    unlockedBorrow,
    verifyingFromOtp,
    verifyError,
    verifying,
    selfVerifiedInSession,
    mode,
  } = opts;

  // Farcaster needs self-verification after email OTP
  if (otpCompleted && mode === 'farcaster' && !selfVerifiedInSession) return 'early-self';

  // While verifyingFromOtp: stay on early-init so the green check animation plays
  if (verifyingFromOtp) return 'early-init';

  // After email OTP, verify phone before initializing account (wizard)
  if (otpCompleted && !phoneVerified && (mode === 'lemon' || mode === 'webapp')) return 'early-phone';

  // Phone just verified — show initializing splash briefly
  if (phoneJustVerified) return 'loading';

  // Fully done (email + phone + verified) → borrow
  if ((isVerified || unlockedBorrow) && phoneVerified) return 'borrow';

  // Phone verified → initialize account
  if (otpCompleted && mode !== 'farcaster') {
    if (verifyError) return 'early-init';
    return 'loading';
  }

  // Farcaster: verifying after self → loading
  if (verifying) return 'loading';

  // Still completing email/otp
  if (!otpCompleted || !!verifyError) return 'early-init';

  return 'loading';
}

// ---------------------------------------------------------------------------
// Default opts factory — represents a "clean" early user who has done nothing yet
// ---------------------------------------------------------------------------

function makeOpts(overrides: Partial<EarlyUserScreenOpts> = {}): EarlyUserScreenOpts {
  return {
    otpCompleted: false,
    phoneVerified: false,
    phoneJustVerified: false,
    isVerified: false,
    unlockedBorrow: false,
    verifyingFromOtp: false,
    verifyError: null,
    verifying: false,
    selfVerifiedInSession: false,
    mode: 'lemon',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Existing / returning user screen logic (non-early-user branch)
// ---------------------------------------------------------------------------

type ExistingUserScreenOpts = {
  isVerified: boolean;
  unlockedBorrow: boolean;
  userHasLoans: boolean;
  phoneVerified: boolean;
  hasOpenLoan: boolean;
  mode: string;
};

function computeExistingUserScreen(opts: ExistingUserScreenOpts): string {
  const { isVerified, unlockedBorrow, userHasLoans, phoneVerified, hasOpenLoan, mode } = opts;

  // Phone verification gate for existing users (standalone)
  if ((isVerified || unlockedBorrow || userHasLoans) && !phoneVerified && !hasOpenLoan && (mode === 'lemon' || mode === 'webapp')) {
    return 'phone-verify';
  }

  if (isVerified || unlockedBorrow || userHasLoans) return 'borrow';

  return 'not-available';
}

function makeExistingOpts(overrides: Partial<ExistingUserScreenOpts> = {}): ExistingUserScreenOpts {
  return {
    isVerified: true,
    unlockedBorrow: false,
    userHasLoans: false,
    phoneVerified: true,
    hasOpenLoan: false,
    mode: 'lemon',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('computeExistingUserScreen — verified user phone gate', () => {
  it('returns "phone-verify" when user is verified but phone NOT verified (lemon)', () => {
    expect(
      computeExistingUserScreen(makeExistingOpts({ isVerified: true, phoneVerified: false, mode: 'lemon' })),
    ).toBe('phone-verify');
  });

  it('returns "phone-verify" when user is verified but phone NOT verified (webapp)', () => {
    expect(
      computeExistingUserScreen(makeExistingOpts({ isVerified: true, phoneVerified: false, mode: 'webapp' })),
    ).toBe('phone-verify');
  });

  it('returns "phone-verify" when user has loans but phone NOT verified', () => {
    expect(
      computeExistingUserScreen(makeExistingOpts({
        isVerified: false,
        userHasLoans: true,
        phoneVerified: false,
      })),
    ).toBe('phone-verify');
  });

  it('returns "phone-verify" when unlockedBorrow but phone NOT verified', () => {
    expect(
      computeExistingUserScreen(makeExistingOpts({
        isVerified: false,
        unlockedBorrow: true,
        phoneVerified: false,
      })),
    ).toBe('phone-verify');
  });

  it('skips phone gate and returns "borrow" when phone IS verified', () => {
    expect(
      computeExistingUserScreen(makeExistingOpts({ isVerified: true, phoneVerified: true })),
    ).toBe('borrow');
  });

  it('skips phone gate when user has an open loan (no bloquear pago)', () => {
    expect(
      computeExistingUserScreen(makeExistingOpts({
        isVerified: true,
        phoneVerified: false,
        hasOpenLoan: true,
      })),
    ).toBe('borrow');
  });

  it('skips phone gate for farcaster mode', () => {
    expect(
      computeExistingUserScreen(makeExistingOpts({
        isVerified: true,
        phoneVerified: false,
        mode: 'farcaster',
      })),
    ).toBe('borrow');
  });

  it('returns "not-available" when user is not verified and has no loans', () => {
    expect(
      computeExistingUserScreen(makeExistingOpts({
        isVerified: false,
        unlockedBorrow: false,
        userHasLoans: false,
      })),
    ).toBe('not-available');
  });
});

describe('computeEarlyUserScreen — early-user screenKey logic', () => {
  describe('early-init cases', () => {
    it('returns "early-init" when OTP not completed', () => {
      expect(computeEarlyUserScreen(makeOpts({ otpCompleted: false }))).toBe('early-init');
    });

    it('returns "early-init" when OTP not completed even if phone is verified', () => {
      expect(
        computeEarlyUserScreen(makeOpts({ otpCompleted: false, phoneVerified: true })),
      ).toBe('early-init');
    });

    it('returns "early-init" when verifyingFromOtp is true', () => {
      expect(
        computeEarlyUserScreen(makeOpts({ otpCompleted: true, verifyingFromOtp: true })),
      ).toBe('early-init');
    });

    it('returns "early-init" when verifyingFromOtp is true regardless of phone status', () => {
      expect(
        computeEarlyUserScreen(
          makeOpts({ otpCompleted: true, verifyingFromOtp: true, phoneVerified: true }),
        ),
      ).toBe('early-init');
    });

    it('returns "early-init" when otpCompleted but verifyError is set (lemon)', () => {
      expect(
        computeEarlyUserScreen(
          makeOpts({
            otpCompleted: true,
            phoneVerified: true,
            verifyError: 'some error',
            mode: 'lemon',
          }),
        ),
      ).toBe('early-init');
    });
  });

  describe('early-phone cases', () => {
    it('returns "early-phone" when otpCompleted but phone not verified (lemon)', () => {
      expect(
        computeEarlyUserScreen(makeOpts({ otpCompleted: true, phoneVerified: false, mode: 'lemon' })),
      ).toBe('early-phone');
    });

    it('returns "early-phone" when otpCompleted but phone not verified (webapp)', () => {
      expect(
        computeEarlyUserScreen(makeOpts({ otpCompleted: true, phoneVerified: false, mode: 'webapp' })),
      ).toBe('early-phone');
    });

    it('does NOT return "early-phone" for farcaster mode', () => {
      const screen = computeEarlyUserScreen(
        makeOpts({
          otpCompleted: true,
          phoneVerified: false,
          selfVerifiedInSession: true,
          mode: 'farcaster',
        }),
      );
      expect(screen).not.toBe('early-phone');
    });
  });

  describe('loading cases', () => {
    it('returns "loading" when phoneJustVerified is true (even if isVerified)', () => {
      expect(
        computeEarlyUserScreen(
          makeOpts({
            otpCompleted: true,
            phoneVerified: true,
            phoneJustVerified: true,
            isVerified: true,
          }),
        ),
      ).toBe('loading');
    });

    it('returns "loading" when otpCompleted and phoneVerified but isVerified is still false', () => {
      expect(
        computeEarlyUserScreen(
          makeOpts({
            otpCompleted: true,
            phoneVerified: true,
            phoneJustVerified: false,
            isVerified: false,
            unlockedBorrow: false,
          }),
        ),
      ).toBe('loading');
    });

    it('returns "loading" when farcaster user is verifying after self-verification', () => {
      expect(
        computeEarlyUserScreen(
          makeOpts({
            otpCompleted: true,
            selfVerifiedInSession: true,
            mode: 'farcaster',
            verifying: true,
          }),
        ),
      ).toBe('loading');
    });
  });

  describe('borrow cases', () => {
    it('returns "borrow" when isVerified and phoneVerified and not phoneJustVerified', () => {
      expect(
        computeEarlyUserScreen(
          makeOpts({
            otpCompleted: true,
            phoneVerified: true,
            phoneJustVerified: false,
            isVerified: true,
          }),
        ),
      ).toBe('borrow');
    });

    it('returns "borrow" when unlockedBorrow and phoneVerified (isVerified not required)', () => {
      expect(
        computeEarlyUserScreen(
          makeOpts({
            otpCompleted: true,
            phoneVerified: true,
            phoneJustVerified: false,
            isVerified: false,
            unlockedBorrow: true,
          }),
        ),
      ).toBe('borrow');
    });
  });

  describe('early-self cases (farcaster)', () => {
    it('returns "early-self" when farcaster mode, otpCompleted, and not self-verified', () => {
      expect(
        computeEarlyUserScreen(
          makeOpts({ otpCompleted: true, mode: 'farcaster', selfVerifiedInSession: false }),
        ),
      ).toBe('early-self');
    });

    it('does NOT return "early-self" when self-verified in farcaster', () => {
      const screen = computeEarlyUserScreen(
        makeOpts({ otpCompleted: true, mode: 'farcaster', selfVerifiedInSession: true }),
      );
      expect(screen).not.toBe('early-self');
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Spec 055 — hasOpenLoan derivation: bug reproduction + fix verification
//
// The phantom-closed bug: spec 013 backfilled closedAt=dueAt on 864 defaulted
// loans, leaving closeTxHash=NULL. The OLD frontend formula
//   hasOpenLoan = loansCount > closedLoansCount
// returned FALSE for these users (because closedAt was set), routing 670
// phone-unverified borrowers to the phone-verify wizard instead of the
// RepayPanel. They had real debt on-chain but couldn't reach the pay button.
//
// The NEW formula
//   hasOpenLoan = openLoansCount > 0
// reads `openLoansCount`, which the backend computes from `closeTxHash IS NULL`
// — the only source of truth for "still owes on-chain".
// ═════════════════════════════════════════════════════════════════════════════

// OLD (buggy) derivation — kept here only to demonstrate that we can REPRODUCE
// the bug under the legacy logic. The production code no longer uses this.
function legacyHasOpenLoan(loansCount: number | null, closedLoansCount: number | null): boolean {
  return (
    typeof loansCount === 'number' &&
    typeof closedLoansCount === 'number' &&
    loansCount > closedLoansCount
  );
}

// NEW derivation — must mirror Borrow.tsx exactly.
function hasOpenLoan(openLoansCount: number | null): boolean {
  return typeof openLoansCount === 'number' && openLoansCount > 0;
}

// Fixtures from spec 055 §1.4 — real prod state of the two emailed support tickets.
const CARLOS_PROD_STATE = {
  email: 'alvarezcarlosivan408@gmail.com',
  userId: 1210,
  // 2 loans total, both have closedAt populated. Only 1 of them ever closed
  // on-chain (closeTxHash IS NOT NULL). The other is the phantom-closed
  // defaulted loan (status='defaulted', dueAt=08/02/2026, 91 days overdue).
  loansCount: 2,
  closedLoansCount: 2, // bug surface: closedAt counts the phantom as closed
  openLoansCount: 1,   // truth: closeTxHash IS NULL still on 1 loan
};

const RAFAEL_PROD_STATE = {
  email: 'rosalescarorafael@gmail.com',
  userId: 584,
  loansCount: 10,
  closedLoansCount: 10, // bug surface
  openLoansCount: 1,    // truth: 9 paid + 1 phantom-defaulted in_grace
};

describe('Spec 055 — hasOpenLoan derivation (Carlos / Rafael bug)', () => {
  describe('OLD formula reproduces the bug', () => {
    it("Carlos: legacy formula returns FALSE despite real debt (this is the bug)", () => {
      const { loansCount, closedLoansCount } = CARLOS_PROD_STATE;
      expect(legacyHasOpenLoan(loansCount, closedLoansCount)).toBe(false);
    });

    it("Rafael: legacy formula returns FALSE despite real debt (this is the bug)", () => {
      const { loansCount, closedLoansCount } = RAFAEL_PROD_STATE;
      expect(legacyHasOpenLoan(loansCount, closedLoansCount)).toBe(false);
    });
  });

  describe('NEW formula fixes both cases', () => {
    it("Carlos: openLoansCount-based formula returns TRUE (fix)", () => {
      expect(hasOpenLoan(CARLOS_PROD_STATE.openLoansCount)).toBe(true);
    });

    it("Rafael: openLoansCount-based formula returns TRUE (fix)", () => {
      expect(hasOpenLoan(RAFAEL_PROD_STATE.openLoansCount)).toBe(true);
    });
  });

  describe('NEW formula edge cases', () => {
    it('returns false when openLoansCount is 0', () => {
      expect(hasOpenLoan(0)).toBe(false);
    });

    it('returns false when openLoansCount is null (not yet loaded)', () => {
      expect(hasOpenLoan(null)).toBe(false);
    });

    it('returns true for any positive integer', () => {
      expect(hasOpenLoan(1)).toBe(true);
      expect(hasOpenLoan(5)).toBe(true);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Spec 055 — full screenKey routing for the existing-user branch using the
// NEW hasOpenLoan derivation, exercised through the same gate logic in
// Borrow.tsx:245-249.
// ═════════════════════════════════════════════════════════════════════════════

describe("Spec 055 — Borrow.tsx routing with openLoansCount → screenKey", () => {
  // T1: user with no loans + no phone → goes to phone-verify (gate fires).
  it("T1: new user (no loans, no phone, webapp) → 'phone-verify'", () => {
    expect(
      computeExistingUserScreen(
        makeExistingOpts({
          isVerified: true,
          userHasLoans: false,
          phoneVerified: false,
          hasOpenLoan: hasOpenLoan(0),
          mode: 'webapp',
        }),
      ),
    ).toBe('phone-verify');
  });

  // T2: CORE OF THE FIX. Carlos's state: has loans, no phone, openLoansCount=1
  // → MUST go to 'borrow' (bypass gate). With the OLD formula this returned
  // 'phone-verify' and the user couldn't pay.
  it("T2: Carlos's state (openLoansCount=1, no phone, webapp) → 'borrow' [FIX CORE]", () => {
    expect(
      computeExistingUserScreen(
        makeExistingOpts({
          isVerified: false,
          userHasLoans: true,
          phoneVerified: false,
          hasOpenLoan: hasOpenLoan(CARLOS_PROD_STATE.openLoansCount),
          mode: 'webapp',
        }),
      ),
    ).toBe('borrow');
  });

  // T3: same user but with phone verified — normal happy path.
  it("T3: phone verified + has open loan → 'borrow'", () => {
    expect(
      computeExistingUserScreen(
        makeExistingOpts({
          isVerified: true,
          userHasLoans: true,
          phoneVerified: true,
          hasOpenLoan: hasOpenLoan(1),
        }),
      ),
    ).toBe('borrow');
  });

  // T4: user verified, no loans, has phone → normal new-borrower flow.
  it("T4: verified + phone + no loans → 'borrow' (normal flow)", () => {
    expect(
      computeExistingUserScreen(
        makeExistingOpts({
          isVerified: true,
          userHasLoans: false,
          phoneVerified: true,
          hasOpenLoan: hasOpenLoan(0),
        }),
      ),
    ).toBe('borrow');
  });

  // T5: bypass must also work in lemon (the gate at Borrow.tsx:245 applies to
  // both lemon and webapp). The 2026-04 lemon cohort is most of the stuck 670.
  it("T5: Rafael's state in lemon mode → 'borrow' (bypass works in lemon too)", () => {
    expect(
      computeExistingUserScreen(
        makeExistingOpts({
          isVerified: false,
          userHasLoans: true,
          phoneVerified: false,
          hasOpenLoan: hasOpenLoan(RAFAEL_PROD_STATE.openLoansCount),
          mode: 'lemon',
        }),
      ),
    ).toBe('borrow');
  });

  // After-repay regression: once the user pays, openLoansCount drops to 0, so
  // the gate must REACTIVATE if they ever come back without phone-verifying.
  // This guards against accidentally turning the bypass into a permanent skip.
  it("post-repay: openLoansCount=0 + no phone → gate reactivates ('phone-verify')", () => {
    expect(
      computeExistingUserScreen(
        makeExistingOpts({
          isVerified: true,
          userHasLoans: true,        // they still HAVE loans in history
          phoneVerified: false,
          hasOpenLoan: hasOpenLoan(0), // ...but none open anymore
          mode: 'webapp',
        }),
      ),
    ).toBe('phone-verify');
  });
});
