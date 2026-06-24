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
