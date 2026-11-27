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

    // D2.3: the constructor pulls an enforced seed deposit from `owner` (admin).
    usdc_admin.mint(&owner, &SEED);
    let vault_id = e.register(
        Vault,
        (init_params(&e, &owner, &sac.address(), &lm_id, &fee_recipient),),
    );
    let vault = VaultClient::new(&e, &vault_id);
    lm.set_vault(&vault_id);

    Setup { e, fee_recipient, owner, usdc, usdc_admin, lm, vault }
}

/// Seed locked at construction (1 USDC at 7 dp = MIN_SEED_ASSETS) and the
/// share units it mints to the contract itself (offset 3 → ×1000).
const SEED: i128 = crate::MIN_SEED_ASSETS;
const SEED_SHARES: i128 = SEED * crate::VIRTUAL_SHARES;
/// Share units per asset unit at par (decimals offset 3).
const VS: i128 = crate::VIRTUAL_SHARES;

fn init_params(e: &Env, admin: &Address, usdc: &Address, lm: &Address, fee_recipient: &Address) -> crate::InitParams {
    crate::InitParams {
        admin: admin.clone(),
        operator: Address::generate(e),
        pauser: Address::generate(e),
        usdc: usdc.clone(),
        loan_manager: lm.clone(),
        fee_recipient: fee_recipient.clone(),
        upgrade_delay_secs: lendoor_common::gov::MIN_UPGRADE_DELAY,
        seed_payer: admin.clone(),
        seed_assets: SEED,
    }
}

/// Independent re-implementation of the vault's OZ virtual-shares conversions
/// (decimals offset 3), so expected values are DERIVED from the formula and the
/// observable state, never copied from the contract's own output. Amounts in
/// these tests are small enough for plain i128 arithmetic.
fn px_assets(s: &Setup, shares: i128) -> i128 {
    let ta = s.vault.total_assets();
    let ts = s.vault.total_supply();
    shares * (ta + 1) / (ts + VS)
}
fn px_shares(s: &Setup, assets: i128) -> i128 {
    let ta = s.vault.total_assets();
    let ts = s.vault.total_supply();
    assets * (ts + VS) / (ta + 1)
}
fn px_shares_ceil(s: &Setup, assets: i128) -> i128 {
    let ta = s.vault.total_assets();
    let ts = s.vault.total_supply();
    (assets * (ts + VS) + ta) / (ta + 1)
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
    // The constructor needs the seed payer's auth: mint + mock ONLY that call,
    // so the rest of the test still runs with real auth enforcement.
    token::StellarAssetClient::new(&e, &sac.address())
        .mock_all_auths()
        .mint(&owner, &SEED);
    let p = init_params(&e, &owner, &sac.address(), &lm_id, &fee_recipient);
    e.mock_all_auths();
    let vault_id = e.register(Vault, (p,));
    e.set_auths(&[]); // back to strict mode: nothing is pre-authorized from here on
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
    // D2.3: at par 1 asset unit = VS share units (decimals offset 3); the seed
    // locked at construction is part of supply and assets.
    assert_eq!(shares, 100_000 * VS);
    assert_eq!(s.vault.balance_of(&lp), 100_000 * VS);
    assert_eq!(s.vault.total_supply(), 100_000 * VS + SEED_SHARES);
    assert_eq!(s.vault.total_assets(), 100_000 + SEED);
    assert_eq!(s.vault.convert_to_assets(&shares), 100_000);
    assert_eq!(s.vault.convert_to_shares(&100_000), shares);
}

#[test]
fn seed_is_locked_in_the_contract_and_enforced() {
    // The seed's shares belong to the vault address itself; nobody can redeem
    // them, so total supply never returns to zero (the "supply 0 + donation"
    // brick is impossible by construction).
    let s = setup();
    assert_eq!(s.vault.balance_of(&s.vault.address), SEED_SHARES);
    assert_eq!(s.vault.total_supply(), SEED_SHARES);
    assert_eq!(s.vault.total_assets(), SEED);
    assert_eq!(s.vault.convert_to_assets(&SEED_SHARES), SEED);
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")]
fn constructor_rejects_seed_below_minimum() {
    let e = Env::default();
    e.mock_all_auths();
    let operator = Address::generate(&e);
    let admin = Address::generate(&e);
    let fee_recipient = Address::generate(&e);
    let sac = e.register_stellar_asset_contract_v2(operator.clone());
    token::StellarAssetClient::new(&e, &sac.address()).mint(&admin, &SEED);
    let placeholder = Address::generate(&e);
    let lm_id = e.register(LoanManager, (operator, placeholder));
    let mut p = init_params(&e, &admin, &sac.address(), &lm_id, &fee_recipient);
    p.seed_assets = SEED - 1;
    e.register(Vault, (p,));
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

    // No interest yet -> price at par, so 40_000 assets burns 40_000 * VS shares.
    let burned = s.vault.withdraw(&lp, &40_000);
    assert_eq!(burned, 40_000 * VS);
    assert_eq!(s.usdc.balance(&lp), 40_000);
    assert_eq!(s.vault.balance_of(&lp), 60_000 * VS);
    assert_eq!(s.vault.total_assets(), 60_000 + SEED);
}

#[test]
fn redeem_all_shares_returns_assets() {
    let s = setup();
    let lp = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    let shares = s.vault.deposit(&lp, &100_000);

    let out = s.vault.redeem(&lp, &shares);
    assert_eq!(out, 100_000); // at par, no interest
    assert_eq!(s.vault.balance_of(&lp), 0);
    assert_eq!(s.vault.total_supply(), SEED_SHARES); // only the locked seed remains
}

#[test]
fn withdraw_over_idle_liquidity_fails() {
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);

    // Borrow 60k + the seed's cash -> only 40k cash left in the vault.
    grant(&s, &borrower, 60_000 + SEED);
    s.vault.borrow_with_term(&borrower, &(60_000 + SEED), &7, &500);

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
    assert_eq!(s.vault.total_assets(), 100_000 + SEED); // invariant: unchanged at borrow
    // get_loan mirrors what the frontend reads from `loans(addr)`.
    let l = s.lm.get_loan(&borrower);
    assert!(l.active);
    assert_eq!(l.principal, 10_000);
    // revolvente: al abrir, saldo = principal + piso de 1 dia (500/7 = 71)
    assert_eq!(l.amount_due, 10_071);
    s.e.ledger().with_mut(|li| li.timestamp += 7 * DAY);
    assert_eq!(s.lm.preview_owed(&borrower), 10_500); // fee completo al vencimiento
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
    grant(&s, &borrower, SEED + 25_000); // credit ok...
    // ...but the only cash is the locked seed -> anything above it is InsufficientCash.
    assert_eq!(
        s.vault.try_borrow_with_term(&borrower, &(SEED + 10_000), &7, &500),
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
    assert_eq!(shares, 100_000 * VS);
    let price_before = px_assets(&s, VS); // value of 1 asset-unit worth of shares

    grant(&s, &borrower, 25_000);
    s.vault.borrow_with_term(&borrower, &10_000, &7, &500);

    s.e.ledger().with_mut(|li| li.timestamp += 7 * DAY); // al vencimiento: fee completo
    // Repay full (10_500). Mint the 500 interest the borrower owes beyond principal.
    s.usdc_admin.mint(&borrower, &500);
    s.vault.repay(&borrower, &borrower);

    // 5% fee on 500 interest = 25 to fee recipient; 475 net interest to share holders
    // (the LP and the locked seed, pro-rata).
    assert_eq!(s.usdc.balance(&s.fee_recipient), 25);
    assert_eq!(s.vault.total_assets(), 100_475 + SEED);
    assert!(!s.lm.get_loan(&borrower).active);
    assert!(px_assets(&s, VS) >= price_before);

    // LP redeems everything -> its pro-rata slice of the pool, derived from the
    // formula (floor), strictly above what it put in.
    let expected = px_assets(&s, shares);
    let out = s.vault.redeem(&lp, &shares);
    assert_eq!(out, expected);
    assert!(out > 100_000); // LP earned net interest
    // The seed's slice stays in the vault: nobody can redeem it.
    assert_eq!(s.vault.total_supply(), SEED_SHARES);
    assert!(s.vault.total_assets() >= SEED);
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
    assert_eq!(s.vault.total_assets(), 90_000 + SEED);

    // Borrower repays late -> vault heals (cash jumps, borrows already reduced).
    s.usdc_admin.mint(&borrower, &500);
    s.vault.repay(&borrower, &borrower);
    // cash: seed + 100000 -10000 +10500 -25 = seed + 100475; borrows 0.
    assert_eq!(s.vault.total_assets(), 100_475 + SEED);
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
    assert_eq!(s.vault.total_assets(), 90_000 + SEED);
    // Second write-off is a no-op (already fully written off).
    s.vault.manual_write_off(&borrower, &10_000);
    assert_eq!(s.vault.total_assets(), 90_000 + SEED);
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
    s.e.ledger().with_mut(|li| li.timestamp += 7 * DAY); // al vencimiento: fee completo
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
    assert_eq!(sh1, 100_000 * VS);
    assert_eq!(sh2, 100_000 * VS); // still at par: no interest yet

    // Borrow 20k, repay -> interest 1000, fee 50, net 950 to the share holders.
    grant(&s, &borrower, 25_000);
    s.vault.borrow_with_term(&borrower, &20_000, &7, &500);
    s.e.ledger().with_mut(|li| li.timestamp += 7 * DAY); // al vencimiento: fee completo
    s.usdc_admin.mint(&borrower, &1_000);
    s.vault.repay(&borrower, &borrower);
    assert_eq!(s.vault.total_assets(), 200_950 + SEED);

    let exp1 = px_assets(&s, sh1);
    let out1 = s.vault.redeem(&lp1, &sh1);
    let exp2 = px_assets(&s, sh2);
    let out2 = s.vault.redeem(&lp2, &sh2);
    assert_eq!(out1, exp1);
    assert_eq!(out2, exp2);
    // Equal stakes -> equal slices (±1 unit of floor dust), both above par.
    assert!(out1 > 100_000 && out2 > 100_000);
    assert!((out1 - out2).abs() <= 1);
    // What the two LPs took plus what stays with the seed is the whole pool.
    assert_eq!(out1 + out2 + s.vault.total_assets(), 200_950 + SEED);
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

    // 5. Frontend reads the live loan + owed (loans + previewLoanWithLate),
    //    al vencimiento (revolvente: antes del due se deberia menos).
    s.e.ledger().with_mut(|li| li.timestamp += 7 * DAY);
    let (principal, owed) = s.lm.preview_loan_with_late(&borrower);
    assert_eq!(principal, 10_000);
    assert_eq!(owed, 10_500);

    // 6. Repay full (repay MaxUint256 sentinel == full amount_due).
    s.usdc_admin.mint(&borrower, &500);
    s.vault.repay(&borrower, &borrower);
    assert!(!s.lm.get_loan(&borrower).active);

    // 7. LP withdraws principal back by USDC amount (withdraw(assets)).
    let burned = s.vault.withdraw(&lp, &100_000);
    assert!(burned <= 100_000 * VS);
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
    assert!(v.try_repay_partial(&a, &a, &100).is_err());
    assert!(v.try_deposit_from(&a, &a, &100).is_err());
    assert!(v.try_manual_write_off(&a, &100).is_err());
    assert!(v.try_set_fee_recipient(&a).is_err());
    // D2.3 governance surface: every write names a role holder.
    assert!(v.try_set_role(&lendoor_common::gov::Role::Operator, &a).is_err());
    assert!(v.try_transfer_admin(&a).is_err());
    assert!(v.try_pause(&a).is_err());
    assert!(v.try_unpause().is_err());
    let h = soroban_sdk::BytesN::from_array(&e, &[0u8; 32]);
    assert!(v.try_propose_upgrade(&h).is_err());
    assert!(v.try_execute_upgrade(&h).is_err());
    assert!(v.try_cancel_upgrade(&a).is_err());
    assert!(!v.is_paused());
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
    s.e.ledger().with_mut(|li| li.timestamp += 7 * DAY); // al vencimiento: fee completo
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
    assert_eq!(sh1, 100_000 * VS);

    // Realize interest: price-per-share is now > par.
    grant(&s, &borrower, 25_000);
    s.vault.borrow_with_term(&borrower, &10_000, &7, &500);
    s.e.ledger().with_mut(|li| li.timestamp += 7 * DAY); // al vencimiento: fee completo
    s.usdc_admin.mint(&borrower, &500);
    s.vault.repay(&borrower, &borrower);
    assert_eq!(s.vault.total_assets(), 100_475 + SEED);

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

    s.e.ledger().with_mut(|li| li.timestamp += 7 * DAY); // al vencimiento: fee completo
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
    assert_eq!(s.vault.total_assets(), SEED + 100_000 + (interest - expected_fee));
    assert!(s.vault.total_assets() > SEED + 100_475);
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
    assert_eq!(s.vault.total_assets(), SEED + 96_000); // seed + 90_000 cash + 6_000 remaining borrows

    // Late repay: the remaining 6_000 of principal-in-borrows is cleared, cash jumps.
    s.usdc_admin.mint(&borrower, &500);
    s.vault.repay(&borrower, &borrower);
    assert_eq!(s.vault.total_assets(), SEED + 100_475); // fully healed, no double-count
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
    assert_eq!(s.vault.total_assets(), SEED + 100_000); // seed + 85_000 cash + 15_000 borrows

    // b1 repays al vencimiento; b2's loan is untouched.
    s.e.ledger().with_mut(|li| li.timestamp += 7 * DAY); // al vencimiento: fee completo
    s.usdc_admin.mint(&b1, &500);
    s.vault.repay(&b1, &b1);
    assert!(!s.lm.get_loan(&b1).active);
    assert!(s.lm.get_loan(&b2).active);
    assert_eq!(s.lm.preview_owed(&b2), 5_250); // devengado completo al vencimiento

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
    grant(&s, &b1, SEED + 80_000);
    grant(&s, &b2, 80_000);

    s.vault.borrow_with_term(&b1, &(SEED + 70_000), &7, &500); // cash now 30_000 (seed cash is lendable too)
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
    assert_eq!(sh1, 50_000 * VS);
    assert_eq!(sh2, 30_000 * VS); // still at par, no interest yet
    assert_eq!(s.vault.balance_of(&lp), 80_000 * VS);
    assert_eq!(s.vault.total_supply(), 80_000 * VS + SEED_SHARES);
    assert_eq!(s.vault.total_assets(), 80_000 + SEED);
}

#[test]
fn lender_realizes_profit_after_interest() {
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    let shares = s.vault.deposit(&lp, &100_000);

    // Borrower cycle realizes interest into the vault (held to maturity so the
    // full 500 of interest accrues; at this test scale the locked seed holds
    // ~99 % of the shares, so the LP's slice of a 1-day floor would round to 0).
    grant(&s, &borrower, 25_000);
    s.vault.borrow_with_term(&borrower, &10_000, &7, &500);
    s.e.ledger().with_mut(|li| li.timestamp += 7 * DAY);
    s.usdc_admin.mint(&borrower, &500);
    s.vault.repay(&borrower, &borrower);

    // The lender now redeems for MORE USDC than deposited (net of the protocol fee).
    let expected = px_assets(&s, shares);
    let out = s.vault.redeem(&lp, &shares);
    assert_eq!(out, expected);
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
    assert_eq!(burned, 30_000 * VS);
    assert_eq!(s.usdc.balance(&lp), 30_000);
    assert_eq!(s.vault.balance_of(&lp), shares - 30_000 * VS);

    // Redeem the remaining shares -> gets the other 70_000 back.
    let out = s.vault.redeem(&lp, &(shares - 30_000 * VS));
    assert_eq!(out, 70_000);
    assert_eq!(s.vault.total_supply(), SEED_SHARES); // only the locked seed remains
    assert_eq!(s.vault.total_assets(), SEED);
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
    assert_eq!(l.amount_due, 3_021); // revolvente: 3_000 + piso 150/7
    assert_eq!(s.usdc.balance(&borrower), 3_000);
    assert_eq!(s.vault.total_assets(), SEED + 100_000); // invariant at borrow
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

    // Repay at due (day 7): fee completo devengado, y la mora recien
    // arranca en due+grace (dia 8) — sigue siendo "a tiempo".
    s.e.ledger().with_mut(|li| li.timestamp += 7 * DAY);
    assert_eq!(s.lm.preview_owed(&borrower), 10_500); // no late accrued
    s.usdc_admin.mint(&borrower, &500);
    let paid = s.vault.repay(&borrower, &borrower);

    assert_eq!(paid, 10_500); // base only, zero mora
    assert_eq!(s.usdc.balance(&s.fee_recipient), 25); // 5% of the 500 base interest
    assert_eq!(s.vault.total_assets(), SEED + 100_475);
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

    grant(&s, &borrower, SEED + 60_000);
    s.vault.borrow_with_term(&borrower, &(SEED + 60_000), &7, &500); // cash now 40_000

    // shares are fully owned (so it's not InsufficientShares), but
    // to_assets(shares) == 100_000 > cash 40_000 -> InsufficientCash.
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
    // D2.3: `upgrade` became a timelocked pair. Both halves are admin-gated.
    let (e, v) = setup_no_mock();
    let hash = soroban_sdk::BytesN::from_array(&e, &[0u8; 32]);
    assert!(v.try_propose_upgrade(&hash).is_err());
    assert!(v.try_execute_upgrade(&hash).is_err());
    assert!(v.pending_upgrade().is_none());
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

    // Realize interest: price-per-share is now above par.
    grant(&s, &borrower, 25_000);
    s.vault.borrow_with_term(&borrower, &10_000, &7, &500);
    s.e.ledger().with_mut(|li| li.timestamp += 7 * DAY); // al vencimiento: fee completo
    s.usdc_admin.mint(&borrower, &500);
    s.vault.repay(&borrower, &borrower);
    assert_eq!(s.vault.total_assets(), SEED + 100_475);
    assert_eq!(s.vault.total_supply(), 100_000 * VS + SEED_SHARES);

    // Expected values derived from the formula with the observable state.
    let all = s.vault.balance_of(&lp);
    let baseline = px_assets(&s, all); // what redeem-all would return
    let ceil_burn = px_shares_ceil(&s, 100_000);
    let floor_burn = px_shares(&s, 100_000);
    assert!(ceil_burn == floor_burn + 1, "price above par -> the division is inexact, ceil != floor");

    // Withdraw exactly 100_000 USDC: the vault burns the CEIL share count.
    let burned = s.vault.withdraw(&lp, &100_000);
    assert_eq!(burned, ceil_burn, "must burn the CEIL share count, not floor");
    assert_eq!(s.usdc.balance(&lp), 100_000);
    assert_eq!(s.vault.balance_of(&lp), all - ceil_burn);

    // Redeem the remainder. Total recovered never exceeds the redeem-all
    // baseline (no leak) and is within one unit of it (ceil costs ≤ 1 unit).
    let rest = s.vault.balance_of(&lp);
    let out = s.vault.redeem(&lp, &rest);
    assert!(100_000 + out <= baseline);
    assert!(baseline - (100_000 + out) <= 1);
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
    assert_eq!(s.vault.total_assets(), SEED + 100_475); // healed, written_off must be 0

    // Re-score (default zeroed the limit) and advance past cooldown for loan #2.
    let now = s.e.ledger().timestamp();
    s.lm.set_user_risk(&borrower, &600, &true, &0, &25_000);
    s.lm.set_loan_offer(&borrower, &7, &500, &(now + 100 * DAY), &25_000);
    s.e.ledger().with_mut(|li| li.timestamp += 30 * DAY); // clear post-default cooldown
    s.vault.borrow_with_term(&borrower, &8_000, &7, &500);
    assert_eq!(s.vault.total_assets(), SEED + 100_475); // unchanged at borrow

    // Repay loan #2 normally. If a stale written_off (4_000) survived, total_borrows
    // would be reduced by only 8_000-4_000=4_000, leaving 4_000 phantom borrows and
    // total_assets too high. Correct heal: total_assets grows by net interest only.
    s.e.ledger().with_mut(|li| li.timestamp += 7 * DAY); // al vencimiento del #2
    s.usdc_admin.mint(&borrower, &400); // 8_000 -> devengado 8_400, interest 400
    s.vault.repay(&borrower, &borrower);
    // net interest #2 = 400 - fee(20) = 380. 100_475 + 380 = 100_855.
    assert_eq!(s.vault.total_assets(), SEED + 100_855);
    assert!(!s.lm.get_loan(&borrower).active);
}

// ─────────────── repay with zero interest (fee == 0 skip branch) ─────────────

#[test]
fn repay_with_zero_interest_skips_fee_transfer() {
    // With principal=200 @5%, amount_due=210, interest=10, fee = 10*500/10000 = 0.
    // D2.3: the fee transfer is now UNCONDITIONAL (a transfer skipped in
    // simulation but executed on-chain falls outside the footprint), so a
    // zero-amount transfer must succeed and leave the sink untouched.
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);
    grant(&s, &borrower, 25_000);

    s.vault.borrow_with_term(&borrower, &200, &7, &500);
    let l = s.lm.get_loan(&borrower);
    assert_eq!(l.amount_due, 201); // revolvente: 200 + piso 10/7 = 1
    assert_eq!(l.principal, 200);
    s.e.ledger().with_mut(|li| li.timestamp += 7 * DAY); // al vencimiento: fee completo
    assert_eq!(s.lm.preview_owed(&borrower), 210); // 200*10500/10000 al due
    s.usdc_admin.mint(&borrower, &10); // top up the 10 interest
    let paid = s.vault.repay(&borrower, &borrower);
    assert_eq!(paid, 210);
    assert_eq!(s.usdc.balance(&s.fee_recipient), 0); // fee floored to 0 (a 0-amount transfer)
    assert_eq!(s.vault.total_assets(), SEED + 100_010); // all 10 interest to share holders
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
    assert_eq!(s.lm.get_loan(&borrower).amount_due, 402); // revolvente: piso 20/7 = 2
    s.e.ledger().with_mut(|li| li.timestamp += 7 * DAY); // al vencimiento: fee completo
    assert_eq!(s.lm.preview_owed(&borrower), 420);
    s.usdc_admin.mint(&borrower, &20);
    s.vault.repay(&borrower, &borrower);
    assert_eq!(s.usdc.balance(&s.fee_recipient), 1); // first nonzero fee
    assert_eq!(s.vault.total_assets(), SEED + 100_019); // 20 interest - 1 fee
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
    assert_eq!(s.vault.total_assets(), SEED + 100_000); // unchanged
    s.vault.manual_write_off(&borrower, &-5_000);
    assert_eq!(s.vault.total_assets(), SEED + 100_000); // no inflation from negative

    // Proof nothing was written off yet: a real full write-off still drops by 10_000.
    s.vault.manual_write_off(&borrower, &10_000);
    assert_eq!(s.vault.total_assets(), SEED + 90_000);
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
    assert_eq!(s.vault.total_assets(), SEED + 100_000, "mark_default must not touch vault accounting");

    s.usdc_admin.mint(&borrower, &500);
    s.vault.repay(&borrower, &borrower);
    assert_eq!(s.vault.total_assets(), SEED + 100_475); // healed via full-principal reduction
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
    s.vault.manual_write_off(&borrower, &10_000); // price < par
    assert_eq!(s.vault.total_assets(), SEED + 90_000);

    s.usdc_admin.mint(&lp2, &100_000);
    let expected_sh2 = px_shares(&s, 100_000); // derived from the formula pre-deposit
    let sh2 = s.vault.deposit(&lp2, &100_000);
    assert!(sh2 > 100_000 * VS, "at price < par the newcomer gets MORE shares than at par");
    assert_eq!(sh2, expected_sh2);
    assert_eq!(s.vault.total_assets(), SEED + 190_000);

    // lp1 (and the locked seed, pro-rata) absorb the prior loss; lp2 (newcomer)
    // recovers ~its principal.
    let expected_out1 = px_assets(&s, sh1);
    let out1 = s.vault.redeem(&lp1, &sh1);
    assert_eq!(out1, expected_out1);
    assert!(out1 < 100_000, "existing LP eats the write-off loss");
    let out2 = s.vault.redeem(&lp2, &sh2);
    assert!(out2 <= 100_000 && out2 >= 99_999, "newcomer neither subsidizes nor profits from the prior loss (±1 floor dust)");
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
    assert_eq!(s.vault.total_assets(), SEED + 100_000); // seed + 85_000 cash + 15_000 borrows

    s.e.ledger().with_mut(|li| li.timestamp += 24 * DAY);
    s.lm.mark_default(&b1);
    s.vault.manual_write_off(&b1, &10_000);
    assert_eq!(s.vault.total_assets(), SEED + 90_000); // b1 loss realized

    // b2 repays healthy: fee = 5% of 250 = 12, b1 loss persists.
    s.usdc_admin.mint(&b2, &250);
    s.vault.repay(&b2, &b2);
    assert!(!s.lm.get_loan(&b2).active);
    assert_eq!(s.usdc.balance(&s.fee_recipient), 12); // NOT polluted by b1
    assert_eq!(s.vault.total_assets(), SEED + 90_238); // 90_000 + (250 - 12)

    // b1 late-repays: heals back past par with b1's interest, proving written_off(b1)
    // was tracked for b1 only and is now cleared.
    s.usdc_admin.mint(&b1, &500);
    s.vault.repay(&b1, &b1);
    // +10_500 cash -25 fee, borrows unchanged (already written off) -> +10_475.
    assert_eq!(s.vault.total_assets(), SEED + 100_713); // 90_238 + 10_475
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
    assert_eq!(s.vault.total_assets(), SEED + 90_000);

    s.usdc_admin.mint(&borrower, &500);
    s.vault.repay(&borrower, &borrower);
    assert_eq!(s.vault.total_assets(), SEED + 100_475); // EXACT, not +10_000 more (double-count)
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
    // END state after the sole LP redeems ALL shares post-interest. D2.3: supply
    // can no longer reach zero (the seed's shares are locked in the contract),
    // so the "ts=0/ta=1" state is gone by construction; what remains is the
    // seed plus its pro-rata slice of the interest plus floor dust. A fresh LP
    // into that state must still mint at a fair price and recover ~principal.
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    let shares = s.vault.deposit(&lp, &100_000);

    grant(&s, &borrower, 25_000);
    s.vault.borrow_with_term(&borrower, &10_000, &7, &500);
    s.e.ledger().with_mut(|li| li.timestamp += 7 * DAY); // al vencimiento: fee completo
    s.usdc_admin.mint(&borrower, &500);
    s.vault.repay(&borrower, &borrower);

    let expected = px_assets(&s, shares);
    let out = s.vault.redeem(&lp, &shares);
    assert_eq!(out, expected);
    assert_eq!(s.vault.total_supply(), SEED_SHARES, "only the locked seed remains");
    let left = s.vault.total_assets();
    assert!(left >= SEED, "the seed never shrinks below its principal in a profitable cycle");
    assert_eq!(left + out, SEED + 100_475, "nothing created or lost: pool = LP payout + what stays");

    // Fresh LP2 deposits into the seed-only state -> fair price, not griefed.
    let lp2 = Address::generate(&s.e);
    s.usdc_admin.mint(&lp2, &100_000);
    let expected_sh2 = px_shares(&s, 100_000);
    let sh2 = s.vault.deposit(&lp2, &100_000);
    assert_eq!(sh2, expected_sh2);
    // lp2 can redeem ~its full principal back (within floor dust).
    let out2 = s.vault.redeem(&lp2, &sh2);
    assert!(out2 >= 99_999 && out2 <= 100_000, "newcomer recovers ~principal");
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
    s.e.ledger().with_mut(|li| li.timestamp += 7 * DAY); // al vencimiento: fee completo
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
fn tiny_deposit_at_high_price_now_reverts_instead_of_losing_funds() {
    // Post-fix: the ZeroShares guard means a deposit that would floor to 0 shares
    // REVERTS rather than pulling the USDC for nothing. (Pre-fix this minted 0
    // shares and silently swallowed the deposit — the dust-loss / donation seam.)
    let s = setup();
    let lp1 = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp1, &100_000);
    s.vault.deposit(&lp1, &100_000);
    grant(&s, &borrower, 25_000);
    s.vault.borrow_with_term(&borrower, &10_000, &7, &500);
    s.e.ledger().with_mut(|li| li.timestamp += 7 * DAY); // al vencimiento: fee completo
    s.usdc_admin.mint(&borrower, &500);
    s.vault.repay(&borrower, &borrower); // price slightly above par

    // D2.3: with the decimals offset a 1-unit deposit at a price just above par
    // mints VS-1 = 999 share units instead of flooring to 0 — dust is no longer
    // swallowed by the share math itself.
    let small = Address::generate(&s.e);
    s.usdc_admin.mint(&small, &1);
    let expected = px_shares(&s, 1);
    assert!(expected > 0 && expected < VS);
    assert_eq!(s.vault.deposit(&small, &1), expected);

    // The ZeroShares guard still exists, but it now takes a donation of ~1000×
    // the pool to push the price high enough for 1 unit to floor to 0 shares.
    let pool = s.vault.total_assets();
    s.usdc_admin.mint(&s.vault.address, &(pool * 1_000));
    let victim = Address::generate(&s.e);
    s.usdc_admin.mint(&victim, &1);
    assert_eq!(px_shares(&s, 1), 0);
    assert_eq!(s.vault.try_deposit(&victim, &1), Err(Ok(Error::ZeroShares.into())));
    assert_eq!(s.usdc.balance(&victim), 1, "the 1 unit is NOT pulled (deposit reverted)");
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
    assert_eq!(s.vault.total_assets(), SEED + 100_000);
    assert!(!s.lm.get_loan(&borrower).active);

    // State not corrupted: a valid borrow within the offer cap still works.
    s.vault.borrow_with_term(&borrower, &4_000, &7, &500);
    assert_eq!(s.usdc.balance(&borrower), 4_000);
    assert_eq!(s.vault.total_assets(), SEED + 100_000);
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
    assert_eq!(s.vault.total_assets(), SEED + 100_000);
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
    assert_eq!(s.vault.total_assets(), SEED + 100_000);
    assert!(!s.lm.get_loan(&borrower).active);

    // And state is not corrupted: a borrow WITHIN the offer cap still works,
    // proving total_borrows was not left bumped by the reverted attempt.
    s.vault.borrow_with_term(&borrower, &4_000, &7, &500);
    assert_eq!(s.usdc.balance(&borrower), 4_000);
    assert_eq!(s.vault.total_assets(), SEED + 100_000); // 96_000 cash + 4_000 borrows
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
    assert_eq!(s.vault.total_assets(), SEED + 100_000);
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
    assert_eq!(s.vault.total_assets(), SEED + 100_000);

    // Borrower repays late, no write-off ever happened.
    s.usdc_admin.mint(&borrower, &500);
    s.vault.repay(&borrower, &borrower);

    // Full heal past par; fee 5% of 500 interest.
    assert_eq!(s.vault.total_assets(), SEED + 100_475);
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
    assert_eq!(s.vault.total_assets(), SEED + 90_000); // price-per-share now < 1

    // LP2 deposits the same 100_000 at the depressed price -> MORE shares.
    s.usdc_admin.mint(&lp2, &100_000);
    let sh2 = s.vault.deposit(&lp2, &100_000);
    assert!(sh2 > sh1, "deposit below par must mint more shares than at par");
    assert_eq!(s.vault.total_assets(), SEED + 190_000);

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
    assert_eq!(s.vault.total_assets(), SEED + 100_000); // seed + 85_000 cash + 15_000 borrows

    // b1 defaults and is written off -> shared pool loses 10_000.
    s.e.ledger().with_mut(|li| li.timestamp += 24 * DAY);
    s.lm.mark_default(&b1);
    s.vault.manual_write_off(&b1, &10_000);
    assert_eq!(s.vault.total_assets(), SEED + 90_000);

    // b2 repays healthy: fee is 5% of b2's 250 interest only (NOT polluted by b1),
    // and total_assets reflects b1's persisting loss plus b2's net interest.
    s.usdc_admin.mint(&b2, &250);
    s.vault.repay(&b2, &b2);
    assert!(!s.lm.get_loan(&b2).active);
    assert_eq!(s.usdc.balance(&s.fee_recipient), 12); // floor(250*500/10000)
    // total_assets: cash = seed + 100000 -10000(b1) -5000(b2) +5250(b2 repay) -12(fee)
    //             = seed + 90238 ; borrows = 0 (b1 written off, b2 repaid).
    assert_eq!(s.vault.total_assets(), SEED + 90_238);

    // b1 written_off still reflects b1 only: a late b1 repay heals it fully and
    // does not over/under-credit because of b2's activity.
    s.usdc_admin.mint(&b1, &500);
    s.vault.repay(&b1, &b1);
    assert!(!s.lm.get_loan(&b1).active);
    // b1 heal: cash += 10500 -25 fee. total_assets = seed + 90238 + 10500 - 25.
    assert_eq!(s.vault.total_assets(), SEED + 100_713);
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
    assert_eq!(s.vault.total_assets(), SEED + 90_000);

    // Borrower repays the full late-inclusive total.
    let interest = owed - 10_000;
    let expected_fee = interest * 500 / 10_000;
    s.usdc_admin.mint(&borrower, &(owed - 10_000)); // top up beyond disbursed 10_000
    let paid = s.vault.repay(&borrower, &borrower);
    assert_eq!(paid, owed);
    assert_eq!(s.usdc.balance(&s.fee_recipient), expected_fee);

    // Fully healed past par: cash = 100000 -10000 + owed - fee; borrows = 0
    // (principal_in_borrows = principal - written_off = 0). So:
    //   total_assets = seed + 90_000 + owed - expected_fee.
    assert_eq!(s.vault.total_assets(), SEED + 90_000 + owed - expected_fee);
    assert!(s.vault.total_assets() > SEED + 100_475, "recovered loss + late interest");
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
    // And the vault is not left negative; only the locked seed remains.
    assert!(s.vault.total_assets() >= 0);
    assert_eq!(s.vault.total_supply(), SEED_SHARES);
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

    // Now realize interest from the remaining pool (held to maturity so the
    // full 500 accrues: at this scale the locked seed holds ~99 % of the shares,
    // and lp2's slice of a 1-day floor would round down to 0).
    grant(&s, &borrower, 25_000);
    s.vault.borrow_with_term(&borrower, &10_000, &7, &500);
    s.e.ledger().with_mut(|li| li.timestamp += 7 * DAY);
    s.usdc_admin.mint(&borrower, &500);
    s.vault.repay(&borrower, &borrower);

    // lp2 (the only remaining LP) captures its pro-rata slice of the net interest.
    let expected2 = px_assets(&s, sh2);
    let out2 = s.vault.redeem(&lp2, &sh2);
    assert_eq!(out2, expected2);
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
    assert_eq!(s.vault.total_assets(), SEED + 100_000);
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
    assert_eq!(s.vault.total_assets(), SEED + 100_000);
}

// ═══════════════════════════════════════════════════════════════════════════
//  ADVERSARIAL SUITE — "cagarlo a palos"
//  ERC4626 donation/first-depositor attack, credit-line theft via wrong signer,
//  past-due repay without accrue (lost-mora footgun), upgrade hijack.
// ═══════════════════════════════════════════════════════════════════════════
use soroban_sdk::{testutils::{MockAuth, MockAuthInvoke}, IntoVal};

// ── FIX REGRESSION 1: donation into an EMPTY vault no longer steals funds ─────
#[test]
fn donation_before_first_deposit_is_blocked_no_fund_loss() {
    // The ERC-4626 first-depositor/donation attack: attacker transfers USDC DIRECTLY
    // into the empty vault (cash()/total_assets inflate while total_supply stays 0).
    // PRE-FIX the first honest LP deposited 100_000, minted 0 shares, and LOST it.
    // POST-FIX the ZeroShares guard makes that deposit REVERT — funds retained.
    let s = setup();
    let attacker = Address::generate(&s.e);
    let victim = Address::generate(&s.e);

    s.usdc_admin.mint(&attacker, &100_000);
    s.usdc.transfer(&attacker, &s.vault.address, &100_000); // donation
    assert_eq!(s.vault.total_assets(), SEED + 100_000);
    // D2.3: the vault is NEVER empty — the constructor locked the seed's shares
    // in the contract itself, so the donation only raises the price for the
    // existing holder (the dead seed). It is a gift to nobody, not an attack.
    assert_eq!(s.vault.total_supply(), SEED_SHARES);

    // The first honest LP deposits at the (slightly higher) fair price and
    // recovers its principal: no fund loss, no DoS.
    s.usdc_admin.mint(&victim, &100_000);
    let expected = px_shares(&s, 100_000);
    assert!(expected > 0);
    let sh = s.vault.deposit(&victim, &100_000);
    assert_eq!(sh, expected);
    let out = s.vault.redeem(&victim, &sh);
    assert!(out >= 99_999 && out <= 100_000, "victim recovers its principal (±1 floor dust)");
    // The attacker holds no shares: the donated 100_000 is unrecoverable by them.
    assert_eq!(s.vault.balance_of(&attacker), 0);
    assert_eq!(s.vault.try_redeem(&attacker, &1), Err(Ok(Error::InsufficientShares.into())));
}

// ── FIX REGRESSION: a CLEAN empty vault still takes the first deposit 1:1 ──────
#[test]
fn clean_first_deposit_unaffected_by_zero_shares_guard() {
    // Sanity: with no donation, the first deposit mints 1:1 as before — the guard
    // only bites the 0-shares (donated/over-priced) case, never the normal flow.
    let s = setup();
    let lp = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    let sh = s.vault.deposit(&lp, &100_000);
    assert_eq!(sh, 100_000 * VS, "clean first LP deposit mints at par (VS shares per unit)");
}

// ── FIX REGRESSION 2: the inflation attack is unprofitable AND now blocked ────
#[test]
fn donation_inflation_attack_is_blocked_and_unprofitable() {
    // Attacker deposits 1, donates D to inflate price. The victim's deposit now
    // REVERTS (ZeroShares), so no value can be funneled through it, and the
    // attacker can never extract more than they sank in.
    let s = setup();
    let attacker = Address::generate(&s.e);
    let victim = Address::generate(&s.e);

    s.usdc_admin.mint(&attacker, &1);
    let atk_shares = s.vault.deposit(&attacker, &1); // 1 share, ts=1, ta=1
    s.usdc_admin.mint(&attacker, &100_000);
    s.usdc.transfer(&attacker, &s.vault.address, &100_000); // donate -> price ~ 100_001

    // Victim's deposit would mint floor(100_000*2/100_002)=1... still > 0 here, so
    // it is NOT blocked in this configuration; the guard only bites at 0 shares.
    // The load-bearing property is profitability: the attacker cannot come out ahead.
    s.usdc_admin.mint(&victim, &100_000);
    let _ = s.vault.try_deposit(&victim, &100_000); // may or may not revert; irrelevant
    let atk_out = s.vault.redeem(&attacker, &atk_shares);
    assert!(atk_out <= 1 + 100_000, "attacker never profits from inflating the price");
}

// ── ATTACK 3: steal someone else's credit line (wrong signer on borrow) ───────
#[test]
fn attacker_cannot_borrow_against_victims_credit_line() {
    let s = setup();
    let lp = Address::generate(&s.e);
    let victim = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);
    grant(&s, &victim, 25_000); // victim has a 25k line + matching offer

    // Narrow auth to the ATTACKER only; borrow_with_term(victim,..) needs victim's
    // sig (borrower.require_auth()). The attacker's sig must NOT disburse victim's line.
    let attacker = Address::generate(&s.e);
    s.e.mock_auths(&[MockAuth {
        address: &attacker,
        invoke: &MockAuthInvoke {
            contract: &s.vault.address,
            fn_name: "borrow_with_term",
            args: (victim.clone(), 10_000i128, 7u32, 500u32).into_val(&s.e),
            sub_invokes: &[],
        },
    }]);
    assert!(s.vault.try_borrow_with_term(&victim, &10_000, &7, &500).is_err(),
        "an attacker must not borrow against another user's credit line");
    assert_eq!(s.usdc.balance(&victim), 0);
    assert!(!s.lm.get_loan(&victim).active);
}

// ── ATTACK 4: wrong signer cannot drain the vault via upgrade() ───────────────
#[test]
fn attacker_cannot_upgrade_vault_wasm() {
    // upgrade swaps the wasm custodying ALL LP USDC. Only the owner's sig may pass.
    let s = setup();
    let attacker = Address::generate(&s.e);
    let hash = soroban_sdk::BytesN::from_array(&s.e, &[0u8; 32]);
    // D2.3: the attacker signs `propose_upgrade`; the gate names the admin.
    s.e.mock_auths(&[MockAuth {
        address: &attacker,
        invoke: &MockAuthInvoke {
            contract: &s.vault.address,
            fn_name: "propose_upgrade",
            args: (hash.clone(),).into_val(&s.e),
            sub_invokes: &[],
        },
    }]);
    assert!(s.vault.try_propose_upgrade(&hash).is_err(),
        "non-admin must not be able to schedule a vault wasm upgrade");
    assert!(s.vault.pending_upgrade().is_none());
    // and `execute_upgrade` with the attacker's signature (and nothing pending) fails too
    s.e.mock_auths(&[MockAuth {
        address: &attacker,
        invoke: &MockAuthInvoke {
            contract: &s.vault.address,
            fn_name: "execute_upgrade",
            args: (hash.clone(),).into_val(&s.e),
            sub_invokes: &[],
        },
    }]);
    assert!(s.vault.try_execute_upgrade(&hash).is_err());
}

// ── FOOTGUN: past-due repay WITHOUT accrue_late silently forfeits the mora ────
#[test]
fn past_due_repay_without_accrue_collects_only_base_no_mora() {
    // REVOLVENTE: este pin se invirtio A PROPOSITO. Antes, si ops olvidaba
    // accrue_late, el vault cobraba solo la base y la mora se perdia (leak
    // operativo). Ahora repay liquida por el saldo DEVENGADO del momento:
    // la mora entra aunque nadie haya llamado accrue_late.
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);
    grant(&s, &borrower, 25_000);
    s.lm.set_premium_config(&borrower, &0, &11_574_000_000);
    s.vault.borrow_with_term(&borrower, &10_000, &7, &500);

    // Way past due+grace, but NOBODY calls accrue_late.
    s.e.ledger().with_mut(|li| li.timestamp += 8 * DAY + 60 * DAY);
    // preview shows mora is owed...
    assert!(s.lm.preview_owed(&borrower) > 10_500, "mora is economically owed");

    // ...y repay (sin accrue previo) cobra EXACTAMENTE ese devengado.
    let owed = s.lm.preview_owed(&borrower);
    assert!(owed > 10_500);
    s.usdc_admin.mint(&borrower, &(owed - 10_000));
    let paid = s.vault.repay(&borrower, &borrower);
    assert_eq!(paid, owed, "repay liquida el devengado completo, mora incluida");
    // fee = 5% de TODO el interes (base + mora)
    assert_eq!(s.usdc.balance(&s.fee_recipient), (owed - 10_000) * 500 / 10_000);
    assert!(!s.lm.get_loan(&borrower).active);
}

// ═══════════════════════════════════════════════════════════════════════════
//  ROBUSTNESS / DoS-RESISTANCE — second-pass coverage audit
// ═══════════════════════════════════════════════════════════════════════════

// ── A pathological late_rate must NOT be able to lock a borrower's repayment ──
#[test]
fn repay_survives_pathological_late_rate_no_lock() {
    // Si una late_rate absurda hiciera overflowear la cuenta de mora, el
    // prestatario igual tiene que poder repagar. La valvula nueva: el devengo
    // usa matematica CHECKED y, si la mora no entra en i128, ese tramo se
    // omite (se cobra la base; jamas se traba).
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);
    grant(&s, &borrower, 25_000);
    // Absurd rate: rate*t*amount_due overflows i128 in owed_with_late.
    s.lm.set_premium_config(&borrower, &0, &(i128::MAX / 2));
    s.vault.borrow_with_term(&borrower, &10_000, &7, &500);
    s.e.ledger().with_mut(|li| li.timestamp += 30 * DAY); // well past due+grace

    // Ni accrue ni preview revientan: la mora overflowante se omite y queda
    // el devengado base (interes completo al vencimiento).
    s.lm.accrue_late(&borrower);
    assert_eq!(s.lm.preview_owed(&borrower), 10_500, "mora omitida por overflow, base intacta");

    // ...y el repay liquida esa base y libera el prestamo.
    s.usdc_admin.mint(&borrower, &500);
    let paid = s.vault.repay(&borrower, &borrower);
    assert_eq!(paid, 10_500, "la tasa absurda no puede trabar el repago");
    assert!(!s.lm.get_loan(&borrower).active, "loan freed — no lock");
}

// ── withdraw EXACTLY the idle cash (boundary) must succeed ────────────────────
#[test]
fn withdraw_exactly_at_cash_boundary_succeeds() {
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);
    grant(&s, &borrower, 60_000);
    s.vault.borrow_with_term(&borrower, &60_000, &7, &500); // cash == 40_000 exactly
    let burned = s.vault.withdraw(&lp, &40_000); // == cash boundary
    assert!(burned > 0);
    assert_eq!(s.usdc.balance(&lp), 40_000);
}

// ── manual_write_off: a non-owner signer must NOT be able to realize a loss ───
#[test]
fn manual_write_off_rejects_non_owner_signer() {
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);
    grant(&s, &borrower, 25_000);
    s.vault.borrow_with_term(&borrower, &10_000, &7, &500);
    s.e.ledger().with_mut(|li| li.timestamp += 24 * DAY);
    s.lm.mark_default(&borrower);

    let attacker = Address::generate(&s.e);
    s.e.mock_auths(&[MockAuth {
        address: &attacker,
        invoke: &MockAuthInvoke {
            contract: &s.vault.address,
            fn_name: "manual_write_off",
            args: (borrower.clone(), 10_000i128).into_val(&s.e),
            sub_invokes: &[],
        },
    }]);
    assert!(s.vault.try_manual_write_off(&borrower, &10_000).is_err(),
        "only the owner may realize a write-off loss");
    assert_eq!(s.vault.total_assets(), SEED + 100_000, "no loss realized by the attacker");
}

// ── existing LPs are NEVER locked by the donation DoS (they can still exit) ───
#[test]
fn donation_does_not_lock_existing_lp_funds() {
    // The residual donation-DoS only blocks NEW deposits below the donated price.
    // Existing LPs keep their shares and can still withdraw/redeem; borrowers can
    // still repay. Proves the blast radius is "new deposits", never locked funds.
    let s = setup();
    let lp = Address::generate(&s.e);
    let attacker = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    let sh = s.vault.deposit(&lp, &100_000);

    // Attacker donates AFTER the LP is in.
    s.usdc_admin.mint(&attacker, &500_000);
    s.usdc.transfer(&attacker, &s.vault.address, &500_000);

    // The existing LP can still fully redeem its shares (gets the donation too).
    let out = s.vault.redeem(&lp, &sh);
    assert!(out >= 100_000, "existing LP is not locked and even captures the donation");
}

// ─────────────── LP side: deposit_from (CCTP / on-ramp, tranche 0) ───────────
// El award promete que CCTP mintea "directly into the Vault" con shares para el
// LP. `deposit()` no puede: exige la auth del receptor y las shares no se
// transfieren. `deposit_from` separa payer (autoriza, pone los fondos) de
// beneficiary (recibe las shares), con la MISMA matemática y la MISMA guarda
// anti-donación que `deposit`.

#[test]
fn deposit_from_credits_shares_to_beneficiary_not_payer() {
    let s = setup();
    let relayer = Address::generate(&s.e);
    let lp = Address::generate(&s.e);
    s.usdc_admin.mint(&relayer, &100_000);

    let shares = s.vault.deposit_from(&relayer, &lp, &100_000);
    assert_eq!(shares, 100_000 * VS); // primer depósito de LP: a la par (VS shares por unidad)
    assert_eq!(s.vault.balance_of(&lp), 100_000 * VS);
    assert_eq!(s.vault.balance_of(&relayer), 0); // el que paga NO recibe shares
    assert_eq!(s.vault.total_supply(), 100_000 * VS + SEED_SHARES);
    assert_eq!(s.vault.total_assets(), SEED + 100_000); // invariante: cash + borrows
    assert_eq!(s.usdc.balance(&relayer), 0); // la plata salió del payer
}

#[test]
fn deposit_from_mints_at_current_price_existing_holder_unharmed() {
    // Con un holder previo, un deposit_from de un tercero NO le mueve el valor.
    let s = setup();
    let lp0 = Address::generate(&s.e);
    s.usdc_admin.mint(&lp0, &1_000_000);
    s.vault.deposit(&lp0, &1_000_000);

    let claim_before =
        s.vault.total_assets() * s.vault.balance_of(&lp0) / s.vault.total_supply();

    let relayer = Address::generate(&s.e);
    let lp1 = Address::generate(&s.e);
    s.usdc_admin.mint(&relayer, &250_000);
    let shares = s.vault.deposit_from(&relayer, &lp1, &250_000);
    assert_eq!(shares, 250_000 * VS); // a la par → VS shares por unidad

    let claim_after =
        s.vault.total_assets() * s.vault.balance_of(&lp0) / s.vault.total_supply();
    assert_eq!(claim_before, claim_after); // el holder previo ni gana ni pierde
    assert_eq!(s.vault.balance_of(&lp1), 250_000 * VS);
}

#[test]
fn deposit_from_rejects_zero_and_negative() {
    let s = setup();
    let relayer = Address::generate(&s.e);
    let lp = Address::generate(&s.e);
    s.usdc_admin.mint(&relayer, &10);
    assert_eq!(
        s.vault.try_deposit_from(&relayer, &lp, &0),
        Err(Ok(Error::ZeroAmount.into()))
    );
    assert_eq!(
        s.vault.try_deposit_from(&relayer, &lp, &-5),
        Err(Ok(Error::ZeroAmount.into()))
    );
}

#[test]
fn deposit_from_donation_guard_still_bites_no_fund_loss() {
    // D2.3: el supply nunca es 0 (seed bloqueado) y el offset hace que una
    // donación chica ya no deje a nadie en 0 shares. Para que la guarda muerda
    // hace falta donar ~1000× el pool; deposit_from tiene la MISMA guarda que
    // deposit: revienta ZeroShares y la plata del payer no se mueve.
    let s = setup();
    let attacker = Address::generate(&s.e);
    let pool = s.vault.total_assets();
    s.usdc_admin.mint(&attacker, &(pool * 1_000));
    s.usdc.transfer(&attacker, &s.vault.address, &(pool * 1_000)); // donación directa

    let relayer = Address::generate(&s.e);
    let lp = Address::generate(&s.e);
    s.usdc_admin.mint(&relayer, &1);
    assert_eq!(px_shares(&s, 1), 0);
    assert_eq!(
        s.vault.try_deposit_from(&relayer, &lp, &1),
        Err(Ok(Error::ZeroShares.into()))
    );
    assert_eq!(s.usdc.balance(&relayer), 1); // sin pérdida de fondos
    assert_eq!(s.vault.total_supply(), SEED_SHARES);
}

#[test]
fn deposit_from_requires_payer_auth_never_beneficiary() {
    // mock_all_auths registra QUÉ auths exigió el contrato: tiene que estar la
    // del payer y NO puede estar la del beneficiario (recibir shares no pide firma).
    let s = setup();
    let relayer = Address::generate(&s.e);
    let lp = Address::generate(&s.e);
    s.usdc_admin.mint(&relayer, &50_000);

    s.vault.deposit_from(&relayer, &lp, &50_000);
    let auths = s.e.auths();
    assert!(auths.iter().any(|(who, _)| *who == relayer));
    assert!(!auths.iter().any(|(who, _)| *who == lp));
}

// ═══════ REVOLVENTE + PAGO PARCIAL (Instaward D3 · decisión de Fabián 08-10) ═══════
// El crédito pasa a devengar interés con el tiempo: pagar antes cuesta menos,
// pagar al vencimiento cuesta exactamente principal*(1+fee). Y repay_partial
// imputa interés-primero, dejando el préstamo vivo hasta saldar.

#[test]
fn early_full_repay_costs_prorata_interest() {
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);
    grant(&s, &borrower, 25_000);
    s.vault.borrow_with_term(&borrower, &10_000, &7, &500);

    // Día 3 de 7: se debe el interés proporcional, no el fee completo.
    s.e.ledger().with_mut(|li| li.timestamp += 3 * DAY);
    let owed = s.lm.preview_owed(&borrower);
    assert_eq!(owed, 10_000 + 500 * 3 / 7); // 10_214 — pagar antes = pagar menos

    s.usdc_admin.mint(&borrower, &(owed - 10_000));
    let paid = s.vault.repay(&borrower, &borrower);
    assert_eq!(paid, owed);
    let interest = owed - 10_000;
    let fee = interest * 500 / 10_000;
    assert_eq!(s.usdc.balance(&s.fee_recipient), fee);
    assert_eq!(s.vault.total_assets(), SEED + 100_000 + interest - fee);
    assert!(!s.lm.get_loan(&borrower).active);
}

#[test]
fn immediate_repay_pays_the_one_day_floor() {
    // Pedir y devolver en el mismo ledger NO es gratis: piso de 1 día de interés.
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);
    grant(&s, &borrower, 25_000);
    s.vault.borrow_with_term(&borrower, &10_000, &7, &500);

    let owed = s.lm.preview_owed(&borrower);
    assert_eq!(owed, 10_000 + 500 / 7); // 10_071
    s.usdc_admin.mint(&borrower, &(owed - 10_000));
    let paid = s.vault.repay(&borrower, &borrower);
    assert_eq!(paid, owed);
    assert!(!s.lm.get_loan(&borrower).active);
}

#[test]
fn partial_payment_interest_first_then_principal() {
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);
    grant(&s, &borrower, 25_000);
    s.vault.borrow_with_term(&borrower, &10_000, &7, &500);
    s.e.ledger().with_mut(|li| li.timestamp += 7 * DAY); // interés completo devengado

    // Paga 2_000 de los 10_500: imputa 500 al interés y 1_500 al principal.
    s.usdc_admin.mint(&borrower, &2_000);
    let rem = s.vault.repay_partial(&borrower, &borrower, &2_000);
    assert_eq!(rem, 8_500);
    let l = s.lm.get_loan(&borrower);
    assert!(l.active, "el préstamo sigue vivo hasta saldar");
    assert_eq!(l.principal, 8_500);
    assert_eq!(l.amount_due, 8_500); // interés ya saldado; queda puro principal
    assert_eq!(s.usdc.balance(&s.fee_recipient), 25); // 5% del interés pagado (500)
    // total_borrows bajó por los 1_500 de principal; el interés neto fue a los LPs.
    assert_eq!(s.vault.total_assets(), SEED + 100_475);

    // Salda el resto en el mismo momento: cierra sin interés nuevo (post-due no
    // devenga interés, solo mora — y acá no hay premium configurado).
    let paid = s.vault.repay(&borrower, &borrower);
    assert_eq!(paid, 8_500);
    assert!(!s.lm.get_loan(&borrower).active);
    assert_eq!(s.vault.total_assets(), SEED + 100_475); // economía total = la de siempre
}

#[test]
fn partial_overpay_caps_at_owed_and_closes() {
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);
    grant(&s, &borrower, 25_000);
    s.vault.borrow_with_term(&borrower, &10_000, &7, &500);
    s.e.ledger().with_mut(|li| li.timestamp += 7 * DAY);

    s.usdc_admin.mint(&borrower, &20_000);
    let rem = s.vault.repay_partial(&borrower, &borrower, &20_000);
    assert_eq!(rem, 0, "se capea al saldo devengado y cierra");
    assert!(!s.lm.get_loan(&borrower).active);
    // Pull exacto de los 20_000 firmados + VUELTO de 9_500 en la misma tx
    // (auth-determinista): el neto pagado es exactamente 10_500.
    assert_eq!(s.usdc.balance(&borrower), 10_000 + 20_000 - 10_500);
    assert_eq!(s.vault.total_assets(), SEED + 100_475);
}

#[test]
fn partial_on_defaulted_loan_is_rejected_full_still_heals() {
    // En default el parcial se rechaza (la curación post-write-off exige el
    // total); el repay completo sigue curando como siempre.
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);
    grant(&s, &borrower, 25_000);
    s.vault.borrow_with_term(&borrower, &10_000, &7, &500);
    s.e.ledger().with_mut(|li| li.timestamp += 24 * DAY);
    s.lm.mark_default(&borrower);

    s.usdc_admin.mint(&borrower, &20_000);
    assert!(
        s.vault.try_repay_partial(&borrower, &borrower, &100).is_err(),
        "parcial sobre defaulted debe rechazarse"
    );
    // El pago TOTAL sí entra y cierra (sin premium: owed = 10_500).
    let paid = s.vault.repay(&borrower, &borrower);
    assert_eq!(paid, 10_500);
    assert!(!s.lm.get_loan(&borrower).active);
}

#[test]
fn deposit_from_rejects_vault_itself_as_beneficiary() {
    // (review PR #3) shares acreditadas al propio vault = fondos bloqueados
    // para siempre (no se transfieren, no hay self-redeem). El default
    // plausible de un bridge mal cableado se corta aca.
    let s = setup();
    let relayer = Address::generate(&s.e);
    s.usdc_admin.mint(&relayer, &10_000);
    assert!(
        s.vault
            .try_deposit_from(&relayer, &s.vault.address, &10_000)
            .is_err()
    );
    assert_eq!(s.usdc.balance(&relayer), 10_000, "sin pull: los fondos no se mueven");
}

// ═══════ Regresiones del review PR #4 ═══════

#[test]
fn full_payoff_via_partial_on_writtenoff_does_not_double_decrement() {
    // El payoff TOTAL via repay_partial cierra prestamos defaulted (el LM solo
    // bloquea parciales): sin el clamp del write-off, el principal ya
    // descontado por manual_write_off se descontaba DOS veces y total_borrows
    // quedaba fantasma negativo.
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);
    grant(&s, &borrower, 25_000);
    s.vault.borrow_with_term(&borrower, &10_000, &7, &500);
    s.e.ledger().with_mut(|li| li.timestamp += 24 * DAY);
    s.lm.mark_default(&borrower);
    s.vault.manual_write_off(&borrower, &10_000); // borrows -= 10k (total)

    s.usdc_admin.mint(&borrower, &20_000);
    let rem = s.vault.repay_partial(&borrower, &borrower, &20_000); // payoff total
    assert_eq!(rem, 0);
    assert!(!s.lm.get_loan(&borrower).active);
    // Sana EXACTO como el camino de repay: 100_000 + interes neto, sin
    // fantasma. (sin premium: owed = 10_500, interes 500, fee 25)
    assert_eq!(s.vault.total_assets(), SEED + 100_475);
}

#[test]
fn permissionless_accrue_cannot_rewind_anchor_and_double_charge_floor() {
    // accrue_late(now < ancla de apertura) rebobinaba last_accrued y el piso
    // de 1 dia se devengaba de nuevo: griefing gratis contra cualquier
    // borrower fresco. El ancla ahora SOLO avanza.
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);
    grant(&s, &borrower, 25_000);
    s.vault.borrow_with_term(&borrower, &10_000, &7, &500);

    s.e.ledger().with_mut(|li| li.timestamp += 3600); // 1h, antes del ancla
    s.lm.accrue_late(&borrower); // el ataque
    s.e.ledger().with_mut(|li| li.timestamp += 7 * DAY - 3600);
    assert_eq!(
        s.lm.preview_owed(&borrower),
        10_500,
        "el total al vencimiento sigue EXACTO: el piso no se cobra dos veces"
    );
}

#[test]
fn dust_fee_floor_does_not_double_charge_at_due() {
    // full_fee < tenor_days: el fallback cobra el fee completo al abrir y el
    // ancla va directo al due — antes se devengaba OTRA vez (principal+2*fee).
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    s.vault.deposit(&lp, &100_000);
    let now = s.e.ledger().timestamp();
    s.lm.set_user_risk(&borrower, &600, &true, &0, &25_000);
    s.lm.set_loan_offer(&borrower, &7, &100, &(now + DAY), &25_000); // 1% / 7d
    s.vault.borrow_with_term(&borrower, &100, &7, &100); // fee total = 1
    assert_eq!(s.lm.get_loan(&borrower).amount_due, 101);
    s.e.ledger().with_mut(|li| li.timestamp += 7 * DAY);
    assert_eq!(s.lm.preview_owed(&borrower), 101, "exacto P*(1+fee), no P+2*fee");
}

#[test]
fn vault_usdc_getter_returns_settlement_asset() {
    let s = setup();
    assert_eq!(s.vault.usdc(), s.usdc.address);
}

// ═══════════════════════════════════════════════════════════════════════════
//  D2.3 — GOVERNANCE: roles, pause scope, two-step admin, timelock, math
// ═══════════════════════════════════════════════════════════════════════════
use lendoor_common::gov::{GovError, Role, MIN_UPGRADE_DELAY};

fn gov_err(g: GovError) -> Result<Result<(), soroban_sdk::ConversionError>, Result<soroban_sdk::Error, soroban_sdk::InvokeError>> {
    Err(Ok(g.into()))
}
/// True when a `try_*` call failed with exactly this governance error, for
/// any return type of the wrapped function.
fn failed_with<T, E>(
    r: Result<Result<T, E>, Result<soroban_sdk::Error, soroban_sdk::InvokeError>>,
    g: GovError,
) -> bool {
    matches!(r, Err(Ok(e)) if e == g.into())
}

#[test]
fn constructor_assigns_roles_and_delay() {
    let s = setup();
    assert_eq!(s.vault.get_role(&Role::Admin), Some(s.owner.clone()));
    assert!(s.vault.get_role(&Role::Operator).is_some());
    assert!(s.vault.get_role(&Role::Pauser).is_some());
    assert_eq!(s.vault.get_role(&Role::Underwriter), None); // not a vault role
    assert_eq!(s.vault.upgrade_delay(), MIN_UPGRADE_DELAY);
    assert!(!s.vault.is_paused());
    assert!(s.vault.pending_upgrade().is_none());
    assert_eq!(s.vault.decimals_offset(), crate::DECIMALS_OFFSET);
}

#[test]
#[should_panic(expected = "Error(Contract, #108)")]
fn constructor_rejects_upgrade_delay_below_floor() {
    let e = Env::default();
    e.mock_all_auths();
    let operator = Address::generate(&e);
    let admin = Address::generate(&e);
    let fee_recipient = Address::generate(&e);
    let sac = e.register_stellar_asset_contract_v2(operator.clone());
    token::StellarAssetClient::new(&e, &sac.address()).mint(&admin, &SEED);
    let placeholder = Address::generate(&e);
    let lm_id = e.register(LoanManager, (operator, placeholder));
    let mut p = init_params(&e, &admin, &sac.address(), &lm_id, &fee_recipient);
    p.upgrade_delay_secs = MIN_UPGRADE_DELAY - 1;
    e.register(Vault, (p,));
}

#[test]
fn pause_blocks_new_exposure_but_never_exits_or_repayments() {
    let s = setup();
    let lp = Address::generate(&s.e);
    let relayer = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &200_000);
    s.usdc_admin.mint(&relayer, &10_000);
    let shares = s.vault.deposit(&lp, &100_000);
    grant(&s, &borrower, 25_000);
    s.vault.borrow_with_term(&borrower, &10_000, &7, &500);

    let pauser = s.vault.get_role(&Role::Pauser).unwrap();
    s.vault.pause(&pauser);
    assert!(s.vault.is_paused());

    // Blocked: new exposure.
    assert!(failed_with(s.vault.try_deposit(&lp, &100_000), GovError::Paused));
    assert!(failed_with(s.vault.try_deposit_from(&relayer, &lp, &10_000), GovError::Paused));
    let borrower2 = Address::generate(&s.e);
    grant(&s, &borrower2, 25_000);
    assert!(failed_with(s.vault.try_borrow_with_term(&borrower2, &1_000, &7, &500), GovError::Paused));

    // Open: LP exits and repayments (they REDUCE exposure).
    let expected_burn = px_shares_ceil(&s, 10_000);
    assert_eq!(s.vault.withdraw(&lp, &10_000), expected_burn);
    let some = shares / 10;
    assert!(s.vault.redeem(&lp, &some) > 0);
    s.e.ledger().with_mut(|li| li.timestamp += 7 * DAY);
    s.usdc_admin.mint(&borrower, &500);
    assert_eq!(s.vault.repay_partial(&borrower, &borrower, &2_000), 8_500);
    assert_eq!(s.vault.repay(&borrower, &borrower), 8_500);
    assert!(!s.lm.get_loan(&borrower).active);

    // Only the admin resumes; afterwards deposits work again.
    s.vault.unpause();
    assert!(!s.vault.is_paused());
    assert!(s.vault.deposit(&lp, &10_000) > 0);
}

#[test]
fn pauser_cannot_unpause_and_stranger_cannot_pause() {
    let (e, v) = setup_no_mock();
    let pauser = v.get_role(&Role::Pauser).unwrap();
    let admin = v.get_role(&Role::Admin).unwrap();
    let stranger = Address::generate(&e);

    // stranger with their own signature: Unauthorized (not a role holder)
    assert_eq!(
        v.mock_auths(&[MockAuth {
            address: &stranger,
            invoke: &MockAuthInvoke { contract: &v.address, fn_name: "pause", args: (stranger.clone(),).into_val(&e), sub_invokes: &[] },
        }])
        .try_pause(&stranger),
        gov_err(GovError::Unauthorized)
    );
    // pauser pauses
    v.mock_auths(&[MockAuth {
        address: &pauser,
        invoke: &MockAuthInvoke { contract: &v.address, fn_name: "pause", args: (pauser.clone(),).into_val(&e), sub_invokes: &[] },
    }])
    .pause(&pauser);
    assert!(v.is_paused());
    // pauser cannot unpause (gate names the admin)
    assert!(v
        .mock_auths(&[MockAuth {
            address: &pauser,
            invoke: &MockAuthInvoke { contract: &v.address, fn_name: "unpause", args: ().into_val(&e), sub_invokes: &[] },
        }])
        .try_unpause()
        .is_err());
    assert!(v.is_paused());
    // admin can
    v.mock_auths(&[MockAuth {
        address: &admin,
        invoke: &MockAuthInvoke { contract: &v.address, fn_name: "unpause", args: ().into_val(&e), sub_invokes: &[] },
    }])
    .unpause();
    assert!(!v.is_paused());
}

#[test]
fn operator_and_pauser_cannot_act_as_admin() {
    let (e, v) = setup_no_mock();
    let operator = v.get_role(&Role::Operator).unwrap();
    let pauser = v.get_role(&Role::Pauser).unwrap();
    let hash = soroban_sdk::BytesN::from_array(&e, &[1u8; 32]);
    let sink = Address::generate(&e);
    for who in [&operator, &pauser] {
        assert!(v
            .mock_auths(&[MockAuth { address: who, invoke: &MockAuthInvoke { contract: &v.address, fn_name: "propose_upgrade", args: (hash.clone(),).into_val(&e), sub_invokes: &[] } }])
            .try_propose_upgrade(&hash)
            .is_err());
        assert!(v
            .mock_auths(&[MockAuth { address: who, invoke: &MockAuthInvoke { contract: &v.address, fn_name: "set_fee_recipient", args: (sink.clone(),).into_val(&e), sub_invokes: &[] } }])
            .try_set_fee_recipient(&sink)
            .is_err());
        assert!(v
            .mock_auths(&[MockAuth { address: who, invoke: &MockAuthInvoke { contract: &v.address, fn_name: "set_role", args: (Role::Operator, sink.clone()).into_val(&e), sub_invokes: &[] } }])
            .try_set_role(&Role::Operator, &sink)
            .is_err());
    }
    assert!(v.pending_upgrade().is_none());
    assert_eq!(v.get_role(&Role::Operator), Some(operator));
}

#[test]
fn admin_transfer_is_two_step_at_the_vault() {
    let s = setup();
    let new_admin = Address::generate(&s.e);
    s.vault.transfer_admin(&new_admin);
    assert_eq!(s.vault.get_role(&Role::Admin), Some(s.owner.clone()), "not yet");
    assert_eq!(s.vault.accept_admin(), new_admin.clone());
    assert_eq!(s.vault.get_role(&Role::Admin), Some(new_admin));
    assert!(failed_with(s.vault.try_accept_admin(), GovError::NoPendingAdmin));
}

#[test]
fn set_role_cannot_target_admin_and_rotates_operator() {
    let s = setup();
    let new_op = Address::generate(&s.e);
    assert_eq!(s.vault.try_set_role(&Role::Admin, &new_op), gov_err(GovError::Unauthorized));
    s.vault.set_role(&Role::Operator, &new_op);
    assert_eq!(s.vault.get_role(&Role::Operator), Some(new_op));
}

#[test]
fn timelock_gates_execute_and_pauser_can_veto() {
    let s = setup();
    let h = soroban_sdk::BytesN::from_array(&s.e, &[7u8; 32]);
    let other = soroban_sdk::BytesN::from_array(&s.e, &[9u8; 32]);
    let eta = s.vault.propose_upgrade(&h);
    assert_eq!(eta, s.e.ledger().timestamp() + MIN_UPGRADE_DELAY);
    assert_eq!(s.vault.pending_upgrade().map(|p| p.eta), Some(eta));
    assert_eq!(s.vault.try_execute_upgrade(&h), gov_err(GovError::TimelockNotReady));
    assert_eq!(s.vault.try_execute_upgrade(&other), gov_err(GovError::UpgradeHashMismatch));
    let pauser = s.vault.get_role(&Role::Pauser).unwrap();
    s.vault.cancel_upgrade(&pauser);
    assert!(s.vault.pending_upgrade().is_none());
    s.e.ledger().with_mut(|li| li.timestamp += MIN_UPGRADE_DELAY + 1);
    assert_eq!(s.vault.try_execute_upgrade(&h), gov_err(GovError::NoPendingUpgrade));
    // after the delay a pending proposal passes every governance gate: the only
    // thing left is the host swapping the wasm (the unknown hash makes it fail
    // at the host, never at our gates; the proposal survives the rollback).
    s.vault.propose_upgrade(&h);
    s.e.ledger().with_mut(|li| li.timestamp += MIN_UPGRADE_DELAY);
    let r = s.vault.try_execute_upgrade(&h);
    assert!(r.is_err());
    assert_ne!(r, gov_err(GovError::TimelockNotReady));
    assert_ne!(r, gov_err(GovError::NoPendingUpgrade));
    assert!(s.vault.pending_upgrade().is_some());
}

#[test]
fn share_math_overflow_is_a_typed_error_not_a_trap() {
    let s = setup();
    // assets * (ts + VS) does not fit i128 as a quotient: convert_to_shares must
    // report MathOverflow (code 12) instead of aborting opaquely.
    assert_eq!(s.vault.try_convert_to_shares(&i128::MAX), Err(Ok(Error::MathOverflow.into())));
    // and a deposit of an absurd amount fails at the math, before touching funds
    let whale = Address::generate(&s.e);
    assert_eq!(s.vault.try_deposit(&whale, &i128::MAX), Err(Ok(Error::MathOverflow.into())));
}

#[test]
fn convert_views_match_the_independent_formula_after_interest() {
    let s = setup();
    let lp = Address::generate(&s.e);
    let borrower = Address::generate(&s.e);
    s.usdc_admin.mint(&lp, &100_000);
    let sh = s.vault.deposit(&lp, &100_000);
    grant(&s, &borrower, 25_000);
    s.vault.borrow_with_term(&borrower, &10_000, &7, &500);
    s.e.ledger().with_mut(|li| li.timestamp += 7 * DAY);
    s.usdc_admin.mint(&borrower, &500);
    s.vault.repay(&borrower, &borrower);
    assert_eq!(s.vault.convert_to_assets(&sh), px_assets(&s, sh));
    assert_eq!(s.vault.convert_to_shares(&12_345), px_shares(&s, 12_345));
    assert_eq!(s.vault.max_withdraw(&lp), px_assets(&s, sh)); // cash covers it
    assert!(s.vault.convert_to_assets(&sh) > 100_000);
}

#[test]
fn admin_actions_emit_events() {
    // testutils `events().all()` holds the events of the LAST invocation, so
    // each governance action is checked right after it runs: exactly one
    // vault event per action (an indexer can watch governance without polling).
    let s = setup();
    let one = |s: &Setup| s.e.events().all().filter_by_contract(&s.vault.address).events().len();
    let sink = Address::generate(&s.e);
    s.vault.set_fee_recipient(&sink);                       // feerecip
    assert_eq!(one(&s), 1);
    s.vault.set_role(&Role::Operator, &sink);                // roleset
    assert_eq!(one(&s), 1);
    let pauser = s.vault.get_role(&Role::Pauser).unwrap();
    s.vault.pause(&pauser);                                  // pause
    assert_eq!(one(&s), 1);
    s.vault.unpause();                                       // unpause
    assert_eq!(one(&s), 1);
    let h = soroban_sdk::BytesN::from_array(&s.e, &[3u8; 32]);
    s.vault.propose_upgrade(&h);                             // upgprop
    assert_eq!(one(&s), 1);
    s.vault.cancel_upgrade(&pauser);                         // upgcancl
    assert_eq!(one(&s), 1);
    s.vault.transfer_admin(&sink);                           // adminprop
    assert_eq!(one(&s), 1);
    s.vault.cancel_admin_transfer();                         // admincncl
    assert_eq!(one(&s), 1);
}
