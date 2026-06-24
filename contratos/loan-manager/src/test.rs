#![cfg(test)]
//! Loan-manager test suite. Mirrors every LoanManager surface the Lendoor
//! frontend + vault actually touch:
//!   reads  : credit_limit, get_user_risk (`users`), get_loan (`loans`),
//!            next_borrow_time (`nextBorrowTime`), get_premium (`premiums`),
//!            preview_owed / preview_loan_with_late (`previewLoanWithLate`),
//!            is_defaulted
//!   writes : set_user_risk, set_loan_offer, open_loan, close_loan,
//!            mark_default, set_premium_config, accrue_late
//!   auth   : owner-gated admin, vault-gated loan lifecycle
use crate::{Error, LoanManager, LoanManagerClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env,
};

const DAY: u64 = 86_400;
const USDC: i128 = 1_000_000; // 1 USDC (6 decimals)

fn setup() -> (Env, Address, Address, LoanManagerClient<'static>) {
    let e = Env::default();
    e.mock_all_auths();
    let owner = Address::generate(&e);
    let vault = Address::generate(&e);
    let id = e.register(LoanManager, (owner.clone(), vault.clone()));
    let client = LoanManagerClient::new(&e, &id);
    (e, owner, vault, client)
}

/// Same as `setup` but WITHOUT mocked auths, so `require_auth()` actually bites.
fn setup_no_mock() -> (Env, Address, Address, LoanManagerClient<'static>) {
    let e = Env::default();
    let owner = Address::generate(&e);
    let vault = Address::generate(&e);
    let id = e.register(LoanManager, (owner.clone(), vault.clone()));
    let client = LoanManagerClient::new(&e, &id);
    (e, owner, vault, client)
}

fn advance(e: &Env, secs: u64) {
    e.ledger().with_mut(|li| li.timestamp += secs);
}

// ─────────────────────────── risk / credit reads ───────────────────────────

#[test]
fn credit_limit_respects_kyc_and_expiry() {
    let (e, _owner, _vault, c) = setup();
    let user = Address::generate(&e);

    // No risk set -> 0.
    assert_eq!(c.credit_limit(&user), 0);

    // KYC ok, no expiry -> full limit.
    c.set_user_risk(&user, &500, &true, &0, &(25 * USDC));
    assert_eq!(c.credit_limit(&user), 25 * USDC);

    // KYC false -> 0.
    c.set_user_risk(&user, &500, &false, &0, &(25 * USDC));
    assert_eq!(c.credit_limit(&user), 0);

    // KYC ok but expired -> 0.
    let now = e.ledger().timestamp();
    c.set_user_risk(&user, &500, &true, &(now + 10), &(25 * USDC));
    assert_eq!(c.credit_limit(&user), 25 * USDC);
    advance(&e, 20);
    assert_eq!(c.credit_limit(&user), 0);
}

#[test]
fn get_user_risk_mirrors_users_getter() {
    let (e, _owner, _vault, c) = setup();
    let user = Address::generate(&e);

    // Unset -> zeroed profile (frontend renders "unscored").
    let r0 = c.get_user_risk(&user);
    assert_eq!(r0.score, 0);
    assert!(!r0.kyc_ok);
    assert_eq!(r0.limit, 0);

    // After scoring, the RAW stored fields come back (not the effective limit).
    c.set_user_risk(&user, &742, &true, &0, &(25 * USDC));
    let r = c.get_user_risk(&user);
    assert_eq!(r.score, 742);
    assert!(r.kyc_ok);
    assert_eq!(r.limit, 25 * USDC);
    assert_eq!(r.valid_until, 0);
}

#[test]
fn set_user_risk_rejects_negative_limit() {
    let (e, _owner, _vault, c) = setup();
    let user = Address::generate(&e);
    assert_eq!(
        c.try_set_user_risk(&user, &500, &true, &0, &(-1)),
        Err(Ok(Error::InvalidParam.into()))
    );
}

// ─────────────────────────── offer + open_loan ─────────────────────────────

#[test]
fn full_borrow_and_repay_cycle() {
    let (e, _owner, _vault, c) = setup();
    let user = Address::generate(&e);
    let now = e.ledger().timestamp();

    c.set_user_risk(&user, &600, &true, &0, &(25 * USDC));
    c.set_loan_offer(&user, &7, &500, &(now + DAY), &(25 * USDC)); // 7d, 5%

    c.open_loan(&user, &(10 * USDC), &7, &500);
    let l = c.get_loan(&user);
    assert!(l.active);
    assert_eq!(l.principal, 10 * USDC);
    assert_eq!(l.amount_due, 10 * USDC * 10_500 / 10_000); // +5%
    assert_eq!(l.tenor_days, 7);
    assert_eq!(l.fee_bps, 500);
    assert_eq!(l.due, l.start + 7 * DAY);
    assert!(!l.defaulted);

    // A second open while the loan is still active is rejected (LoanActive
    // fires before the consumed-offer check; one-shot offers are covered
    // separately in `open_without_offer_fails`).
    assert_eq!(
        c.try_open_loan(&user, &(10 * USDC), &7, &500),
        Err(Ok(Error::LoanActive.into()))
    );

    // Repay full closes the loan.
    c.close_loan(&user, &l.amount_due);
    let cl = c.get_loan(&user);
    assert!(!cl.active);
    assert_eq!(cl.principal, 0);
}

#[test]
fn open_without_offer_fails() {
    let (e, _owner, _vault, c) = setup();
    let user = Address::generate(&e);
    c.set_user_risk(&user, &600, &true, &0, &(25 * USDC));
    assert_eq!(
        c.try_open_loan(&user, &(10 * USDC), &7, &500),
        Err(Ok(Error::NoOffer.into()))
    );
}

#[test]
fn open_with_expired_offer_fails() {
    let (e, _owner, _vault, c) = setup();
    let user = Address::generate(&e);
    let now = e.ledger().timestamp();
    c.set_user_risk(&user, &600, &true, &0, &(25 * USDC));
    c.set_loan_offer(&user, &7, &500, &(now + 10), &(25 * USDC));
    advance(&e, 20);
    assert_eq!(
        c.try_open_loan(&user, &(10 * USDC), &7, &500),
        Err(Ok(Error::OfferExpired.into()))
    );
}

#[test]
fn open_with_wrong_terms_fails() {
    let (e, _owner, _vault, c) = setup();
    let user = Address::generate(&e);
    let now = e.ledger().timestamp();
    c.set_user_risk(&user, &600, &true, &0, &(25 * USDC));

    // tenor mismatch
    c.set_loan_offer(&user, &7, &500, &(now + DAY), &(25 * USDC));
    assert_eq!(
        c.try_open_loan(&user, &(10 * USDC), &14, &500),
        Err(Ok(Error::BadTenor.into()))
    );
    // fee mismatch
    assert_eq!(
        c.try_open_loan(&user, &(10 * USDC), &7, &600),
        Err(Ok(Error::BadFee.into()))
    );
    // amount over the offer cap (but within credit) -> OverOffer
    c.set_loan_offer(&user, &7, &500, &(now + DAY), &(5 * USDC));
    assert_eq!(
        c.try_open_loan(&user, &(10 * USDC), &7, &500),
        Err(Ok(Error::OverOffer.into()))
    );
}

#[test]
fn borrow_over_credit_limit_fails() {
    let (e, _owner, _vault, c) = setup();
    let user = Address::generate(&e);
    let now = e.ledger().timestamp();
    c.set_user_risk(&user, &600, &true, &0, &(5 * USDC));
    c.set_loan_offer(&user, &7, &500, &(now + DAY), &(25 * USDC));
    // principal 10 > limit 5 -> error (credit checked before offer).
    assert_eq!(
        c.try_open_loan(&user, &(10 * USDC), &7, &500),
        Err(Ok(Error::OverCreditLimit.into()))
    );
}

#[test]
fn cannot_open_while_loan_active() {
    let (e, _owner, _vault, c) = setup();
    let user = Address::generate(&e);
    let now = e.ledger().timestamp();
    c.set_user_risk(&user, &600, &true, &0, &(25 * USDC));
    c.set_loan_offer(&user, &7, &500, &(now + 100 * DAY), &(25 * USDC));
    c.open_loan(&user, &(10 * USDC), &7, &500);
    // A second offer + open while the first loan is still active -> LoanActive.
    c.set_loan_offer(&user, &7, &500, &(now + 100 * DAY), &(25 * USDC));
    assert_eq!(
        c.try_open_loan(&user, &(5 * USDC), &7, &500),
        Err(Ok(Error::LoanActive.into()))
    );
}

// ─────────────────────────── cooldown / re-borrow ──────────────────────────

#[test]
fn cooldown_blocks_reborrow_until_min_hold() {
    let (e, _owner, _vault, c) = setup();
    let user = Address::generate(&e);
    let now = e.ledger().timestamp();
    c.set_user_risk(&user, &600, &true, &0, &(25 * USDC));
    c.set_loan_offer(&user, &7, &500, &(now + 100 * DAY), &(25 * USDC));

    let start = e.ledger().timestamp();
    c.open_loan(&user, &(10 * USDC), &7, &500);
    let due = c.get_loan(&user).amount_due;
    c.close_loan(&user, &due);

    // 7d tenor -> default min-hold of 4 days from start.
    assert_eq!(c.next_borrow_time(&user), start + 4 * DAY);

    // Immediate re-borrow blocked by cooldown.
    c.set_loan_offer(&user, &7, &500, &(now + 100 * DAY), &(25 * USDC));
    assert_eq!(
        c.try_open_loan(&user, &(10 * USDC), &7, &500),
        Err(Ok(Error::Cooldown.into()))
    );

    // After the hold window, it goes through.
    advance(&e, 4 * DAY);
    c.open_loan(&user, &(10 * USDC), &7, &500);
    assert!(c.get_loan(&user).active);
}

#[test]
fn next_borrow_time_zero_for_fresh_user() {
    let (e, _owner, _vault, c) = setup();
    let user = Address::generate(&e);
    assert_eq!(c.next_borrow_time(&user), 0);
}

// ─────────────────────────── default lifecycle ─────────────────────────────

#[test]
fn default_only_after_grace_plus_late_period() {
    let (e, _owner, _vault, c) = setup();
    let user = Address::generate(&e);
    let now = e.ledger().timestamp();
    c.set_user_risk(&user, &600, &true, &0, &(25 * USDC));
    c.set_loan_offer(&user, &7, &500, &(now + DAY), &(25 * USDC));
    c.open_loan(&user, &(10 * USDC), &7, &500);

    // Too early (within tenor + grace + 15d late window).
    assert_eq!(c.try_mark_default(&user), Err(Ok(Error::TooEarlyToDefault.into())));
    assert!(!c.is_defaulted(&user));

    // Advance past due(7d) + grace(1d) + late(15d) = 23d.
    advance(&e, 24 * DAY);
    c.mark_default(&user);
    assert!(c.is_defaulted(&user));
    assert_eq!(c.credit_limit(&user), 0); // limit zeroed on default

    // Double default is rejected.
    assert_eq!(c.try_mark_default(&user), Err(Ok(Error::AlreadyDefaulted.into())));
    // 30-day post-default cooldown applied.
    assert!(c.next_borrow_time(&user) >= e.ledger().timestamp() + 30 * DAY - 1);
}

#[test]
fn mark_default_with_no_loan_fails() {
    let (e, _owner, _vault, c) = setup();
    let user = Address::generate(&e);
    assert_eq!(c.try_mark_default(&user), Err(Ok(Error::NoActiveLoan.into())));
}

// ─────────────────────────── late fees / previews ──────────────────────────

#[test]
fn late_fees_accrue_after_grace() {
    let (e, _owner, _vault, c) = setup();
    let user = Address::generate(&e);
    let now = e.ledger().timestamp();
    c.set_user_risk(&user, &600, &true, &0, &(25 * USDC));
    c.set_loan_offer(&user, &7, &500, &(now + DAY), &(25 * USDC));
    let late_rate: i128 = 11_574_000_000; // ~1e9 wad/sec (~36.5%/yr)
    c.set_premium_config(&user, &0, &late_rate);
    c.open_loan(&user, &(10 * USDC), &7, &500);

    let base = c.get_loan(&user).amount_due;
    // Within grace (8d): no late fee yet.
    advance(&e, 8 * DAY);
    assert_eq!(c.preview_owed(&user), base);
    // Past grace: owed grows.
    advance(&e, 5 * DAY);
    assert!(c.preview_owed(&user) > base);
}

#[test]
fn accrue_late_materializes_and_is_idempotent() {
    let (e, _owner, _vault, c) = setup();
    let user = Address::generate(&e);
    let now = e.ledger().timestamp();
    c.set_user_risk(&user, &600, &true, &0, &(25 * USDC));
    c.set_loan_offer(&user, &7, &500, &(now + DAY), &(25 * USDC));
    c.set_premium_config(&user, &0, &11_574_000_000);
    c.open_loan(&user, &(10 * USDC), &7, &500);
    let base = c.get_loan(&user).amount_due;

    // Past grace, accrue once -> stored amount_due grows to the previewed value.
    advance(&e, 7 * DAY + 5 * DAY);
    let preview = c.preview_owed(&user);
    assert!(preview > base);
    c.accrue_late(&user);
    let after = c.get_loan(&user).amount_due;
    assert_eq!(after, preview);

    // Second accrue at the same ledger time is a no-op (idempotent).
    c.accrue_late(&user);
    assert_eq!(c.get_loan(&user).amount_due, after);
}

#[test]
fn preview_loan_with_late_returns_principal_and_owed() {
    let (e, _owner, _vault, c) = setup();
    let user = Address::generate(&e);
    let now = e.ledger().timestamp();
    c.set_user_risk(&user, &600, &true, &0, &(25 * USDC));
    c.set_loan_offer(&user, &7, &500, &(now + DAY), &(25 * USDC));
    c.set_premium_config(&user, &0, &11_574_000_000);
    c.open_loan(&user, &(10 * USDC), &7, &500);

    let (p0, owed0) = c.preview_loan_with_late(&user);
    assert_eq!(p0, 10 * USDC);
    assert_eq!(owed0, c.get_loan(&user).amount_due); // no late yet

    advance(&e, 7 * DAY + 10 * DAY);
    let (p1, owed1) = c.preview_loan_with_late(&user);
    assert_eq!(p1, 10 * USDC); // principal never changes
    assert!(owed1 > owed0); // late fees stacked on top
}

#[test]
fn get_premium_mirrors_premiums_getter() {
    let (e, _owner, _vault, c) = setup();
    let user = Address::generate(&e);
    // Default zeroed.
    let p0 = c.get_premium(&user);
    assert_eq!(p0.late_rate_per_sec_wad, 0);
    // After set, the stored rates come back.
    c.set_premium_config(&user, &123, &456);
    let p = c.get_premium(&user);
    assert_eq!(p.premium_rate_per_sec_wad, 123);
    assert_eq!(p.late_rate_per_sec_wad, 456);
}

// ─────────────────────────── close_loan guards ─────────────────────────────

#[test]
fn close_loan_underpaid_fails() {
    let (e, _owner, _vault, c) = setup();
    let user = Address::generate(&e);
    let now = e.ledger().timestamp();
    c.set_user_risk(&user, &600, &true, &0, &(25 * USDC));
    c.set_loan_offer(&user, &7, &500, &(now + DAY), &(25 * USDC));
    c.open_loan(&user, &(10 * USDC), &7, &500);
    let due = c.get_loan(&user).amount_due;
    assert_eq!(c.try_close_loan(&user, &(due - 1)), Err(Ok(Error::Underpaid.into())));
}

#[test]
fn close_loan_with_no_active_loan_fails() {
    let (e, _owner, _vault, c) = setup();
    let user = Address::generate(&e);
    assert_eq!(c.try_close_loan(&user, &0), Err(Ok(Error::NoActiveLoan.into())));
}

// ─────────────────────────── authorization gates ───────────────────────────

#[test]
fn set_user_risk_requires_owner_auth() {
    let (e, _owner, _vault, c) = setup_no_mock();
    let user = Address::generate(&e);
    assert!(c
        .try_set_user_risk(&user, &500, &true, &0, &(25 * USDC))
        .is_err());
}

#[test]
fn open_loan_requires_vault_auth() {
    let (e, _owner, _vault, c) = setup_no_mock();
    let user = Address::generate(&e);
    // The vault-only auth gate fires before any state is read.
    assert!(c.try_open_loan(&user, &(10 * USDC), &7, &500).is_err());
}

#[test]
fn mark_default_requires_owner_auth() {
    let (e, _owner, _vault, c) = setup_no_mock();
    let user = Address::generate(&e);
    assert!(c.try_mark_default(&user).is_err());
}

#[test]
fn close_loan_requires_vault_auth() {
    let (e, _owner, _vault, c) = setup_no_mock();
    let user = Address::generate(&e);
    assert!(c.try_close_loan(&user, &0).is_err());
}

#[test]
fn set_loan_offer_requires_owner_auth() {
    let (e, _owner, _vault, c) = setup_no_mock();
    let user = Address::generate(&e);
    let now = e.ledger().timestamp();
    assert!(c
        .try_set_loan_offer(&user, &7, &500, &(now + DAY), &(25 * USDC))
        .is_err());
}

#[test]
fn set_premium_config_requires_owner_auth() {
    let (e, _owner, _vault, c) = setup_no_mock();
    let user = Address::generate(&e);
    assert!(c.try_set_premium_config(&user, &0, &1).is_err());
}

// ─────────────────────────── input validation ──────────────────────────────

#[test]
fn set_loan_offer_rejects_bad_params() {
    let (e, _owner, _vault, c) = setup();
    let user = Address::generate(&e);
    let now = e.ledger().timestamp();
    // tenor 0
    assert_eq!(
        c.try_set_loan_offer(&user, &0, &500, &(now + DAY), &(25 * USDC)),
        Err(Ok(Error::InvalidParam.into()))
    );
    // fee 0
    assert_eq!(
        c.try_set_loan_offer(&user, &7, &0, &(now + DAY), &(25 * USDC)),
        Err(Ok(Error::InvalidParam.into()))
    );
    // max_amount 0
    assert_eq!(
        c.try_set_loan_offer(&user, &7, &500, &(now + DAY), &0),
        Err(Ok(Error::InvalidParam.into()))
    );
    // already-expired validity
    assert_eq!(
        c.try_set_loan_offer(&user, &7, &500, &now, &(25 * USDC)),
        Err(Ok(Error::OfferExpired.into()))
    );
}

#[test]
fn set_premium_config_rejects_negative() {
    let (e, _owner, _vault, c) = setup();
    let user = Address::generate(&e);
    assert_eq!(
        c.try_set_premium_config(&user, &(-1), &0),
        Err(Ok(Error::InvalidParam.into()))
    );
    assert_eq!(
        c.try_set_premium_config(&user, &0, &(-1)),
        Err(Ok(Error::InvalidParam.into()))
    );
}

#[test]
fn open_loan_rejects_zero_principal() {
    let (e, _owner, _vault, c) = setup();
    let user = Address::generate(&e);
    // ZeroPrincipal is checked right after the vault-auth gate, before any state.
    assert_eq!(
        c.try_open_loan(&user, &0, &7, &500),
        Err(Ok(Error::ZeroPrincipal.into()))
    );
}

// ─────────────────────────── amount_due math ───────────────────────────────

#[test]
fn amount_due_is_floor_rounded() {
    let (e, _owner, _vault, c) = setup();
    let user = Address::generate(&e);
    let now = e.ledger().timestamp();
    c.set_user_risk(&user, &600, &true, &0, &(25 * USDC));
    c.set_loan_offer(&user, &7, &500, &(now + DAY), &(25 * USDC));
    // 199 * 10500 / 10000 = 208.95 -> floor 208 (never over-charges the borrower).
    c.open_loan(&user, &199, &7, &500);
    let l = c.get_loan(&user);
    assert_eq!(l.amount_due, 208);
    assert!(l.amount_due >= l.principal);
}

// ─────────────────────────── grace / cooldown config ───────────────────────

#[test]
fn grace_period_is_snapshotted_at_open() {
    let (e, _owner, _vault, c) = setup();
    let user = Address::generate(&e);
    let now = e.ledger().timestamp();
    c.set_user_risk(&user, &600, &true, &0, &(25 * USDC));
    c.set_loan_offer(&user, &7, &500, &(now + 100 * DAY), &(25 * USDC));
    c.open_loan(&user, &(10 * USDC), &7, &500);
    // Default grace is 1 day; the active loan snapshots it.
    assert_eq!(c.get_loan(&user).grace_period, DAY);
    // Changing the default does NOT retroactively touch the active loan.
    c.set_default_grace_period(&(3 * DAY));
    assert_eq!(c.get_loan(&user).grace_period, DAY);
}

#[test]
fn custom_min_hold_extends_cooldown() {
    let (e, _owner, _vault, c) = setup();
    let user = Address::generate(&e);
    let now = e.ledger().timestamp();
    c.set_min_hold_for_tenor(&7, &10); // 10-day hold for the 7d tenor
    c.set_user_risk(&user, &600, &true, &0, &(25 * USDC));
    c.set_loan_offer(&user, &7, &500, &(now + 100 * DAY), &(25 * USDC));
    let start = e.ledger().timestamp();
    c.open_loan(&user, &(10 * USDC), &7, &500);
    let due = c.get_loan(&user).amount_due;
    c.close_loan(&user, &due);
    assert_eq!(c.next_borrow_time(&user), start + 10 * DAY);
}

#[test]
fn repay_after_min_hold_adds_no_extra_cooldown() {
    let (e, _owner, _vault, c) = setup();
    let user = Address::generate(&e);
    let now = e.ledger().timestamp();
    c.set_user_risk(&user, &600, &true, &0, &(25 * USDC));
    c.set_loan_offer(&user, &7, &500, &(now + 100 * DAY), &(25 * USDC));
    c.open_loan(&user, &(10 * USDC), &7, &500);
    let due = c.get_loan(&user).amount_due;
    // Repay well after the 4d min-hold: next_borrow collapses to "now", no penalty.
    advance(&e, 20 * DAY);
    let now2 = e.ledger().timestamp();
    c.close_loan(&user, &due);
    assert_eq!(c.next_borrow_time(&user), now2);
}

// ─────────────────────────── late-fee mechanics ────────────────────────────

#[test]
fn accrue_late_on_inactive_loan_is_noop() {
    let (e, _owner, _vault, c) = setup();
    let user = Address::generate(&e);
    // No loan at all -> must not panic, stays inactive.
    c.accrue_late(&user);
    assert!(!c.get_loan(&user).active);
}

#[test]
fn late_fees_compound_across_accruals() {
    let (e, _owner, _vault, c) = setup();
    let user = Address::generate(&e);
    let now = e.ledger().timestamp();
    c.set_user_risk(&user, &600, &true, &0, &(25 * USDC));
    c.set_loan_offer(&user, &7, &500, &(now + DAY), &(25 * USDC));
    c.set_premium_config(&user, &0, &11_574_000_000);
    c.open_loan(&user, &(10 * USDC), &7, &500);
    let base = c.get_loan(&user).amount_due;

    // First accrual window (5d past late-start).
    advance(&e, 8 * DAY + 5 * DAY);
    c.accrue_late(&user);
    let due1 = c.get_loan(&user).amount_due;
    let delta1 = due1 - base;
    assert!(delta1 > 0);

    // Second identical window — but the base is now larger, so the delta is larger.
    advance(&e, 5 * DAY);
    c.accrue_late(&user);
    let due2 = c.get_loan(&user).amount_due;
    let delta2 = due2 - due1;
    assert!(delta2 > delta1); // compounding on the materialized amount_due
}

// ═══════════════ workflow gap-hunt additions ═══════════════
// ─────────────────────────── admin: set_owner / set_vault ──────────────────

#[test]
fn set_owner_rotates_admin_control() {
    // Owner rotation must persist the NEW owner. Under mocked auths the call
    // succeeds; we then assert an owner-gated write succeeds (the new owner's
    // auth is mocked too) and that the stored owner actually changed by driving
    // a follow-up admin write that reads read_owner internally.
    let (e, _owner, _vault, c) = setup();
    let new_owner = Address::generate(&e);
    c.set_owner(&new_owner);
    // After rotation, owner-gated writes still work (require_auth resolves to the
    // new owner, which is mock-authorized). A regression that wrote the wrong key
    // would surface as NotInitialized / wrong-owner panics on these calls.
    let user = Address::generate(&e);
    c.set_user_risk(&user, &600, &true, &0, &(25 * USDC));
    assert_eq!(c.get_user_risk(&user).limit, 25 * USDC);
}

#[test]
fn set_owner_requires_owner_auth() {
    // The OLD owner must sign to rotate ownership; with no mocked auth it bites.
    let (e, _owner, _vault, c) = setup_no_mock();
    let attacker = Address::generate(&e);
    assert!(c.try_set_owner(&attacker).is_err());
}

#[test]
fn set_vault_rewires_loan_lifecycle_caller() {
    // set_vault changes which Address satisfies the vault-only gate on open_loan.
    // Under mock_all_auths every Address is authorized, so we can only assert the
    // happy path here: after rewiring to a fresh vault, open_loan still reaches
    // its business-logic checks (NoOffer) rather than panicking on config reads.
    let (e, _owner, _vault, c) = setup();
    let new_vault = Address::generate(&e);
    c.set_vault(&new_vault);
    let user = Address::generate(&e);
    c.set_user_risk(&user, &600, &true, &0, &(25 * USDC));
    // No offer set -> we reach the offer check (proves config/vault rewrite is
    // intact and open_loan still functions through the new vault).
    assert_eq!(
        c.try_open_loan(&user, &(10 * USDC), &7, &500),
        Err(Ok(Error::NoOffer.into()))
    );
    // The config rewrite must not have clobbered the snapshotted grace default.
    c.set_loan_offer(&user, &7, &500, &(e.ledger().timestamp() + DAY), &(25 * USDC));
    c.open_loan(&user, &(10 * USDC), &7, &500);
    assert_eq!(c.get_loan(&user).grace_period, DAY);
}

#[test]
fn set_vault_requires_owner_auth() {
    let (e, _owner, _vault, c) = setup_no_mock();
    let evil = Address::generate(&e);
    assert!(c.try_set_vault(&evil).is_err());
}

// ─────────────────────────── admin auth gates (remaining) ──────────────────

#[test]
fn set_default_grace_period_requires_owner_auth() {
    let (_e, _owner, _vault, c) = setup_no_mock();
    assert!(c.try_set_default_grace_period(&(3 * DAY)).is_err());
}

#[test]
fn set_min_hold_for_tenor_requires_owner_auth() {
    let (_e, _owner, _vault, c) = setup_no_mock();
    assert!(c.try_set_min_hold_for_tenor(&7, &10).is_err());
}

#[test]
fn upgrade_requires_owner_auth() {
    // upgrade replaces the contract Wasm; the require_auth gate must fire before
    // update_current_contract_wasm. With no mocked auth this returns Err.
    let (e, _owner, _vault, c) = setup_no_mock();
    let hash = soroban_sdk::BytesN::from_array(&e, &[0u8; 32]);
    assert!(c.try_upgrade(&hash).is_err());
}

// ─────────────────────────── boundary: credit_limit expiry ─────────────────

#[test]
fn credit_limit_expiry_boundary_is_exclusive() {
    // credit_limit uses `timestamp() > valid_until` (strict), so AT valid_until
    // the limit is still live; one second later it is 0. Pins the off-by-one.
    let (e, _owner, _vault, c) = setup();
    let user = Address::generate(&e);
    let now = e.ledger().timestamp();
    c.set_user_risk(&user, &600, &true, &(now + 10), &(25 * USDC));
    advance(&e, 10); // timestamp == valid_until
    assert_eq!(c.credit_limit(&user), 25 * USDC);
    advance(&e, 1); // timestamp == valid_until + 1
    assert_eq!(c.credit_limit(&user), 0);
}

// ─────────────────────────── boundary: offer / cooldown ────────────────────

#[test]
fn open_loan_at_exact_offer_valid_until_succeeds() {
    // open_loan rejects with `now > o.valid_until` (strict), so opening AT
    // valid_until must succeed. set_loan_offer's own `valid_until <= now` reject
    // is creation-time; here we create earlier then advance to the boundary.
    let (e, _owner, _vault, c) = setup();
    let user = Address::generate(&e);
    let now = e.ledger().timestamp();
    c.set_user_risk(&user, &600, &true, &0, &(25 * USDC));
    c.set_loan_offer(&user, &7, &500, &(now + 10), &(25 * USDC));
    advance(&e, 10); // now == valid_until
    c.open_loan(&user, &(10 * USDC), &7, &500);
    assert!(c.get_loan(&user).active);
}

#[test]
fn open_loan_one_second_past_offer_expires() {
    let (e, _owner, _vault, c) = setup();
    let user = Address::generate(&e);
    let now = e.ledger().timestamp();
    c.set_user_risk(&user, &600, &true, &0, &(25 * USDC));
    c.set_loan_offer(&user, &7, &500, &(now + 10), &(25 * USDC));
    advance(&e, 11); // now == valid_until + 1
    assert_eq!(
        c.try_open_loan(&user, &(10 * USDC), &7, &500),
        Err(Ok(Error::OfferExpired.into()))
    );
}

#[test]
fn cooldown_boundary_is_inclusive_at_next_borrow_time() {
    // open_loan rejects with `now < allowed_since` (strict), so at exactly
    // next_borrow_time the re-borrow must succeed and one second earlier must
    // fail with Cooldown. The existing test only jumps the full window.
    let (e, _owner, _vault, c) = setup();
    let user = Address::generate(&e);
    let now = e.ledger().timestamp();
    c.set_user_risk(&user, &600, &true, &0, &(25 * USDC));
    c.set_loan_offer(&user, &7, &500, &(now + 100 * DAY), &(25 * USDC));
    let start = e.ledger().timestamp();
    c.open_loan(&user, &(10 * USDC), &7, &500);
    let due = c.get_loan(&user).amount_due;
    c.close_loan(&user, &due);
    // 7d tenor -> 4d min-hold from start.
    assert_eq!(c.next_borrow_time(&user), start + 4 * DAY);

    // One second before the boundary: still Cooldown.
    advance(&e, 4 * DAY - 1);
    c.set_loan_offer(&user, &7, &500, &(now + 100 * DAY), &(25 * USDC));
    assert_eq!(
        c.try_open_loan(&user, &(10 * USDC), &7, &500),
        Err(Ok(Error::Cooldown.into()))
    );
    // Exactly at the boundary: succeeds.
    advance(&e, 1); // now == start + 4*DAY == allowed_since
    c.open_loan(&user, &(10 * USDC), &7, &500);
    assert!(c.get_loan(&user).active);
}

// ─────────────────────────── boundary: mark_default ────────────────────────

#[test]
fn mark_default_boundary_is_exclusive_at_limit_ts() {
    // mark_default rejects with `timestamp() <= limit_ts`, so default is allowed
    // only strictly AFTER due + grace + late_period. Pins the exact second
    // (existing test jumps a full extra day past the threshold).
    let (e, _owner, _vault, c) = setup();
    let user = Address::generate(&e);
    let now = e.ledger().timestamp();
    c.set_user_risk(&user, &600, &true, &0, &(25 * USDC));
    c.set_loan_offer(&user, &7, &500, &(now + DAY), &(25 * USDC));
    c.open_loan(&user, &(10 * USDC), &7, &500);
    // limit_ts = due(7d) + grace(1d) + late(15d) = start + 23d.
    advance(&e, 23 * DAY); // now == limit_ts
    assert_eq!(c.try_mark_default(&user), Err(Ok(Error::TooEarlyToDefault.into())));
    advance(&e, 1); // now == limit_ts + 1
    c.mark_default(&user);
    assert!(c.is_defaulted(&user));
    // 30-day post-default cooldown applied exactly off the default timestamp.
    assert_eq!(c.next_borrow_time(&user), e.ledger().timestamp() + 30 * DAY);
}

#[test]
fn mark_default_zeroes_raw_risk_limit_field() {
    // The Some(risk) branch zeroes the raw stored limit (not just the effective
    // credit_limit which could read 0 via expiry). Asserts the raw field AND the
    // cooldown together, which the existing default test omits.
    let (e, _owner, _vault, c) = setup();
    let user = Address::generate(&e);
    let now = e.ledger().timestamp();
    c.set_user_risk(&user, &600, &true, &0, &(25 * USDC));
    c.set_loan_offer(&user, &7, &500, &(now + DAY), &(25 * USDC));
    c.open_loan(&user, &(10 * USDC), &7, &500);
    advance(&e, 24 * DAY);
    c.mark_default(&user);
    // Raw stored limit zeroed (the Some-branch write), not just effective limit.
    assert_eq!(c.get_user_risk(&user).limit, 0);
    assert_eq!(c.next_borrow_time(&user), e.ledger().timestamp() + 30 * DAY);
}

// ─────────────────────────── owed_with_late branches ───────────────────────

#[test]
fn no_late_accrual_without_premium_config() {
    // owed_with_late early-returns when late_rate_per_sec_wad == 0. A loan far
    // past due with NO premium configured must owe exactly amount_due forever,
    // and accrue_late must be a no-op. Every existing late test sets a rate.
    let (e, _owner, _vault, c) = setup();
    let user = Address::generate(&e);
    let now = e.ledger().timestamp();
    c.set_user_risk(&user, &600, &true, &0, &(25 * USDC));
    c.set_loan_offer(&user, &7, &500, &(now + DAY), &(25 * USDC));
    c.open_loan(&user, &(10 * USDC), &7, &500);
    let base = c.get_loan(&user).amount_due;
    advance(&e, 100 * DAY); // way past due+grace, but no late rate
    assert_eq!(c.preview_owed(&user), base);
    c.accrue_late(&user);
    assert_eq!(c.get_loan(&user).amount_due, base);
}

#[test]
fn fresh_loan_last_accrued_equals_start() {
    // open_loan sets last_accrued = now = start, so the `from = last_accrued`
    // branch (rather than the dead `from = l.start` path) is what owed_with_late
    // uses. Pin the invariant the branch relies on.
    let (e, _owner, _vault, c) = setup();
    let user = Address::generate(&e);
    let now = e.ledger().timestamp();
    c.set_user_risk(&user, &600, &true, &0, &(25 * USDC));
    c.set_loan_offer(&user, &7, &500, &(now + DAY), &(25 * USDC));
    c.open_loan(&user, &(10 * USDC), &7, &500);
    let l = c.get_loan(&user);
    assert_eq!(l.last_accrued, l.start);
}

#[test]
fn accrual_restarts_from_last_accrued_not_due() {
    // After accrue_late materializes fees, last_accrued = now. A subsequent
    // preview at a small increment must grow OFF the materialized amount_due
    // (accrual_from = last_accrued), not re-count from due+grace. A bug using
    // l.due/l.start would double-count the already-materialized window.
    let (e, _owner, _vault, c) = setup();
    let user = Address::generate(&e);
    let now = e.ledger().timestamp();
    c.set_user_risk(&user, &600, &true, &0, &(25 * USDC));
    c.set_loan_offer(&user, &7, &500, &(now + DAY), &(25 * USDC));
    c.set_premium_config(&user, &0, &11_574_000_000);
    c.open_loan(&user, &(10 * USDC), &7, &500);
    advance(&e, 8 * DAY + 30 * DAY); // well past late-start
    c.accrue_late(&user);
    let d1 = c.get_loan(&user).amount_due;
    // Immediately after accrual, preview == materialized value (now==last_accrued).
    assert_eq!(c.preview_owed(&user), d1);
    // A further long window grows it again, but by a bounded delta consistent
    // with accruing from last_accrued (the SECOND window), not from due again.
    advance(&e, 30 * DAY);
    let p2 = c.preview_owed(&user);
    assert!(p2 > d1);
    // Sanity: the second 30d delta off the larger base must not be absurdly
    // larger than the first 30d-ish delta (would signal re-counting from due).
    let first_delta = d1 - (10 * USDC * 10_500 / 10_000);
    let second_delta = p2 - d1;
    // second_delta accrues over 30d off d1; first_delta accrued over ~30d off
    // the smaller base, so second_delta should be only modestly larger, never
    // multiples of first_delta as a from=due regression would produce.
    assert!(second_delta < first_delta * 3);
}

// ─────────────────────────── previews on inactive loans ────────────────────

#[test]
fn previews_zero_for_never_opened_user() {
    // owed_with_late returns amount_due (0) when !active. The repay UX calls
    // these on unscored/unopened users and must get clean zeros, not a panic.
    let (e, _owner, _vault, c) = setup();
    let user = Address::generate(&e);
    assert_eq!(c.preview_owed(&user), 0);
    assert_eq!(c.preview_loan_with_late(&user), (0, 0));
}

#[test]
fn previews_zero_after_loan_closed() {
    let (e, _owner, _vault, c) = setup();
    let user = Address::generate(&e);
    let now = e.ledger().timestamp();
    c.set_user_risk(&user, &600, &true, &0, &(25 * USDC));
    c.set_loan_offer(&user, &7, &500, &(now + DAY), &(25 * USDC));
    c.open_loan(&user, &(10 * USDC), &7, &500);
    let due = c.get_loan(&user).amount_due;
    c.close_loan(&user, &due);
    assert_eq!(c.preview_owed(&user), 0);
    assert_eq!(c.preview_loan_with_late(&user), (0, 0));
}

// ─────────────────────────── getters: defaults for fresh user ──────────────

#[test]
fn fresh_user_loan_and_default_defaults() {
    // read_loan returns a fully-zeroed Loan for an unknown user; is_defaulted
    // is false. Guards a storage-key regression returning stale/wrong defaults.
    let (e, _owner, _vault, c) = setup();
    let user = Address::generate(&e);
    assert!(!c.is_defaulted(&user));
    let l = c.get_loan(&user);
    assert!(!l.active);
    assert!(!l.defaulted);
    assert_eq!(l.principal, 0);
    assert_eq!(l.amount_due, 0);
    assert_eq!(l.start, 0);
    assert_eq!(l.due, 0);
}

// ─────────────────────────── open_loan guard precedence ────────────────────

#[test]
fn cooldown_precedes_offer_check() {
    // Guard order is ZeroPrincipal -> Cooldown -> LoanActive -> credit -> offer.
    // A user in cooldown AND with NO offer must surface Cooldown first. Pins the
    // precedence so a future reorder is caught.
    let (e, _owner, _vault, c) = setup();
    let user = Address::generate(&e);
    let now = e.ledger().timestamp();
    c.set_user_risk(&user, &600, &true, &0, &(25 * USDC));
    c.set_loan_offer(&user, &7, &500, &(now + 100 * DAY), &(25 * USDC));
    c.open_loan(&user, &(10 * USDC), &7, &500);
    let due = c.get_loan(&user).amount_due;
    c.close_loan(&user, &due); // sets a cooldown (next_borrow = start + 4d)
    // No new offer set, and still inside the cooldown window.
    assert_eq!(
        c.try_open_loan(&user, &(10 * USDC), &7, &500),
        Err(Ok(Error::Cooldown.into()))
    );
}

// ─────────────────────────── accrue_late then close interaction ────────────

#[test]
fn accrue_late_then_close_requires_materialized_owed() {
    // After accrue_late raises amount_due, close_loan must require the HIGHER
    // figure: paying one unit less than the materialized owed is Underpaid, and
    // paying the materialized owed closes. Pins the accrue->close path.
    let (e, _owner, _vault, c) = setup();
    let user = Address::generate(&e);
    let now = e.ledger().timestamp();
    c.set_user_risk(&user, &600, &true, &0, &(25 * USDC));
    c.set_loan_offer(&user, &7, &500, &(now + DAY), &(25 * USDC));
    c.set_premium_config(&user, &0, &11_574_000_000);
    c.open_loan(&user, &(10 * USDC), &7, &500);
    let base = c.get_loan(&user).amount_due;
    advance(&e, 8 * DAY + 20 * DAY);
    c.accrue_late(&user);
    let owed = c.get_loan(&user).amount_due;
    assert!(owed > base);
    assert_eq!(c.try_close_loan(&user, &(owed - 1)), Err(Ok(Error::Underpaid.into())));
    c.close_loan(&user, &owed);
    assert!(!c.get_loan(&user).active);
}

// ─────────────────────────── close_loan overpayment ────────────────────────

#[test]
fn close_loan_accepts_overpayment() {
    // close_loan guards `paid < amount_due`; paying MORE (vault forwarding late
    // fees or rounding) must still close cleanly and zero the loan.
    let (e, _owner, _vault, c) = setup();
    let user = Address::generate(&e);
    let now = e.ledger().timestamp();
    c.set_user_risk(&user, &600, &true, &0, &(25 * USDC));
    c.set_loan_offer(&user, &7, &500, &(now + DAY), &(25 * USDC));
    c.open_loan(&user, &(10 * USDC), &7, &500);
    let due = c.get_loan(&user).amount_due;
    c.close_loan(&user, &(due + 5 * USDC));
    let cl = c.get_loan(&user);
    assert!(!cl.active);
    assert_eq!(cl.principal, 0);
}

// ─────────────────────────── set_user_risk overwrite / zero ────────────────

#[test]
fn set_user_risk_zero_limit_is_valid_downgrade() {
    // limit == 0 is a valid re-score to no-credit (distinct from "unset"). Must
    // yield credit_limit 0 and a raw stored limit of 0, and re-scoring must
    // refresh last_update to the current ledger time.
    let (e, _owner, _vault, c) = setup();
    let user = Address::generate(&e);
    c.set_user_risk(&user, &600, &true, &0, &(25 * USDC));
    let lu0 = c.get_user_risk(&user).last_update;
    advance(&e, 100);
    c.set_user_risk(&user, &600, &true, &0, &0); // re-score to zero credit
    assert_eq!(c.credit_limit(&user), 0);
    assert_eq!(c.get_user_risk(&user).limit, 0);
    // Re-scoring refreshes freshness (the off-chain model relies on last_update).
    assert!(c.get_user_risk(&user).last_update > lu0);
    assert_eq!(c.get_user_risk(&user).last_update, e.ledger().timestamp());
}

// ─────────────────────────── off-list tenor min-hold fallback ──────────────

#[test]
fn off_list_tenor_has_zero_min_hold_then_configurable() {
    // min_hold_secs falls back to 0 for tenors not in the constructor set
    // {3,7,14,21,30}. A tenor=5 loan repaid immediately gets next_borrow == now
    // (zero hold). After set_min_hold_for_tenor(5,3) a fresh cycle adds 3d.
    let (e, _owner, _vault, c) = setup();
    let user = Address::generate(&e);
    let now = e.ledger().timestamp();
    c.set_user_risk(&user, &600, &true, &0, &(25 * USDC));
    c.set_loan_offer(&user, &5, &500, &(now + 100 * DAY), &(25 * USDC));
    let start = e.ledger().timestamp();
    c.open_loan(&user, &(10 * USDC), &5, &500);
    let due = c.get_loan(&user).amount_due;
    c.close_loan(&user, &due);
    // unwrap_or(0) -> wait_until = max(now, start+0) = start.
    assert_eq!(c.next_borrow_time(&user), start);

    // Now register a 3-day hold for tenor 5 and run a fresh cycle.
    c.set_min_hold_for_tenor(&5, &3);
    let now2 = e.ledger().timestamp();
    c.set_loan_offer(&user, &5, &500, &(now2 + 100 * DAY), &(25 * USDC));
    let start2 = e.ledger().timestamp();
    c.open_loan(&user, &(10 * USDC), &5, &500);
    let due2 = c.get_loan(&user).amount_due;
    c.close_loan(&user, &due2);
    assert_eq!(c.next_borrow_time(&user), start2 + 3 * DAY);
}

// ─────────────────────────── amount_due small-principal floor band ──────────

#[test]
fn amount_due_floor_band_for_tiny_principals() {
    // For principal <= 19 at 5%, principal*10500/10000 floors back to principal
    // (zero interest); principal=20 is the first unit of interest (21). Pins the
    // exact floor band and the never-undercharge invariant.
    let (e, _owner, _vault, c) = setup();
    let now = e.ledger().timestamp();

    let u19 = Address::generate(&e);
    c.set_user_risk(&u19, &600, &true, &0, &(25 * USDC));
    c.set_loan_offer(&u19, &7, &500, &(now + DAY), &(25 * USDC));
    c.open_loan(&u19, &19, &7, &500);
    let l19 = c.get_loan(&u19);
    assert_eq!(l19.amount_due, 19); // interest floors to 0
    assert!(l19.amount_due >= l19.principal);

    let u20 = Address::generate(&e);
    c.set_user_risk(&u20, &600, &true, &0, &(25 * USDC));
    c.set_loan_offer(&u20, &7, &500, &(now + DAY), &(25 * USDC));
    c.open_loan(&u20, &20, &7, &500);
    assert_eq!(c.get_loan(&u20).amount_due, 21); // first unit of interest

    let u1 = Address::generate(&e);
    c.set_user_risk(&u1, &600, &true, &0, &(25 * USDC));
    c.set_loan_offer(&u1, &7, &500, &(now + DAY), &(25 * USDC));
    c.open_loan(&u1, &1, &7, &500);
    assert_eq!(c.get_loan(&u1).amount_due, 1);
}

// ─────────────────────────── late-fee onset boundary ───────────────────────

#[test]
fn no_late_fee_at_exact_late_start() {
    // owed_with_late uses `now <= accrual_from` -> amount_due, so AT late_start
    // (due + grace) exactly, zero late fee accrues. Existing tests only probe
    // inside grace and far past it.
    let (e, _owner, _vault, c) = setup();
    let user = Address::generate(&e);
    let now = e.ledger().timestamp();
    c.set_user_risk(&user, &600, &true, &0, &(25 * USDC));
    c.set_loan_offer(&user, &7, &500, &(now + DAY), &(25 * USDC));
    c.set_premium_config(&user, &0, &11_574_000_000);
    c.open_loan(&user, &(10 * USDC), &7, &500);
    let base = c.get_loan(&user).amount_due;
    // late_start = due(7d) + grace(1d) = start + 8d. Advance exactly there.
    advance(&e, 8 * DAY);
    assert_eq!(c.preview_owed(&user), base); // boundary: still no fee
}

// ─────────────────────────── late fee on dust loan floors to 0 ─────────────

#[test]
fn late_fee_floors_to_zero_on_dust_loan() {
    // For a tiny amount_due, extra = rate*t*amount_due/WAD stays 0 for any
    // realistic window (rate*amount_due*t << 1e18). The protocol earns no mora
    // on dust and accrue_late is a permanent no-op on the amount.
    let (e, _owner, _vault, c) = setup();
    let user = Address::generate(&e);
    let now = e.ledger().timestamp();
    c.set_user_risk(&user, &600, &true, &0, &(25 * USDC));
    c.set_loan_offer(&user, &7, &500, &(now + DAY), &(25 * USDC));
    c.set_premium_config(&user, &0, &11_574_000_000);
    c.open_loan(&user, &1, &7, &500); // amount_due == 1
    advance(&e, 100 * DAY); // far past late-start
    assert_eq!(c.preview_owed(&user), 1); // extra floors to 0
    c.accrue_late(&user);
    assert_eq!(c.get_loan(&user).amount_due, 1);
}

// ─────────────────────────── close_loan min-hold boundary ──────────────────

#[test]
fn close_loan_next_borrow_boundary_at_exact_min_hold() {
    // close_loan: wait_until = if now >= start+min_hold { now } else { min }.
    // At now == start+min_hold exactly (the >= boundary) wait_until == now, no
    // extra penalty; one second earlier it stays the future min_from_start.
    let (e, _owner, _vault, c) = setup();
    let user = Address::generate(&e);
    let now = e.ledger().timestamp();
    c.set_user_risk(&user, &600, &true, &0, &(25 * USDC));
    c.set_loan_offer(&user, &7, &500, &(now + 100 * DAY), &(25 * USDC));
    let start = e.ledger().timestamp();
    c.open_loan(&user, &(10 * USDC), &7, &500);
    let due = c.get_loan(&user).amount_due;
    advance(&e, 4 * DAY); // now == start + 4d (min-hold for 7d tenor)
    c.close_loan(&user, &due);
    assert_eq!(c.next_borrow_time(&user), start + 4 * DAY); // == now
}

#[test]
fn close_loan_before_min_hold_sets_future_next_borrow() {
    // Contrast: closing one second before the min-hold keeps next_borrow at the
    // future min_from_start (start + 4d), not the earlier `now`.
    let (e, _owner, _vault, c) = setup();
    let user = Address::generate(&e);
    let now = e.ledger().timestamp();
    c.set_user_risk(&user, &600, &true, &0, &(25 * USDC));
    c.set_loan_offer(&user, &7, &500, &(now + 100 * DAY), &(25 * USDC));
    let start = e.ledger().timestamp();
    c.open_loan(&user, &(10 * USDC), &7, &500);
    let due = c.get_loan(&user).amount_due;
    advance(&e, 4 * DAY - 1); // one second before min-hold
    c.close_loan(&user, &due);
    assert_eq!(c.next_borrow_time(&user), start + 4 * DAY);
}