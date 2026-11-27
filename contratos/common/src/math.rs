//! Checked multiply-then-divide for share / fee / interest math.
//!
//! The vault and the loan-manager compute `a * b / c` everywhere (OZ virtual
//! shares, bps fees, pro-rata interest). With plain `i128` operators the
//! product can overflow before the division and, with `overflow-checks = true`,
//! the call aborts with an opaque trap. Doing the product in `I256` removes the
//! intermediate overflow entirely; the only remaining failure modes are a zero
//! divisor or a quotient that does not fit `i128`, both reported as `None` so
//! the caller can raise its own typed error (`MathOverflow`).
//!
//! All inputs are expected to be non-negative (amounts, shares, bps). Negative
//! inputs are rejected (`None`) instead of guessing a rounding direction.

use soroban_sdk::{Env, I256};

/// `floor(a * b / c)`; `None` if any input is negative, `c == 0`, or the result
/// does not fit in `i128`.
pub fn mul_div_floor(e: &Env, a: i128, b: i128, c: i128) -> Option<i128> {
    if a < 0 || b < 0 || c <= 0 {
        return None;
    }
    let num = I256::from_i128(e, a).mul(&I256::from_i128(e, b));
    num.div(&I256::from_i128(e, c)).to_i128()
}

/// `ceil(a * b / c)` = `floor((a * b + c - 1) / c)`; same failure modes as
/// [`mul_div_floor`].
pub fn mul_div_ceil(e: &Env, a: i128, b: i128, c: i128) -> Option<i128> {
    if a < 0 || b < 0 || c <= 0 {
        return None;
    }
    let num = I256::from_i128(e, a)
        .mul(&I256::from_i128(e, b))
        .add(&I256::from_i128(e, c - 1));
    num.div(&I256::from_i128(e, c)).to_i128()
}

/// Basis-points helper: `floor(amount * bps / 10_000)`.
pub fn bps_of(e: &Env, amount: i128, bps: i128) -> Option<i128> {
    mul_div_floor(e, amount, bps, 10_000)
}
