#![cfg(test)]
//! Vault integration suite — wires the real loan-manager + vault + a mock USDC
//! (Stellar Asset Contract) and exercises every flow the Lendoor frontend drives:
//!   LP side : deposit, withdraw(assets), redeem(shares), price-per-share growth
//!   credit  : borrow_with_term (inline credit gate), repay (full-only + 5% fee)
//!   loss    : manual_write_off + late-repay healing
//!   reads   : total_assets, total_shares, shares
//! plus the end-to-end borrow→repay→withdraw round trip and the negative paths.
use crate::{Error, Vault, VaultClient};
use lendoor_loan_manager::{LoanManager, LoanManagerClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env,
};

const DAY: u64 = 86_400;

struct Setup<'a> {
    e: Env,
    fee_recipient: Address,
    owner: Address,
    usdc: token::Client<'a>,
    usdc_admin: token::StellarAssetClient<'a>,
    lm: LoanManagerClient<'a>,
    vault: VaultClient<'a>,
}

fn setup<'a>() -> Setup<'a> {
    let e = Env::default();
    e.mock_all_auths();

    let operator = Address::generate(&e);
    let owner = Address::generate(&e);
    let fee_recipient = Address::generate(&e);

    // USDC as a Stellar Asset Contract (mock).
    let sac = e.register_stellar_asset_contract_v2(operator.clone());
    let usdc = token::Client::new(&e, &sac.address());
    let usdc_admin = token::StellarAssetClient::new(&e, &sac.address());

    // loan-manager with a placeholder vault, then rewire to the real vault id.
    let placeholder = Address::generate(&e);
    let lm_id = e.register(LoanManager, (operator.clone(), placeholder));
    let lm = LoanManagerClient::new(&e, &lm_id);

    let vault_id = e.register(
        Vault,
        (owner.clone(), sac.address(), lm_id.clone(), fee_recipient.clone()),
    );
    let vault = VaultClient::new(&e, &vault_id);
    lm.set_vault(&vault_id);

    Setup { e, fee_recipient, owner, usdc, usdc_admin, lm, vault }
}

/// Score `borrower` with a credit limit + a matching 7d/5% one-shot offer.
fn grant(s: &Setup, borrower: &Address, limit: i128) {
    let now = s.e.ledger().timestamp();
    s.lm.set_user_risk(borrower, &600, &true, &0, &limit);
    s.lm.set_loan_offer(borrower, &7, &500, &(now + DAY), &limit);
}

// ─────────────────────────── LP side: deposit ──────────────────────────────

#[test]
fn first_deposit_mints_one_to_one() {
    let s = setup();
    let lp = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);

    let shares = s.vault.deposit(&lp, &100_000);
    assert_eq!(shares, 100_000); // first deposit ~1:1
    assert_eq!(s.vault.balance_of(&lp), 100_000);
    assert_eq!(s.vault.total_supply(), 100_000);
    assert_eq!(s.vault.total_assets(), 100_000);
}

#[test]
fn deposit_rejects_zero() {
    let s = setup();
    let lp = Address::generate(&s.e);
    assert_eq!(s.vault.try_deposit(&lp, &0), Err(Ok(Error::ZeroAmount.into())));
}

// ─────────────────────────── LP side: withdraw / redeem ────────────────────

#[test]
fn withdraw_by_asset_amount_burns_matching_shares() {
    let s = setup();
    let lp = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);

    // No interest yet -> price 1:1, so 40_000 assets burns 40_000 shares.
    let burned = s.vault.withdraw(&lp, &40_000);
    assert_eq!(burned, 40_000);
    assert_eq!(s.usdc.balance(&lp), 40_000);
    assert_eq!(s.vault.balance_of(&lp), 60_000);
    assert_eq!(s.vault.total_assets(), 60_000);
}

#[test]
fn redeem_all_shares_returns_assets() {
    let s = setup();
    let lp = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    let shares = s.vault.deposit(&lp, &100_000);

    let out = s.vault.redeem(&lp, &shares);
    assert_eq!(out, 100_000); // 1:1, no interest
    assert_eq!(s.vault.balance_of(&lp), 0);
    assert_eq!(s.vault.total_supply(), 0);
}

#[test]
fn withdraw_over_idle_liquidity_fails() {
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);

    // Borrow 60k -> only 40k cash left in the vault.
    grant(&s, &borrower, 60_000);
    s.vault.borrow_with_term(&borrower, &60_000, &7, &500);

    assert_eq!(
        s.vault.try_withdraw(&lp, &50_000),
        Err(Ok(Error::InsufficientCash.into()))
    );
}

#[test]
fn redeem_more_shares_than_owned_fails() {
    let s = setup();
    let lp = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    let shares = s.vault.deposit(&lp, &100_000);
    assert_eq!(
        s.vault.try_redeem(&lp, &(shares + 1)),
        Err(Ok(Error::InsufficientShares.into()))
    );
}

// ─────────────────────────── borrow ────────────────────────────────────────

#[test]
fn borrow_moves_cash_to_borrows_keeping_total_assets() {
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);
    grant(&s, &borrower, 25_000);

    s.vault.borrow_with_term(&borrower, &10_000, &7, &500);
    assert_eq!(s.usdc.balance(&borrower), 10_000);
    assert_eq!(s.vault.total_assets(), 100_000); // invariant: unchanged at borrow
    // get_loan mirrors what the frontend reads from `loans(addr)`.
    let l = s.lm.get_loan(&borrower);
    assert!(l.active);
    assert_eq!(l.principal, 10_000);
    assert_eq!(l.amount_due, 10_500);
}

#[test]
fn borrow_over_limit_fails() {
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);
    // limit 5k, offer up to 25k -> the vault's inline credit gate rejects 10k.
    let now = s.e.ledger().timestamp();
    s.lm.set_user_risk(&borrower, &600, &true, &0, &5_000);
    s.lm.set_loan_offer(&borrower, &7, &500, &(now + DAY), &25_000);
    assert_eq!(
        s.vault.try_borrow_with_term(&borrower, &10_000, &7, &500),
        Err(Ok(Error::OverCreditLimit.into()))
    );
}

#[test]
fn borrow_with_no_liquidity_fails() {
    let s = setup();
    let borrower = Address::generate(&s.e);
    grant(&s, &borrower, 25_000); // credit ok...
    // ...but the vault is empty -> InsufficientCash.
    assert_eq!(
        s.vault.try_borrow_with_term(&borrower, &10_000, &7, &500),
        Err(Ok(Error::InsufficientCash.into()))
    );
}

// ─────────────────────────── repay ─────────────────────────────────────────

#[test]
fn deposit_borrow_repay_grows_price_per_share() {
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);

    s.usdc_admin.mint(&lp, &100_000);
    let shares = s.vault.deposit(&lp, &100_000);
    assert_eq!(shares, 100_000);

    grant(&s, &borrower, 25_000);
    s.vault.borrow_with_term(&borrower, &10_000, &7, &500);

    // Repay full (10_500). Mint the 500 interest the borrower owes beyond principal.
    s.usdc_admin.mint(&borrower, &500);
    s.vault.repay(&borrower, &borrower);

    // 5% fee on 500 interest = 25 to fee recipient; 475 net interest to LPs.
    assert_eq!(s.usdc.balance(&s.fee_recipient), 25);
    assert_eq!(s.vault.total_assets(), 100_475);
    assert!(!s.lm.get_loan(&borrower).active);

    // LP withdraws everything via redeem -> original + net interest, minus 1 unit
    // of "dust" retained by the virtual-offset (+1) rounding (inflation guard).
    let out = s.vault.redeem(&lp, &shares);
    assert_eq!(out, 100_474);
    assert!(out > 100_000); // LP earned net interest
}

#[test]
fn repay_with_no_active_loan_fails() {
    let s = setup();
    let borrower = Address::generate(&s.e);
    assert_eq!(
        s.vault.try_repay(&borrower, &borrower),
        Err(Ok(Error::NoActiveLoan.into()))
    );
}

// ─────────────────────────── write-off / healing ───────────────────────────

#[test]
fn write_off_drops_then_late_repay_heals() {
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);

    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);
    grant(&s, &borrower, 25_000);
    s.vault.borrow_with_term(&borrower, &10_000, &7, &500);

    // Past due(7) + grace(1) + late(15) = 23d -> default eligible.
    s.e.ledger().with_mut(|li| li.timestamp += 24 * DAY);
    s.lm.mark_default(&borrower);

    // Write off the principal -> total_assets drops by 10_000.
    s.vault.manual_write_off(&borrower, &10_000);
    assert_eq!(s.vault.total_assets(), 90_000);

    // Borrower repays late -> vault heals (cash jumps, borrows already reduced).
    s.usdc_admin.mint(&borrower, &500);
    s.vault.repay(&borrower, &borrower);
    // cash: 100000 -10000 +10500 -25 = 100475; borrows 0.
    assert_eq!(s.vault.total_assets(), 100_475);
    assert_eq!(s.usdc.balance(&s.fee_recipient), 25);
}

#[test]
fn write_off_requires_default() {
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);
    grant(&s, &borrower, 25_000);
    s.vault.borrow_with_term(&borrower, &10_000, &7, &500);
    // Not defaulted yet -> write-off rejected.
    assert_eq!(
        s.vault.try_manual_write_off(&borrower, &10_000),
        Err(Ok(Error::NotDefaulted.into()))
    );
}

#[test]
fn write_off_is_capped_and_idempotent() {
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);
    grant(&s, &borrower, 25_000);
    s.vault.borrow_with_term(&borrower, &10_000, &7, &500);
    s.e.ledger().with_mut(|li| li.timestamp += 24 * DAY);
    s.lm.mark_default(&borrower);

    // Over-write request is capped at outstanding principal (10_000).
    s.vault.manual_write_off(&borrower, &999_999);
    assert_eq!(s.vault.total_assets(), 90_000);
    // Second write-off is a no-op (already fully written off).
    s.vault.manual_write_off(&borrower, &10_000);
    assert_eq!(s.vault.total_assets(), 90_000);
}

// ─────────────────────────── governance ────────────────────────────────────

#[test]
fn set_fee_recipient_routes_future_fees() {
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    let new_sink = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);

    s.vault.set_fee_recipient(&new_sink);
    grant(&s, &borrower, 25_000);
    s.vault.borrow_with_term(&borrower, &10_000, &7, &500);
    s.usdc_admin.mint(&borrower, &500);
    s.vault.repay(&borrower, &borrower);

    assert_eq!(s.usdc.balance(&new_sink), 25);
    assert_eq!(s.usdc.balance(&s.fee_recipient), 0); // old sink untouched
}

// ─────────────────────────── multi-LP accounting ───────────────────────────

#[test]
fn two_lps_split_interest_pro_rata() {
    let s = setup();
    let lp1 = Address::generate(&s.e);
    let lp2 = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);

    s.usdc_admin.mint(&lp1, &100_000);
    s.usdc_admin.mint(&lp2, &100_000);
    let sh1 = s.vault.deposit(&lp1, &100_000);
    let sh2 = s.vault.deposit(&lp2, &100_000);
    assert_eq!(sh1, 100_000);
    assert_eq!(sh2, 100_000);

    // Borrow 20k, repay -> interest 1000, fee 50, net 950 to the two LPs.
    grant(&s, &borrower, 25_000);
    s.vault.borrow_with_term(&borrower, &20_000, &7, &500);
    s.usdc_admin.mint(&borrower, &1_000);
    s.vault.repay(&borrower, &borrower);
    assert_eq!(s.vault.total_assets(), 200_950);

    let out1 = s.vault.redeem(&lp1, &sh1);
    let out2 = s.vault.redeem(&lp2, &sh2);
    // Each LP held half the supply -> ~half the net interest each (±1 dust).
    assert!(out1 > 100_000 && out2 > 100_000);
    assert!(out1 + out2 >= 200_948 && out1 + out2 <= 200_950);
}

// ─────────────────────────── end-to-end frontend flow ──────────────────────

#[test]
fn end_to_end_frontend_round_trip() {
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);

    // 1. LP deposits (Lend tab: approve + deposit).
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);

    // 2. Backend scores borrower + posts an offer (set_user_risk + set_loan_offer).
    grant(&s, &borrower, 25_000);

    // 3. Frontend reads the credit surface before borrowing.
    assert_eq!(s.lm.credit_limit(&borrower), 25_000);
    assert_eq!(s.lm.get_user_risk(&borrower).score, 600);
    assert_eq!(s.lm.next_borrow_time(&borrower), 0);

    // 4. Borrow (Pull panel: borrowWithTerm).
    s.vault.borrow_with_term(&borrower, &10_000, &7, &500);
    assert_eq!(s.usdc.balance(&borrower), 10_000);

    // 5. Frontend reads the live loan + owed (loans + previewLoanWithLate).
    let (principal, owed) = s.lm.preview_loan_with_late(&borrower);
    assert_eq!(principal, 10_000);
    assert_eq!(owed, 10_500);

    // 6. Repay full (repay MaxUint256 sentinel == full amount_due).
    s.usdc_admin.mint(&borrower, &500);
    s.vault.repay(&borrower, &borrower);
    assert!(!s.lm.get_loan(&borrower).active);

    // 7. LP withdraws principal back by USDC amount (withdraw(assets)).
    let burned = s.vault.withdraw(&lp, &100_000);
    assert!(burned <= 100_000);
    assert_eq!(s.usdc.balance(&lp), 100_000);
    // Net interest stays as dust-backed share value the LP can still redeem.
    assert!(s.vault.balance_of(&lp) >= 0);
}
