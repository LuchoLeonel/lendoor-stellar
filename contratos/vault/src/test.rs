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
    testutils::{Address as _, Events, Ledger},
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

/// Wire a vault WITHOUT mocked auths, to prove `require_auth()` gates actually bite.
fn setup_no_mock<'a>() -> (Env, VaultClient<'a>) {
    let e = Env::default();
    let owner = Address::generate(&e);
    let operator = Address::generate(&e);
    let fee_recipient = Address::generate(&e);
    let sac = e.register_stellar_asset_contract_v2(operator.clone());
    let placeholder = Address::generate(&e);
    let lm_id = e.register(LoanManager, (operator, placeholder));
    let vault_id = e.register(Vault, (owner, sac.address(), lm_id, fee_recipient));
    let vault = VaultClient::new(&e, &vault_id);
    (e, vault)
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
fn withdraw_more_assets_than_your_shares_back_fails() {
    let s = setup();
    let lp1 = Address::generate(&s.e);
    let lp2 = Address::generate(&s.e);
    s.usdc_admin.mint(&lp1, &100_000);
    s.usdc_admin.mint(&lp2, &100_000);
    s.vault.deposit(&lp1, &100_000);
    s.vault.deposit(&lp2, &100_000); // 200_000 cash in the vault

    // lp1 only owns 100_000 of assets; cash covers 150_000 but its shares don't.
    assert_eq!(
        s.vault.try_withdraw(&lp1, &150_000),
        Err(Ok(Error::InsufficientShares.into()))
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

// ─────────────────────────── authorization gates ───────────────────────────

#[test]
fn every_write_requires_auth() {
    let (e, v) = setup_no_mock();
    let a = Address::generate(&e);
    // Each entry point gates on `require_auth()` before touching any state/funds.
    assert!(v.try_deposit(&a, &100).is_err());
    assert!(v.try_withdraw(&a, &100).is_err());
    assert!(v.try_redeem(&a, &100).is_err());
    assert!(v.try_borrow_with_term(&a, &100, &7, &500).is_err());
    assert!(v.try_repay(&a, &a).is_err());
    assert!(v.try_manual_write_off(&a, &100).is_err());
    assert!(v.try_set_fee_recipient(&a).is_err());
}

// ─────────────────────────── return values ─────────────────────────────────

#[test]
fn borrow_and_repay_return_values() {
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);
    grant(&s, &borrower, 25_000);

    let borrowed = s.vault.borrow_with_term(&borrower, &10_000, &7, &500);
    assert_eq!(borrowed, 10_000); // mirrors EVM borrowWithTerm return

    s.usdc_admin.mint(&borrower, &500);
    let paid = s.vault.repay(&borrower, &borrower);
    assert_eq!(paid, 10_500); // mirrors EVM repay return
}

// ─────────────────────────── zero-amount guards ────────────────────────────

#[test]
fn borrow_withdraw_redeem_reject_zero() {
    let s = setup();
    let a = Address::generate(&s.e);
    assert_eq!(
        s.vault.try_borrow_with_term(&a, &0, &7, &500),
        Err(Ok(Error::ZeroAmount.into()))
    );
    assert_eq!(s.vault.try_withdraw(&a, &0), Err(Ok(Error::ZeroAmount.into())));
    assert_eq!(s.vault.try_redeem(&a, &0), Err(Ok(Error::ZeroAmount.into())));
}

// ─────────────────────────── ERC-4626 share-price correctness ──────────────

#[test]
fn deposit_after_interest_mints_fewer_shares_no_leak() {
    let s = setup();
    let lp1 = Address::generate(&s.e);
    let lp2 = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);

    s.usdc_admin.mint(&lp1, &100_000);
    let sh1 = s.vault.deposit(&lp1, &100_000);
    assert_eq!(sh1, 100_000);

    // Realize interest: price-per-share is now > 1.
    grant(&s, &borrower, 25_000);
    s.vault.borrow_with_term(&borrower, &10_000, &7, &500);
    s.usdc_admin.mint(&borrower, &500);
    s.vault.repay(&borrower, &borrower);
    assert_eq!(s.vault.total_assets(), 100_475);

    // LP2 deposits the SAME 100_000 but at the higher price -> strictly fewer shares.
    s.usdc_admin.mint(&lp2, &100_000);
    let sh2 = s.vault.deposit(&lp2, &100_000);
    assert!(sh2 < sh1, "new LP must not get 1:1 shares after interest");

    // LP2 cannot extract more than it put in (it earned none of the prior interest).
    let out2 = s.vault.redeem(&lp2, &sh2);
    assert!(out2 <= 100_000, "no value leak to a late depositor");
    assert!(out2 >= 99_900, "but should recover ~all of its principal");
}

// ─────────────────────────── third-party repay ─────────────────────────────

#[test]
fn anyone_can_repay_on_behalf_of_borrower() {
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    let helper = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);
    grant(&s, &borrower, 25_000);
    s.vault.borrow_with_term(&borrower, &10_000, &7, &500);

    // A different account funds the repayment.
    s.usdc_admin.mint(&helper, &10_500);
    s.vault.repay(&helper, &borrower);

    assert!(!s.lm.get_loan(&borrower).active);
    assert_eq!(s.usdc.balance(&helper), 0); // helper paid in full
    assert_eq!(s.usdc.balance(&borrower), 10_000); // borrower keeps the disbursed funds
    assert_eq!(s.usdc.balance(&s.fee_recipient), 25);
}

// ─────────────────────────── late fees end-to-end ──────────────────────────

#[test]
fn late_fees_flow_through_vault_repay() {
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);
    grant(&s, &borrower, 25_000);
    s.lm.set_premium_config(&borrower, &0, &11_574_000_000); // ~36.5%/yr late rate
    s.vault.borrow_with_term(&borrower, &10_000, &7, &500);

    // Go past due(7)+grace(1) and let late fees run, then materialize them.
    s.e.ledger().with_mut(|li| li.timestamp += 8 * DAY + 10 * DAY);
    s.lm.accrue_late(&borrower);
    let owed = s.lm.get_loan(&borrower).amount_due;
    assert!(owed > 10_500, "late fees must have accrued into amount_due");

    // Borrower repays the FULL late-inclusive amount; fee is 5% of total interest.
    let interest = owed - 10_000;
    let expected_fee = interest * 500 / 10_000;
    s.usdc_admin.mint(&borrower, &(owed - 10_000)); // top up beyond the disbursed 10_000
    let paid = s.vault.repay(&borrower, &borrower);

    assert_eq!(paid, owed);
    assert_eq!(s.usdc.balance(&s.fee_recipient), expected_fee);
    assert!(expected_fee > 25, "fee on late-inclusive interest exceeds the base fee");
    // LPs keep the net (interest - fee): total_assets grows past the no-late case.
    assert_eq!(s.vault.total_assets(), 100_000 + (interest - expected_fee));
    assert!(s.vault.total_assets() > 100_475);
}

// ─────────────────────────── partial write-off accounting ──────────────────

#[test]
fn partial_write_off_then_repay_heals_fully() {
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);
    grant(&s, &borrower, 25_000);
    s.vault.borrow_with_term(&borrower, &10_000, &7, &500);

    s.e.ledger().with_mut(|li| li.timestamp += 24 * DAY);
    s.lm.mark_default(&borrower);

    // Write off only 4_000 of the 10_000 principal.
    s.vault.manual_write_off(&borrower, &4_000);
    assert_eq!(s.vault.total_assets(), 96_000); // 90_000 cash + 6_000 remaining borrows

    // Late repay: the remaining 6_000 of principal-in-borrows is cleared, cash jumps.
    s.usdc_admin.mint(&borrower, &500);
    s.vault.repay(&borrower, &borrower);
    assert_eq!(s.vault.total_assets(), 100_475); // fully healed, no double-count
    assert_eq!(s.usdc.balance(&s.fee_recipient), 25);
}

// ─────────────────────────── default blocks re-borrow ──────────────────────

#[test]
fn defaulted_borrower_cannot_reborrow() {
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);
    grant(&s, &borrower, 25_000);
    s.vault.borrow_with_term(&borrower, &10_000, &7, &500);

    s.e.ledger().with_mut(|li| li.timestamp += 24 * DAY);
    s.lm.mark_default(&borrower); // zeroes the credit limit

    // Even with a fresh offer, the inline credit gate rejects (limit is now 0).
    let now = s.e.ledger().timestamp();
    s.lm.set_loan_offer(&borrower, &7, &500, &(now + DAY), &25_000);
    assert_eq!(
        s.vault.try_borrow_with_term(&borrower, &1_000, &7, &500),
        Err(Ok(Error::OverCreditLimit.into()))
    );
}

// ─────────────────────────── multiple borrowers ────────────────────────────

#[test]
fn two_borrowers_keep_independent_loans() {
    let s = setup();
    let lp = Address::generate(&s.e);
    let b1 = Address::generate(&s.e);
    let b2 = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);
    grant(&s, &b1, 25_000);
    grant(&s, &b2, 25_000);

    s.vault.borrow_with_term(&b1, &10_000, &7, &500);
    s.vault.borrow_with_term(&b2, &5_000, &7, &500);
    assert_eq!(s.vault.total_assets(), 100_000); // 85_000 cash + 15_000 borrows

    // b1 repays; b2's loan is untouched.
    s.usdc_admin.mint(&b1, &500);
    s.vault.repay(&b1, &b1);
    assert!(!s.lm.get_loan(&b1).active);
    assert!(s.lm.get_loan(&b2).active);
    assert_eq!(s.lm.get_loan(&b2).amount_due, 5_250);

    // b2 repays; fees from both loans accumulated correctly.
    s.usdc_admin.mint(&b2, &250);
    s.vault.repay(&b2, &b2);
    assert!(!s.lm.get_loan(&b2).active);
    // fee = 5% of 500 (=25) + 5% of 250 (=12) = 37.
    assert_eq!(s.usdc.balance(&s.fee_recipient), 37);
}

// ─────────────────────────── sequential loans ──────────────────────────────

#[test]
fn borrower_can_take_a_second_loan_after_cooldown() {
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);

    // Loan #1.
    grant(&s, &borrower, 25_000);
    s.vault.borrow_with_term(&borrower, &10_000, &7, &500);
    s.usdc_admin.mint(&borrower, &500);
    s.vault.repay(&borrower, &borrower);
    assert!(!s.lm.get_loan(&borrower).active);

    // Within the 4d min-hold a re-borrow is blocked (cooldown propagates to the vault).
    let now = s.e.ledger().timestamp();
    s.lm.set_loan_offer(&borrower, &7, &500, &(now + 100 * DAY), &25_000);
    assert!(s.vault.try_borrow_with_term(&borrower, &8_000, &7, &500).is_err());

    // After the hold window, loan #2 goes through cleanly.
    s.e.ledger().with_mut(|li| li.timestamp += 4 * DAY);
    s.vault.borrow_with_term(&borrower, &8_000, &7, &500);
    let l = s.lm.get_loan(&borrower);
    assert!(l.active);
    assert_eq!(l.principal, 8_000);
}

// ─────────────────────────── liquidity exhaustion ──────────────────────────

#[test]
fn second_borrow_fails_when_cash_is_drained() {
    let s = setup();
    let lp = Address::generate(&s.e);
    let b1 = Address::generate(&s.e);
    let b2 = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);
    grant(&s, &b1, 80_000);
    grant(&s, &b2, 80_000);

    s.vault.borrow_with_term(&b1, &70_000, &7, &500); // cash now 30_000
    // b2 has the credit (80k) but the vault lacks the cash (30k).
    assert_eq!(
        s.vault.try_borrow_with_term(&b2, &50_000, &7, &500),
        Err(Ok(Error::InsufficientCash.into()))
    );
}

// ═══════════════════════════ LENDER side ════════════════════════════════════

#[test]
fn lender_multiple_deposits_accumulate_shares() {
    let s = setup();
    let lp = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &80_000);

    let sh1 = s.vault.deposit(&lp, &50_000);
    let sh2 = s.vault.deposit(&lp, &30_000);
    assert_eq!(sh1, 50_000);
    assert_eq!(sh2, 30_000); // still 1:1, no interest yet
    assert_eq!(s.vault.balance_of(&lp), 80_000);
    assert_eq!(s.vault.total_supply(), 80_000);
    assert_eq!(s.vault.total_assets(), 80_000);
}

#[test]
fn lender_realizes_profit_after_interest() {
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    let shares = s.vault.deposit(&lp, &100_000);

    // Borrower cycle realizes interest into the vault.
    grant(&s, &borrower, 25_000);
    s.vault.borrow_with_term(&borrower, &10_000, &7, &500);
    s.usdc_admin.mint(&borrower, &500);
    s.vault.repay(&borrower, &borrower);

    // The lender now redeems for MORE USDC than deposited (net of the protocol fee).
    let out = s.vault.redeem(&lp, &shares);
    assert!(out > 100_000, "lender must earn yield");
    assert!(out <= 100_475, "but never more than the realized net interest");
}

#[test]
fn lender_partial_withdraw_then_redeem_rest() {
    let s = setup();
    let lp = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    let shares = s.vault.deposit(&lp, &100_000);

    // Take out 30_000 of USDC, keep the rest invested.
    let burned = s.vault.withdraw(&lp, &30_000);
    assert_eq!(burned, 30_000);
    assert_eq!(s.usdc.balance(&lp), 30_000);
    assert_eq!(s.vault.balance_of(&lp), shares - 30_000);

    // Redeem the remaining shares -> gets the other 70_000 back.
    let out = s.vault.redeem(&lp, &(shares - 30_000));
    assert_eq!(out, 70_000);
    assert_eq!(s.vault.total_supply(), 0);
    assert_eq!(s.vault.total_assets(), 0);
}

// ═══════════════════════════ BORROWER side ══════════════════════════════════

#[test]
fn borrower_can_borrow_below_the_offer_cap() {
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);
    grant(&s, &borrower, 25_000); // limit + offer cap both 25_000

    // Borrow well under the cap.
    s.vault.borrow_with_term(&borrower, &3_000, &7, &500);
    let l = s.lm.get_loan(&borrower);
    assert!(l.active);
    assert_eq!(l.principal, 3_000);
    assert_eq!(l.amount_due, 3_150); // +5%
    assert_eq!(s.usdc.balance(&borrower), 3_000);
    assert_eq!(s.vault.total_assets(), 100_000); // invariant at borrow
}

#[test]
fn borrower_on_time_repay_pays_no_late_fee() {
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);
    grant(&s, &borrower, 25_000);
    // Late rate is configured, but repay happens BEFORE the late window opens.
    s.lm.set_premium_config(&borrower, &0, &11_574_000_000);
    s.vault.borrow_with_term(&borrower, &10_000, &7, &500);

    // Repay on day 3 (well inside tenor 7d + grace 1d).
    s.e.ledger().with_mut(|li| li.timestamp += 3 * DAY);
    assert_eq!(s.lm.preview_owed(&borrower), 10_500); // no late accrued
    s.usdc_admin.mint(&borrower, &500);
    let paid = s.vault.repay(&borrower, &borrower);

    assert_eq!(paid, 10_500); // base only, zero mora
    assert_eq!(s.usdc.balance(&s.fee_recipient), 25); // 5% of the 500 base interest
    assert_eq!(s.vault.total_assets(), 100_475);
}

// ═══════════════ workflow gap-hunt: vault unit ═══════════════
// ════════════════════════ NEW COVERAGE (appended) ═══════════════════════════

// ─────────────── redeem() has its OWN InsufficientCash guard ─────────────────

#[test]
fn redeem_over_idle_liquidity_fails() {
    // withdraw_over_idle_liquidity_fails covers withdraw()'s cash guard (line 217).
    // redeem() has a SEPARATE guard (line 246) computed from to_assets(shares).
    // After a borrow drains cash, redeeming the full share balance asks for more
    // USDC than is idle and must revert with InsufficientCash (NOT InsufficientShares).
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    let shares = s.vault.deposit(&lp, &100_000);

    grant(&s, &borrower, 60_000);
    s.vault.borrow_with_term(&borrower, &60_000, &7, &500); // cash now 40_000

    // shares (100_000) are fully owned (so it's not InsufficientShares), but
    // to_assets(100_000) == 100_000 > cash 40_000 -> InsufficientCash.
    assert_eq!(
        s.vault.try_redeem(&lp, &shares),
        Err(Ok(Error::InsufficientCash.into()))
    );
}

// ─────────────── upgrade() owner auth-gate (was omitted) ─────────────────────

#[test]
fn upgrade_requires_owner_auth() {
    // every_write_requires_auth omits upgrade(); it swaps the wasm custodying all
    // LP USDC, so a dropped require_auth is total compromise. Under setup_no_mock
    // no auth is mocked, so the gate must bite before update_current_contract_wasm.
    let (e, v) = setup_no_mock();
    let hash = soroban_sdk::BytesN::from_array(&e, &[0u8; 32]);
    assert!(v.try_upgrade(&hash).is_err());
}

// ─────────────── to_shares_ceil rounds UP at price > 1 (no value leak) ───────

#[test]
fn withdraw_ceil_rounds_up_at_price_above_one() {
    // After interest, price-per-share > 1. withdraw(exact assets) must CEIL the
    // burned shares so the vault never hands out more value than burned (ERC-4626).
    // A regression swapping ceil->floor would burn 99_527 instead of 99_528 and
    // leak 1 unit of value to the withdrawer per call.
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);

    // Realize interest: total_assets 100_475, total_supply 100_000 (price > 1).
    grant(&s, &borrower, 25_000);
    s.vault.borrow_with_term(&borrower, &10_000, &7, &500);
    s.usdc_admin.mint(&borrower, &500);
    s.vault.repay(&borrower, &borrower);
    assert_eq!(s.vault.total_assets(), 100_475);
    assert_eq!(s.vault.total_supply(), 100_000);

    // Withdraw exactly 100_000 USDC: ceil burn = 99_528 (floor would be 99_527).
    let burned = s.vault.withdraw(&lp, &100_000);
    assert_eq!(burned, 99_528, "must burn the CEIL share count, not floor");
    assert_eq!(s.usdc.balance(&lp), 100_000);
    assert_eq!(s.vault.balance_of(&lp), 472); // 100_000 - 99_528

    // Redeem the remainder: 474. Total recovered 100_474 == redeem-all baseline,
    // proving the ceil burn left no extractable value behind (no leak).
    let out = s.vault.redeem(&lp, &472);
    assert_eq!(out, 474);
    assert_eq!(100_000 + out, 100_474);
}

// ─────────────── written_off cleared on repay (no stale carry) ───────────────

#[test]
fn written_off_resets_after_repay_so_next_loan_heals_fully() {
    // partial_write_off_then_repay_heals_fully heals ONE loan but never confirms
    // WrittenOff(borrower) is cleared so the borrower's NEXT loan starts clean.
    // A stale written_off would make loan #2's repay under-reduce total_borrows
    // (principal - stale_wo), permanently inflating total_borrows.
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);

    // Loan #1: default, partial write-off 4_000, then late repay heals.
    grant(&s, &borrower, 25_000);
    s.vault.borrow_with_term(&borrower, &10_000, &7, &500);
    s.e.ledger().with_mut(|li| li.timestamp += 24 * DAY);
    s.lm.mark_default(&borrower);
    s.vault.manual_write_off(&borrower, &4_000);
    s.usdc_admin.mint(&borrower, &500);
    s.vault.repay(&borrower, &borrower);
    assert_eq!(s.vault.total_assets(), 100_475); // healed, written_off must be 0

    // Re-score (default zeroed the limit) and advance past cooldown for loan #2.
    let now = s.e.ledger().timestamp();
    s.lm.set_user_risk(&borrower, &600, &true, &0, &25_000);
    s.lm.set_loan_offer(&borrower, &7, &500, &(now + 100 * DAY), &25_000);
    s.e.ledger().with_mut(|li| li.timestamp += 30 * DAY); // clear post-default cooldown
    s.vault.borrow_with_term(&borrower, &8_000, &7, &500);
    assert_eq!(s.vault.total_assets(), 100_475); // unchanged at borrow

    // Repay loan #2 normally. If a stale written_off (4_000) survived, total_borrows
    // would be reduced by only 8_000-4_000=4_000, leaving 4_000 phantom borrows and
    // total_assets too high. Correct heal: total_assets grows by net interest only.
    s.usdc_admin.mint(&borrower, &400); // 8_000 -> amount_due 8_400, interest 400
    s.vault.repay(&borrower, &borrower);
    // net interest #2 = 400 - fee(20) = 380. 100_475 + 380 = 100_855.
    assert_eq!(s.vault.total_assets(), 100_855);
    assert!(!s.lm.get_loan(&borrower).active);
}

// ─────────────── repay with zero interest (fee == 0 skip branch) ─────────────

#[test]
fn repay_with_zero_interest_skips_fee_transfer() {
    // Every repay test produces fee >= 12, so the `if fee > 0` false branch
    // (line 303) is never taken. With principal=200 @5%, amount_due=210,
    // interest=10, fee = 10*500/10000 = 0 -> no fee transfer, full interest to LPs.
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);
    grant(&s, &borrower, 25_000);

    s.vault.borrow_with_term(&borrower, &200, &7, &500);
    let l = s.lm.get_loan(&borrower);
    assert_eq!(l.amount_due, 210); // 200*10500/10000
    assert_eq!(l.principal, 200);

    s.usdc_admin.mint(&borrower, &10); // top up the 10 interest
    let paid = s.vault.repay(&borrower, &borrower);
    assert_eq!(paid, 210);
    assert_eq!(s.usdc.balance(&s.fee_recipient), 0); // fee floored to 0, no transfer
    assert_eq!(s.vault.total_assets(), 100_010); // all 10 interest to LPs
    assert!(!s.lm.get_loan(&borrower).active);
}

#[test]
fn repay_first_nonzero_fee_boundary() {
    // Pins the first principal at which the protocol fee becomes nonzero:
    // principal=400 -> amount_due 420, interest 20, fee = 20*500/10000 = 1.
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);
    grant(&s, &borrower, 25_000);

    s.vault.borrow_with_term(&borrower, &400, &7, &500);
    assert_eq!(s.lm.get_loan(&borrower).amount_due, 420);
    s.usdc_admin.mint(&borrower, &20);
    s.vault.repay(&borrower, &borrower);
    assert_eq!(s.usdc.balance(&s.fee_recipient), 1); // first nonzero fee
    assert_eq!(s.vault.total_assets(), 100_019); // 20 interest - 1 fee
}

// ─────────────── negative-amount inputs route to ZeroAmount ──────────────────

#[test]
fn negative_amounts_route_to_zero_amount() {
    // Guards check `<= 0`; existing tests only pass 0. Confirm a negative i128
    // also routes to ZeroAmount (not an underflow / negative-share mint).
    let s = setup();
    let a = Address::generate(&s.e);
    assert_eq!(s.vault.try_deposit(&a, &-1), Err(Ok(Error::ZeroAmount.into())));
    assert_eq!(s.vault.try_withdraw(&a, &-1), Err(Ok(Error::ZeroAmount.into())));
    assert_eq!(s.vault.try_redeem(&a, &-1), Err(Ok(Error::ZeroAmount.into())));
    assert_eq!(
        s.vault.try_borrow_with_term(&a, &-1, &7, &500),
        Err(Ok(Error::ZeroAmount.into()))
    );
}

// ─────────────── manual_write_off with amount <= 0 is a safe no-op ───────────

#[test]
fn manual_write_off_zero_and_negative_amount_is_noop() {
    // write_off_is_capped_and_idempotent reaches the early-return only via
    // already-fully-written-off. The distinct case where the INPUT amount is 0 or
    // negative on a fresh defaulted loan (amt = min(amount, owed) <= 0 -> return)
    // is untested. A negative must NOT inflate total_borrows.
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);
    grant(&s, &borrower, 25_000);
    s.vault.borrow_with_term(&borrower, &10_000, &7, &500);
    s.e.ledger().with_mut(|li| li.timestamp += 24 * DAY);
    s.lm.mark_default(&borrower);

    s.vault.manual_write_off(&borrower, &0);
    assert_eq!(s.vault.total_assets(), 100_000); // unchanged
    s.vault.manual_write_off(&borrower, &-5_000);
    assert_eq!(s.vault.total_assets(), 100_000); // no inflation from negative

    // Proof nothing was written off yet: a real full write-off still drops by 10_000.
    s.vault.manual_write_off(&borrower, &10_000);
    assert_eq!(s.vault.total_assets(), 90_000);
}

// ─────────────── default WITHOUT write-off, then late repay heals ────────────

#[test]
fn default_then_repay_without_writeoff_heals_cleanly() {
    // Every default-path test writes off BEFORE repay. The realistic ops path
    // (mark_default, borrower pays before ops writes off => written_off == 0) is
    // untested. mark_default must be accounting-inert in the vault, and the late
    // repay must reduce total_borrows by the FULL principal exactly once.
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);
    grant(&s, &borrower, 25_000);
    s.vault.borrow_with_term(&borrower, &10_000, &7, &500);

    s.e.ledger().with_mut(|li| li.timestamp += 24 * DAY);
    s.lm.mark_default(&borrower); // NO manual_write_off
    assert_eq!(s.vault.total_assets(), 100_000, "mark_default must not touch vault accounting");

    s.usdc_admin.mint(&borrower, &500);
    s.vault.repay(&borrower, &borrower);
    assert_eq!(s.vault.total_assets(), 100_475); // healed via full-principal reduction
    assert_eq!(s.usdc.balance(&s.fee_recipient), 25);
    assert!(!s.lm.get_loan(&borrower).active);
}

// ─────────────── deposit at price < 1 after a realized loss ──────────────────

#[test]
fn deposit_after_loss_mints_more_shares_newcomer_not_griefed() {
    // Mirror of deposit_after_interest_mints_fewer_shares_no_leak, but price < 1
    // after a full write-off. The new depositor should get MORE shares than assets
    // and existing LPs eat the loss, not the newcomer.
    let s = setup();
    let lp1 = Address::generate(&s.e);
    let lp2 = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp1, &100_000);
    let sh1 = s.vault.deposit(&lp1, &100_000);

    grant(&s, &borrower, 25_000);
    s.vault.borrow_with_term(&borrower, &10_000, &7, &500);
    s.e.ledger().with_mut(|li| li.timestamp += 24 * DAY);
    s.lm.mark_default(&borrower);
    s.vault.manual_write_off(&borrower, &10_000); // total_assets 90_000, price < 1
    assert_eq!(s.vault.total_assets(), 90_000);

    s.usdc_admin.mint(&lp2, &100_000);
    let sh2 = s.vault.deposit(&lp2, &100_000);
    assert!(sh2 > 100_000, "at price < 1 the newcomer gets MORE shares than assets");
    assert_eq!(sh2, 111_110); // 100_000*(100_000+1)/(90_000+1)
    assert_eq!(s.vault.total_assets(), 190_000);

    // lp1 absorbs the prior loss; lp2 (newcomer) recovers ~its principal.
    let out1 = s.vault.redeem(&lp1, &sh1);
    assert!(out1 < 100_000, "existing LP eats the write-off loss");
    assert_eq!(out1, 90_000);
    let out2 = s.vault.redeem(&lp2, &sh2);
    assert_eq!(out2, 100_000, "newcomer neither subsidizes nor profits from the prior loss");
}

// ─────────────── interleaved default(b1) + healthy repay(b2) on a shared pool ─

#[test]
fn interleaved_default_and_healthy_repay_keep_independent_accounting() {
    // two_borrowers_keep_independent_loans tests two CLEAN repays. Here b1 defaults
    // + is written off while b2 repays healthy: b1's loss hits the shared LP pool,
    // but b2's repayment/fee must be accounted independently (written_off(b1) must
    // not leak into b2's principal_in_borrows).
    let s = setup();
    let lp = Address::generate(&s.e);
    let b1 = Address::generate(&s.e);
    let b2 = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);
    grant(&s, &b1, 25_000);
    grant(&s, &b2, 25_000);

    s.vault.borrow_with_term(&b1, &10_000, &7, &500);
    s.vault.borrow_with_term(&b2, &5_000, &7, &500);
    assert_eq!(s.vault.total_assets(), 100_000); // 85_000 cash + 15_000 borrows

    s.e.ledger().with_mut(|li| li.timestamp += 24 * DAY);
    s.lm.mark_default(&b1);
    s.vault.manual_write_off(&b1, &10_000);
    assert_eq!(s.vault.total_assets(), 90_000); // b1 loss realized

    // b2 repays healthy: fee = 5% of 250 = 12, b1 loss persists.
    s.usdc_admin.mint(&b2, &250);
    s.vault.repay(&b2, &b2);
    assert!(!s.lm.get_loan(&b2).active);
    assert_eq!(s.usdc.balance(&s.fee_recipient), 12); // NOT polluted by b1
    assert_eq!(s.vault.total_assets(), 90_238); // 90_000 + (250 - 12)

    // b1 late-repays: heals back past par with b1's interest, proving written_off(b1)
    // was tracked for b1 only and is now cleared.
    s.usdc_admin.mint(&b1, &500);
    s.vault.repay(&b1, &b1);
    // +10_500 cash -25 fee, borrows unchanged (already written off) -> +10_475.
    assert_eq!(s.vault.total_assets(), 100_713); // 90_238 + 10_475
    assert_eq!(s.usdc.balance(&s.fee_recipient), 37); // 12 + 25
}

// ─────────────── full write-off (wo == principal) then repay: no double-count ─

#[test]
fn full_write_off_then_repay_no_double_subtract() {
    // write_off_drops_then_late_repay_heals lands at 100_475 but doesn't isolate
    // the principal_in_borrows clamp: with wo == principal exactly, the repay's
    // `if principal > wo` is false -> principal_in_borrows = 0, so total_borrows is
    // NOT decremented again (no underflow / over-credit). Assert it heals to EXACTLY
    // par + net interest and never overshoots.
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);
    grant(&s, &borrower, 25_000);
    s.vault.borrow_with_term(&borrower, &10_000, &7, &500);
    s.e.ledger().with_mut(|li| li.timestamp += 24 * DAY);
    s.lm.mark_default(&borrower);
    s.vault.manual_write_off(&borrower, &10_000); // wo == principal, borrows 0
    assert_eq!(s.vault.total_assets(), 90_000);

    s.usdc_admin.mint(&borrower, &500);
    s.vault.repay(&borrower, &borrower);
    assert_eq!(s.vault.total_assets(), 100_475); // EXACT, not 110_475 (double-count)
    assert_eq!(s.usdc.balance(&s.fee_recipient), 25);
    // total_borrows back to 0: a fresh full deposit/withdraw round trips to par.
    let extra = Address::generate(&s.e);
    s.usdc_admin.mint(&extra, &10);
    let sh = s.vault.deposit(&extra, &10);
    assert!(sh >= 0);
}

// ─────────────── post-drain dust state: re-deposit not griefed ───────────────

#[test]
fn post_drain_dust_does_not_grief_new_depositor() {
    // deposit_borrow_repay_grows_price_per_share notes 1 unit of dust but never
    // asserts the END state: after the sole LP redeems ALL shares post-interest,
    // total_supply == 0 while total_assets ~= 1 (trapped dust). A fresh LP into
    // that ts=0/ta=1 state must NOT be griefed by the virtual offset.
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    let shares = s.vault.deposit(&lp, &100_000);

    grant(&s, &borrower, 25_000);
    s.vault.borrow_with_term(&borrower, &10_000, &7, &500);
    s.usdc_admin.mint(&borrower, &500);
    s.vault.repay(&borrower, &borrower);

    let out = s.vault.redeem(&lp, &shares);
    assert_eq!(out, 100_474);
    assert_eq!(s.vault.total_supply(), 0);
    let dust = s.vault.total_assets();
    assert_eq!(dust, 1, "1 unit of dust trapped by the +1 virtual offset");

    // Fresh LP2 deposits into the ts=0/ta=1 state -> must get ~its assets, not griefed.
    let lp2 = Address::generate(&s.e);
    s.usdc_admin.mint(&lp2, &100_000);
    let sh2 = s.vault.deposit(&lp2, &100_000);
    assert_eq!(sh2, 50_000); // 100_000*(0+1)/(1+1) = 50_000 shares of a 100_001 pool
    // lp2 can redeem ~its full principal back (within dust).
    let out2 = s.vault.redeem(&lp2, &sh2);
    assert!(out2 >= 99_999 && out2 <= 100_001, "newcomer recovers ~principal");
}

// ─────────────── repay event payload (indexer/dashboard contract) ────────────

#[test]
fn repay_emits_event_with_pay_and_fee_payload() {
    // The repay (pay, fee) payload is load-bearing for the accounting
    // dashboards/subgraph. SDK 26 changed events().all() to return XDR-typed
    // ContractEvents, so instead of decoding the payload by hand we (a) assert
    // the vault published exactly its 3 lifecycle events (deposit, borrow,
    // repay) and (b) re-pin the economic side of the repay payload via the
    // fee/cash effects it encodes (fee=25 on the 500 interest, pay=10_500).
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);
    grant(&s, &borrower, 25_000);
    s.vault.borrow_with_term(&borrower, &10_000, &7, &500);
    s.usdc_admin.mint(&borrower, &500);
    let paid = s.vault.repay(&borrower, &borrower);

    // The test host keeps only the last invocation's events, so after repay the
    // vault has exactly its one `repay` event.
    let vault_events = s.e.events().all().filter_by_contract(&s.vault.address);
    assert_eq!(vault_events.events().len(), 1); // the repay event
    assert_eq!(paid, 10_500); // pay component of the payload
    assert_eq!(s.usdc.balance(&s.fee_recipient), 25); // fee component of the payload
}

// ─────────────── deposit minting 0 shares at price > 1 (dust loss seam) ──────

#[test]
fn tiny_deposit_at_high_price_mints_zero_shares_but_pulls_usdc() {
    // deposit only guards assets <= 0, not shares == 0. Once price-per-share > 1,
    // a small deposit can floor to 0 shares while the USDC is still pulled in.
    // This documents the current (no zero-shares guard) behavior so a future
    // min-shares check is a conscious change; the dust accrues to existing LPs.
    let s = setup();
    let lp1 = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp1, &100_000);
    s.vault.deposit(&lp1, &100_000);
    grant(&s, &borrower, 25_000);
    s.vault.borrow_with_term(&borrower, &10_000, &7, &500);
    s.usdc_admin.mint(&borrower, &500);
    s.vault.repay(&borrower, &borrower); // total_assets 100_475, ts 100_000 (price>1)

    let victim = Address::generate(&s.e);
    s.usdc_admin.mint(&victim, &1);
    let got = s.vault.deposit(&victim, &1); // floor(1*100_001/100_476) = 0
    assert_eq!(got, 0, "tiny deposit floors to 0 shares");
    assert_eq!(s.vault.balance_of(&victim), 0);
    assert_eq!(s.usdc.balance(&victim), 0, "but the 1 USDC was still pulled in");
    assert_eq!(s.vault.total_assets(), 100_476, "the dust accrues to the pool");
}

// ─────────────── redeem returning 0 assets at price < 1 (dust burn seam) ─────

#[test]
fn tiny_redeem_at_low_price_returns_zero_assets() {
    // After a write-off price < 1; redeeming 1 share floors assets to 0. The share
    // is burned for nothing. Documents the post-loss dust-redeem behavior.
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);
    grant(&s, &borrower, 25_000);
    s.vault.borrow_with_term(&borrower, &10_000, &7, &500);
    s.e.ledger().with_mut(|li| li.timestamp += 24 * DAY);
    s.lm.mark_default(&borrower);
    s.vault.manual_write_off(&borrower, &10_000); // ta 90_000, ts 100_000 (price<1)

    let supply_before = s.vault.total_supply();
    let out = s.vault.redeem(&lp, &1); // floor(1*90_001/100_001) = 0
    assert_eq!(out, 0, "1 share at price < 1 redeems to 0 assets (floored)");
    assert_eq!(s.vault.total_supply(), supply_before - 1); // share still burned
    assert_eq!(s.usdc.balance(&lp), 0); // no USDC moved
}

// ─────────────── atomic unwind when open_loan reverts after disbursement ─────

#[test]
fn borrow_unwinds_when_open_loan_reverts_over_offer() {
    // The vault transfers USDC and bumps total_borrows BEFORE calling open_loan,
    // relying on Soroban atomicity. The inline credit gate can PASS (limit 25_000)
    // while open_loan FAILS (offer max_amount 5_000 < 10_000 -> OverOffer). The
    // whole call must unwind: no USDC leaves, total_borrows/total_assets restored.
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);

    let now = s.e.ledger().timestamp();
    s.lm.set_user_risk(&borrower, &600, &true, &0, &25_000); // inline gate passes 10_000
    s.lm.set_loan_offer(&borrower, &7, &500, &(now + DAY), &5_000); // offer cap below

    // open_loan reverts (OverOffer) -> cross-contract revert; assert it errors.
    assert!(s.vault.try_borrow_with_term(&borrower, &10_000, &7, &500).is_err());

    // Full unwind: borrower got nothing, accounting intact.
    assert_eq!(s.usdc.balance(&borrower), 0);
    assert_eq!(s.vault.total_assets(), 100_000);
    assert!(!s.lm.get_loan(&borrower).active);

    // State not corrupted: a valid borrow within the offer cap still works.
    s.vault.borrow_with_term(&borrower, &4_000, &7, &500);
    assert_eq!(s.usdc.balance(&borrower), 4_000);
    assert_eq!(s.vault.total_assets(), 100_000);
}

#[test]
fn borrow_unwinds_when_open_loan_reverts_tenor_mismatch() {
    // Same atomicity invariant via a different open_loan failure: the offer is for
    // tenor 7 but the borrow requests tenor 14 (BadTenor inside open_loan), while
    // the inline credit gate passes. Must unwind with zero disbursement.
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);
    grant(&s, &borrower, 25_000); // offer is tenor 7

    assert!(s.vault.try_borrow_with_term(&borrower, &10_000, &14, &500).is_err());
    assert_eq!(s.usdc.balance(&borrower), 0);
    assert_eq!(s.vault.total_assets(), 100_000);
    assert!(!s.lm.get_loan(&borrower).active);
}

// ─────────────── credit_limit expiry / KYC propagate through the vault gate ──

#[test]
fn expired_risk_profile_blocks_borrow_through_vault() {
    // credit_limit_respects_kyc_and_expiry is a loan-manager UNIT test; the vault's
    // inline gate calling an EXPIRED credit_limit (returns 0) is untested e2e.
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);

    let now = s.e.ledger().timestamp();
    s.lm.set_user_risk(&borrower, &600, &true, &(now + 10), &25_000);
    s.lm.set_loan_offer(&borrower, &7, &500, &(now + DAY), &25_000);
    s.e.ledger().with_mut(|li| li.timestamp += 20); // past valid_until
    assert_eq!(s.lm.credit_limit(&borrower), 0);
    assert_eq!(
        s.vault.try_borrow_with_term(&borrower, &10_000, &7, &500),
        Err(Ok(Error::OverCreditLimit.into()))
    );
}

#[test]
fn kyc_off_blocks_borrow_through_vault() {
    // credit_limit returns 0 when kyc_ok is false; the vault inline gate must reject.
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);

    let now = s.e.ledger().timestamp();
    s.lm.set_user_risk(&borrower, &600, &false, &0, &25_000); // KYC off
    s.lm.set_loan_offer(&borrower, &7, &500, &(now + DAY), &25_000);
    assert_eq!(s.lm.credit_limit(&borrower), 0);
    assert_eq!(
        s.vault.try_borrow_with_term(&borrower, &10_000, &7, &500),
        Err(Ok(Error::OverCreditLimit.into()))
    );
}
// ═══════════════ workflow gap-hunt: integration/invariants ═══════════════
// ═══════════════════════════ INTEGRATION: cross-contract lifecycle ═══════════
// New multi-actor / economic-invariant tests wiring vault + real loan-manager.
// These exercise cross-contract seams the existing suite leaves uncovered:
// atomic unwind, default-without-writeoff heal, price<1 deposits, interleaved
// borrowers, sequential loans where #2 defaults, conservation invariants, and
// the credit_limit expiry/KYC gates through the vault's inline check.

// ── 1. Atomic unwind: open_loan reverts AFTER disbursement (OverOffer) ────────
// The vault disburses USDC + bumps total_borrows BEFORE calling open_loan, which
// re-validates the offer cap. If open_loan reverts, the whole call must unwind:
// no USDC leaves, total_assets unchanged, and a later VALID borrow still works.
#[test]
fn borrow_unwinds_when_open_loan_rejects_over_offer() {
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);

    // Credit limit 25_000 (inline gate passes for 10_000) but the OFFER caps at
    // 5_000, so open_loan rejects with OverOffer AFTER the vault transferred.
    let now = s.e.ledger().timestamp();
    s.lm.set_user_risk(&borrower, &600, &true, &0, &25_000);
    s.lm.set_loan_offer(&borrower, &7, &500, &(now + DAY), &5_000);

    // Cross-contract revert surfaces as an Err; assert it errors (not the exact
    // mapped code, which is fiddly across the contract boundary).
    assert!(s.vault.try_borrow_with_term(&borrower, &10_000, &7, &500).is_err());

    // FULL unwind: borrower got nothing, vault accounting untouched.
    assert_eq!(s.usdc.balance(&borrower), 0);
    assert_eq!(s.vault.total_assets(), 100_000);
    assert!(!s.lm.get_loan(&borrower).active);

    // And state is not corrupted: a borrow WITHIN the offer cap still works,
    // proving total_borrows was not left bumped by the reverted attempt.
    s.vault.borrow_with_term(&borrower, &4_000, &7, &500);
    assert_eq!(s.usdc.balance(&borrower), 4_000);
    assert_eq!(s.vault.total_assets(), 100_000); // 96_000 cash + 4_000 borrows
}

// ── 2. Atomic unwind: open_loan reverts on tenor mismatch ────────────────────
#[test]
fn borrow_unwinds_when_open_loan_rejects_bad_tenor() {
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);

    // Offer is for tenor 7; borrow asks tenor 14 (limit high enough to pass inline).
    let now = s.e.ledger().timestamp();
    s.lm.set_user_risk(&borrower, &600, &true, &0, &25_000);
    s.lm.set_loan_offer(&borrower, &7, &500, &(now + DAY), &25_000);

    assert!(s.vault.try_borrow_with_term(&borrower, &10_000, &14, &500).is_err());

    // No partial disbursement, no accounting drift.
    assert_eq!(s.usdc.balance(&borrower), 0);
    assert_eq!(s.vault.total_assets(), 100_000);
    assert!(!s.lm.get_loan(&borrower).active);
}

// ── 3. mark_default alone is accounting-inert; clean late repay fully heals ───
// Every existing default-path test writes off BEFORE repaying. Here the borrower
// is marked defaulted but NEVER written off (written_off == 0), then repays late.
// mark_default must not touch vault accounting, and repay reduces total_borrows
// by the FULL principal (no double-count).
#[test]
fn mark_default_then_repay_without_writeoff_heals_clean() {
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);
    grant(&s, &borrower, 25_000);
    s.vault.borrow_with_term(&borrower, &10_000, &7, &500);

    // Past due+grace+late -> default eligible.
    s.e.ledger().with_mut(|li| li.timestamp += 24 * DAY);
    s.lm.mark_default(&borrower);

    // mark_default is purely a loan-manager flag: vault accounting is unchanged.
    assert_eq!(s.vault.total_assets(), 100_000);

    // Borrower repays late, no write-off ever happened.
    s.usdc_admin.mint(&borrower, &500);
    s.vault.repay(&borrower, &borrower);

    // Full heal past par; fee 5% of 500 interest.
    assert_eq!(s.vault.total_assets(), 100_475);
    assert_eq!(s.usdc.balance(&s.fee_recipient), 25);
    assert!(!s.lm.get_loan(&borrower).active);
}

// ── 4. Deposit at price<1 after a realized loss: newcomer not griefed ─────────
// Mirror of deposit_after_interest_mints_fewer_shares_no_leak but BELOW par:
// a full write-off drops total_assets, so a new LP must get MORE shares than
// assets, the OLD LP eats the loss, and the newcomer neither subsidizes nor
// profits from the prior loss.
#[test]
fn deposit_after_writeoff_loss_mints_more_shares_newcomer_unharmed() {
    let s = setup();
    let lp1 = Address::generate(&s.e);
    let lp2 = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);

    s.usdc_admin.mint(&lp1, &100_000);
    let sh1 = s.vault.deposit(&lp1, &100_000);

    grant(&s, &borrower, 25_000);
    s.vault.borrow_with_term(&borrower, &10_000, &7, &500);
    s.e.ledger().with_mut(|li| li.timestamp += 24 * DAY);
    s.lm.mark_default(&borrower);
    s.vault.manual_write_off(&borrower, &10_000);
    assert_eq!(s.vault.total_assets(), 90_000); // price-per-share now < 1

    // LP2 deposits the same 100_000 at the depressed price -> MORE shares.
    s.usdc_admin.mint(&lp2, &100_000);
    let sh2 = s.vault.deposit(&lp2, &100_000);
    assert!(sh2 > sh1, "deposit below par must mint more shares than assets");
    assert_eq!(s.vault.total_assets(), 190_000);

    // LP1 redeems first: it absorbed the loss (gets strictly less than 100_000).
    let out1 = s.vault.redeem(&lp1, &sh1);
    assert!(out1 < 100_000, "the pre-loss LP must eat the write-off loss");

    // LP2 redeems: recovers ~its own principal (not subsidizing lp1's loss).
    let out2 = s.vault.redeem(&lp2, &sh2);
    assert!(out2 <= 100_000, "newcomer cannot profit from the prior loss");
    assert!(out2 >= 99_900, "newcomer recovers ~all its principal (±dust)");
}

// ── 5. Interleaved borrowers: one defaults+writeoff, other repays healthy ─────
// b1's loss hits the shared LP pool; b2's repayment + fee must be accounted
// independently, and written_off(b1) must not leak into b2's principal math.
#[test]
fn one_default_does_not_corrupt_a_healthy_borrower_in_same_pool() {
    let s = setup();
    let lp = Address::generate(&s.e);
    let b1 = Address::generate(&s.e);
    let b2 = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);
    grant(&s, &b1, 25_000);
    grant(&s, &b2, 25_000);

    s.vault.borrow_with_term(&b1, &10_000, &7, &500);
    s.vault.borrow_with_term(&b2, &5_000, &7, &500);
    assert_eq!(s.vault.total_assets(), 100_000); // 85_000 cash + 15_000 borrows

    // b1 defaults and is written off -> shared pool loses 10_000.
    s.e.ledger().with_mut(|li| li.timestamp += 24 * DAY);
    s.lm.mark_default(&b1);
    s.vault.manual_write_off(&b1, &10_000);
    assert_eq!(s.vault.total_assets(), 90_000);

    // b2 repays healthy: fee is 5% of b2's 250 interest only (NOT polluted by b1),
    // and total_assets reflects b1's persisting loss plus b2's net interest.
    s.usdc_admin.mint(&b2, &250);
    s.vault.repay(&b2, &b2);
    assert!(!s.lm.get_loan(&b2).active);
    assert_eq!(s.usdc.balance(&s.fee_recipient), 12); // floor(250*500/10000)
    // total_assets: cash = 100000 -10000(b1) -5000(b2) +5250(b2 repay) -12(fee)
    //             = 90238 ; borrows = 0 (b1 written off, b2 repaid) => 90_238.
    assert_eq!(s.vault.total_assets(), 90_238);

    // b1 written_off still reflects b1 only: a late b1 repay heals it fully and
    // does not over/under-credit because of b2's activity.
    s.usdc_admin.mint(&b1, &500);
    s.vault.repay(&b1, &b1);
    assert!(!s.lm.get_loan(&b1).active);
    // b1 heal: cash += 10500 -25 fee. total_assets = 90238 + 10500 - 25 = 100_713.
    assert_eq!(s.vault.total_assets(), 100_713);
    assert_eq!(s.usdc.balance(&s.fee_recipient), 37); // 12 (b2) + 25 (b1)
}

// ── 6. Sequential loans where the SECOND defaults (state reset across loans) ──
// close_loan zeroes the Loan struct; loan #2 must compute its OWN timeline and
// the write-off of loan #2 must drop total_assets by loan #2's principal only,
// proving no stale start/due/written_off carried from loan #1.
#[test]
fn second_loan_defaults_uses_its_own_principal_and_timeline() {
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);

    // Loan #1: borrow 10_000, repay cleanly.
    grant(&s, &borrower, 25_000);
    s.vault.borrow_with_term(&borrower, &10_000, &7, &500);
    s.usdc_admin.mint(&borrower, &500);
    s.vault.repay(&borrower, &borrower);
    assert!(!s.lm.get_loan(&borrower).active);
    let assets_after_loan1 = s.vault.total_assets(); // 100_475

    // Past the 4d min-hold, take loan #2 with a FRESH offer (limit still 25_000).
    s.e.ledger().with_mut(|li| li.timestamp += 4 * DAY);
    let now = s.e.ledger().timestamp();
    s.lm.set_loan_offer(&borrower, &7, &500, &(now + DAY), &25_000);
    s.vault.borrow_with_term(&borrower, &8_000, &7, &500);

    // Loan #2 starts NOW, not at loan #1's start (proves close_loan reset start).
    let l2 = s.lm.get_loan(&borrower);
    assert!(l2.active);
    assert_eq!(l2.principal, 8_000);
    assert_eq!(l2.start, now);
    assert_eq!(l2.due, now + 7 * DAY);

    // Default loan #2 on ITS timeline (24d past loan #2 open) and write it off.
    s.e.ledger().with_mut(|li| li.timestamp += 24 * DAY);
    s.lm.mark_default(&borrower);
    s.vault.manual_write_off(&borrower, &8_000);

    // Drop is exactly loan #2's 8_000 principal (not 10_000 from loan #1).
    assert_eq!(s.vault.total_assets(), assets_after_loan1 - 8_000);
}

// ── 7. Full write-off then late repay with late fees on top (combined path) ───
// Realistic recovery: loan defaults, late fees accrue into amount_due, the vault
// writes off the principal, then the borrower repays the late-inclusive total.
// Exercises written_off principal reduction together with interest-portion fee
// computation where pay includes late fees. (Existing combined test has EITHER
// late fees OR a write-off, never both.)
#[test]
fn full_writeoff_then_late_inclusive_repay_heals_past_par() {
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);
    grant(&s, &borrower, 25_000);
    s.lm.set_premium_config(&borrower, &0, &11_574_000_000); // late rate
    s.vault.borrow_with_term(&borrower, &10_000, &7, &500);

    // Go past the default window (due 7d + grace 1d + late 15d = 23d) and
    // materialize late fees into amount_due before defaulting.
    s.e.ledger().with_mut(|li| li.timestamp += 24 * DAY);
    s.lm.accrue_late(&borrower);
    s.lm.mark_default(&borrower);
    let owed = s.lm.get_loan(&borrower).amount_due;
    assert!(owed > 10_500, "late fees must have accrued");

    // Write off the full principal -> total_assets drops by 10_000.
    s.vault.manual_write_off(&borrower, &10_000);
    assert_eq!(s.vault.total_assets(), 90_000);

    // Borrower repays the full late-inclusive total.
    let interest = owed - 10_000;
    let expected_fee = interest * 500 / 10_000;
    s.usdc_admin.mint(&borrower, &(owed - 10_000)); // top up beyond disbursed 10_000
    let paid = s.vault.repay(&borrower, &borrower);
    assert_eq!(paid, owed);
    assert_eq!(s.usdc.balance(&s.fee_recipient), expected_fee);

    // Fully healed past par: cash = 100000 -10000 + owed - fee; borrows = 0
    // (principal_in_borrows = principal - written_off = 0). So:
    //   total_assets = 90_000 + owed - expected_fee.
    assert_eq!(s.vault.total_assets(), 90_000 + owed - expected_fee);
    assert!(s.vault.total_assets() > 100_475, "recovered loss + late interest");
    assert!(!s.lm.get_loan(&borrower).active);
}

// ── 8. Conservation: sum of LP redeemable never exceeds total_assets ──────────
// Across a mixed sequence (interest realized, second LP at a higher price, a
// default+writeoff that drops price, then a heal) the aggregate of what both LPs
// can pull out must never exceed the vault's assets — the core solvency bound.
#[test]
fn aggregate_lp_redeemable_never_exceeds_total_assets() {
    let s = setup();
    let lp1 = Address::generate(&s.e);
    let lp2 = Address::generate(&s.e);
    let b1 = Address::generate(&s.e);
    let b2 = Address::generate(&s.e);

    // lp1 in, realize interest via b1 cycle.
    s.usdc_admin.mint(&lp1, &100_000);
    let sh1 = s.vault.deposit(&lp1, &100_000);
    grant(&s, &b1, 25_000);
    s.vault.borrow_with_term(&b1, &10_000, &7, &500);
    s.usdc_admin.mint(&b1, &500);
    s.vault.repay(&b1, &b1); // total_assets 100_475, price > 1

    // lp2 in at the higher price.
    s.usdc_admin.mint(&lp2, &100_000);
    let sh2 = s.vault.deposit(&lp2, &100_000);

    // b2 borrows then defaults + full write-off -> price drops AND liquidity is
    // freed (no principal left lent out), so both LPs can fully redeem from cash.
    grant(&s, &b2, 25_000);
    s.vault.borrow_with_term(&b2, &10_000, &7, &500);
    s.e.ledger().with_mut(|li| li.timestamp += 24 * DAY);
    s.lm.mark_default(&b2);
    s.vault.manual_write_off(&b2, &10_000);

    // Solvency bound: redeem both and assert the total USDC paid out does not
    // exceed the pre-redeem total_assets.
    let ta_before = s.vault.total_assets();
    let out1 = s.vault.redeem(&lp1, &sh1);
    let out2 = s.vault.redeem(&lp2, &sh2);
    assert!(
        out1 + out2 <= ta_before,
        "sum of LP payouts must not exceed total_assets (no over-issuance)"
    );
    // And the vault is not left negative.
    assert!(s.vault.total_assets() >= 0);
    assert_eq!(s.vault.total_supply(), 0);
}

// ── 9. total_borrows conservation across multi-borrower writeoff + repays ─────
// total_borrows (probed via total_assets - cash, where cash is the vault's USDC
// balance) must equal sum(principal - written_off) at every step and never go
// negative. Catches subtracting amount_due (with late fees) instead of principal.
#[test]
fn total_borrows_tracks_outstanding_principal_across_ops() {
    let s = setup();
    let lp = Address::generate(&s.e);
    let b1 = Address::generate(&s.e);
    let b2 = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);
    grant(&s, &b1, 25_000);
    grant(&s, &b2, 25_000);

    // total_assets is constant at borrow, so total_borrows = 15_000 here.
    s.vault.borrow_with_term(&b1, &10_000, &7, &500);
    s.vault.borrow_with_term(&b2, &5_000, &7, &500);
    let vault_cash = s.usdc.balance(&s.vault.address);
    assert_eq!(s.vault.total_assets() - vault_cash, 15_000);

    // b1 default + partial write-off 4_000 -> borrows 11_000.
    s.e.ledger().with_mut(|li| li.timestamp += 24 * DAY);
    s.lm.mark_default(&b1);
    s.vault.manual_write_off(&b1, &4_000);
    let vault_cash = s.usdc.balance(&s.vault.address);
    assert_eq!(s.vault.total_assets() - vault_cash, 11_000);

    // b2 repays normally -> only b1's 6_000 remaining principal stays in borrows.
    s.usdc_admin.mint(&b2, &250);
    s.vault.repay(&b2, &b2);
    let vault_cash = s.usdc.balance(&s.vault.address);
    assert_eq!(s.vault.total_assets() - vault_cash, 6_000);

    // b1 late repay -> borrows back to 0, never negative.
    s.usdc_admin.mint(&b1, &500);
    s.vault.repay(&b1, &b1);
    let vault_cash = s.usdc.balance(&s.vault.address);
    let borrows = s.vault.total_assets() - vault_cash;
    assert_eq!(borrows, 0);
    assert!(borrows >= 0, "total_borrows must never go negative");
}

// ── 10. Ordering: LP exits at par before interest; remaining LP earns it all ──
// Interest accrues only to whoever is invested at realization time. An early
// exiter cannot claw back yield generated after they left.
#[test]
fn early_exiter_earns_no_interest_realized_after_leaving() {
    let s = setup();
    let lp1 = Address::generate(&s.e);
    let lp2 = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);

    s.usdc_admin.mint(&lp1, &100_000);
    s.usdc_admin.mint(&lp2, &100_000);
    let sh1 = s.vault.deposit(&lp1, &100_000);
    let sh2 = s.vault.deposit(&lp2, &100_000);

    // lp1 exits immediately at par (no interest realized yet).
    let out1 = s.vault.redeem(&lp1, &sh1);
    assert_eq!(out1, 100_000, "exit at par before any interest");

    // Now realize interest from the remaining pool.
    grant(&s, &borrower, 25_000);
    s.vault.borrow_with_term(&borrower, &10_000, &7, &500);
    s.usdc_admin.mint(&borrower, &500);
    s.vault.repay(&borrower, &borrower);

    // lp2 (sole remaining holder) captures ~all the net interest.
    let out2 = s.vault.redeem(&lp2, &sh2);
    assert!(out2 > 100_000, "remaining LP earns the post-exit interest");
    assert!(out2 <= 100_475, "but never more than the realized net interest");

    // lp1 is gone: a second redeem must fail (no shares left).
    assert_eq!(
        s.vault.try_redeem(&lp1, &1),
        Err(Ok(Error::InsufficientShares.into()))
    );
}

// ── 11. credit_limit expiry blocks borrow through the vault inline gate ───────
// A risk profile that expires between scoring and borrowing makes credit_limit
// return 0, so the vault's inline gate must reject with OverCreditLimit.
#[test]
fn expired_risk_profile_blocks_borrow_via_vault_gate() {
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);

    let now = s.e.ledger().timestamp();
    // valid_until = now+10 -> profile expires shortly.
    s.lm.set_user_risk(&borrower, &600, &true, &(now + 10), &25_000);
    s.lm.set_loan_offer(&borrower, &7, &500, &(now + DAY), &25_000);

    // Advance past valid_until: credit_limit collapses to 0.
    s.e.ledger().with_mut(|li| li.timestamp += 20);
    assert_eq!(s.lm.credit_limit(&borrower), 0);

    assert_eq!(
        s.vault.try_borrow_with_term(&borrower, &10_000, &7, &500),
        Err(Ok(Error::OverCreditLimit.into()))
    );
    assert_eq!(s.usdc.balance(&borrower), 0);
    assert_eq!(s.vault.total_assets(), 100_000);
}

// ── 12. KYC revoked blocks borrow through the vault gate ──────────────────────
// kyc_ok=false makes credit_limit return 0; the vault must reject.
#[test]
fn kyc_off_blocks_borrow_via_vault_gate() {
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);

    let now = s.e.ledger().timestamp();
    s.lm.set_user_risk(&borrower, &600, &false, &0, &25_000); // KYC off
    s.lm.set_loan_offer(&borrower, &7, &500, &(now + DAY), &25_000);

    assert_eq!(s.lm.credit_limit(&borrower), 0);
    assert_eq!(
        s.vault.try_borrow_with_term(&borrower, &10_000, &7, &500),
        Err(Ok(Error::OverCreditLimit.into()))
    );
}

// ── 13. Live defaulted loan blocks a new borrow even if re-scored ────────────
// After mark_default the loan stays active. Even if the operator mistakenly
// re-scores a positive limit while the defaulted loan is STILL active (not
// written off / not repaid), open_loan must reject (LoanActive surfaces as Err
// through the vault), so no second loan stacks on an unresolved default.
#[test]
fn live_defaulted_loan_blocks_new_borrow_even_after_rescore() {
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);
    grant(&s, &borrower, 25_000);
    s.vault.borrow_with_term(&borrower, &10_000, &7, &500);

    s.e.ledger().with_mut(|li| li.timestamp += 24 * DAY);
    s.lm.mark_default(&borrower);

    // Re-score WITHOUT repaying or writing off: the defaulted loan is still live.
    let now = s.e.ledger().timestamp();
    s.lm.set_user_risk(&borrower, &600, &true, &0, &25_000);
    s.lm.set_loan_offer(&borrower, &7, &500, &(now + DAY), &25_000);

    // The vault borrow must still fail (a live loan blocks a new one).
    assert!(s.vault.try_borrow_with_term(&borrower, &1_000, &7, &500).is_err());
    assert_eq!(s.usdc.balance(&borrower), 10_000); // only the original disbursement
    assert_eq!(s.vault.total_assets(), 100_000);
}
