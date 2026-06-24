#![no_std]
//! Lendoor Vault — Soroban port of the modified Euler EVault.
//!
//! Holds LP USDC, mints internal shares whose price grows as interest is
//! realized on repay, and exposes the only borrow/repay entry points. The
//! uncollateralized credit check is INLINE (calls `loan_manager.credit_limit`),
//! so there is no separate RiskManager and no EVC: Soroban calls are atomic, so
//! a failing `open_loan` reverts the whole borrow naturally.
//!
//! Accounting (mirrors EVK economics, simplified):
//!   total_assets = cash (USDC balance) + total_borrows (outstanding PRINCIPAL)
//!   - borrow: cash -= principal, total_borrows += principal  (assets unchanged)
//!   - repay:  cash += amount_due, fee skimmed to recipient, total_borrows -=
//!             principal_still_owed  => price-per-share grows by net interest
//!   - write_off (defaulted): total_borrows -= principal  => price-per-share drops
//!   - late repay after write_off: cash jumps, total_borrows unchanged => heals
//!
//! v1 simplification: shares are internal balances (not yet a transferable
//! SEP-41 token). Swap to the OZ vault/token module when LP transferability is
//! needed. The math is the OZ virtual-shares (offset 0) form for basic
//! inflation-attack protection.

use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, panic_with_error,
    symbol_short, token, Address, BytesN, Env,
};

/// Mirror of loan-manager's `Loan` (same SCVal layout for cross-contract reads).
#[contracttype]
#[derive(Clone)]
pub struct Loan {
    pub principal: i128,
    pub amount_due: i128,
    pub start: u64,
    pub due: u64,
    pub fee_bps: u32,
    pub grace_period: u64,
    pub tenor_days: u32,
    pub active: bool,
    pub defaulted: bool,
    pub last_accrued: u64,
}

/// Minimal client for the loan-manager contract (only what the vault calls).
/// Defined locally so we don't pull the loan-manager's exported wasm symbols.
#[contractclient(name = "LoanManagerClient")]
pub trait LoanManager {
    fn credit_limit(e: Env, account: Address) -> i128;
    fn open_loan(e: Env, borrower: Address, principal: i128, tenor_days: u32, fee_bps: u32);
    fn close_loan(e: Env, borrower: Address, paid: i128);
    fn is_defaulted(e: Env, borrower: Address) -> bool;
    fn get_loan(e: Env, borrower: Address) -> Loan;
}

const DAY: u32 = 17280;
const INSTANCE_THRESHOLD: u32 = DAY * 30;
const INSTANCE_BUMP: u32 = INSTANCE_THRESHOLD + DAY;
const USER_THRESHOLD: u32 = DAY * 100;
const USER_BUMP: u32 = USER_THRESHOLD + 20 * DAY;

const BPS_DENOM: i128 = 10_000;
const PROTOCOL_FEE_BPS: i128 = 500; // 5% of the interest portion, full-repay only

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    ZeroAmount = 3,
    InsufficientCash = 4,
    InsufficientShares = 5,
    OverCreditLimit = 6,
    NoActiveLoan = 7,
    NotDefaulted = 8,
}

#[contracttype]
#[derive(Clone)]
pub struct Config {
    pub owner: Address,         // governor (fee recipient / upgrade / params)
    pub usdc: Address,          // underlying asset (SAC of USDC)
    pub loan_manager: Address,  // credit limits + loan lifecycle
    pub fee_recipient: Address, // 5% protocol fee sink
}

#[contracttype]
pub enum DataKey {
    Config,               // instance
    TotalShares,          // instance: i128
    TotalBorrows,         // instance: i128 (outstanding principal)
    Shares(Address),      // persistent: i128 (LP share balance)
    WrittenOff(Address),  // persistent: i128 (principal already written off)
}

fn bump_instance(e: &Env) {
    e.storage().instance().extend_ttl(INSTANCE_THRESHOLD, INSTANCE_BUMP);
}
fn cfg(e: &Env) -> Config {
    e.storage().instance().get(&DataKey::Config).unwrap_or_else(|| panic_with_error!(e, Error::NotInitialized))
}
fn total_shares(e: &Env) -> i128 {
    e.storage().instance().get(&DataKey::TotalShares).unwrap_or(0)
}
fn total_borrows(e: &Env) -> i128 {
    e.storage().instance().get(&DataKey::TotalBorrows).unwrap_or(0)
}
fn set_total_shares(e: &Env, v: i128) {
    e.storage().instance().set(&DataKey::TotalShares, &v);
}
fn set_total_borrows(e: &Env, v: i128) {
    e.storage().instance().set(&DataKey::TotalBorrows, &v);
}
fn shares_of(e: &Env, a: &Address) -> i128 {
    e.storage().persistent().get(&DataKey::Shares(a.clone())).unwrap_or(0)
}
fn set_shares_of(e: &Env, a: &Address, v: i128) {
    let k = DataKey::Shares(a.clone());
    e.storage().persistent().set(&k, &v);
    e.storage().persistent().extend_ttl(&k, USER_THRESHOLD, USER_BUMP);
}
fn written_off(e: &Env, a: &Address) -> i128 {
    e.storage().persistent().get(&DataKey::WrittenOff(a.clone())).unwrap_or(0)
}
fn set_written_off(e: &Env, a: &Address, v: i128) {
    let k = DataKey::WrittenOff(a.clone());
    if v == 0 {
        e.storage().persistent().remove(&k);
    } else {
        e.storage().persistent().set(&k, &v);
        e.storage().persistent().extend_ttl(&k, USER_THRESHOLD, USER_BUMP);
    }
}

fn usdc_client<'a>(e: &Env, c: &Config) -> token::Client<'a> {
    token::Client::new(e, &c.usdc)
}
fn cash(e: &Env, c: &Config) -> i128 {
    usdc_client(e, c).balance(&e.current_contract_address())
}

#[contract]
pub struct Vault;

#[contractimpl]
impl Vault {
    pub fn __constructor(e: Env, owner: Address, usdc: Address, loan_manager: Address, fee_recipient: Address) {
        if e.storage().instance().has(&DataKey::Config) {
            panic_with_error!(&e, Error::AlreadyInitialized);
        }
        e.storage().instance().set(&DataKey::Config, &Config { owner, usdc, loan_manager, fee_recipient });
        e.storage().instance().set(&DataKey::TotalShares, &0i128);
        e.storage().instance().set(&DataKey::TotalBorrows, &0i128);
        bump_instance(&e);
    }

    // ───────── views ─────────
    pub fn total_assets(e: Env) -> i128 {
        let c = cfg(&e);
        cash(&e, &c) + total_borrows(&e)
    }
    /// Share balance of `account` (mirrors the EVM EVault `balanceOf`).
    pub fn balance_of(e: Env, account: Address) -> i128 {
        shares_of(&e, &account)
    }
    /// Total shares outstanding (mirrors the EVM EVault `totalSupply`).
    pub fn total_supply(e: Env) -> i128 {
        total_shares(&e)
    }

    // OZ virtual-shares (offset 0) conversions: floor, multiply-before-divide.
    fn to_shares(e: &Env, c: &Config, assets: i128) -> i128 {
        let ts = total_shares(e);
        let ta = cash(e, c) + total_borrows(e);
        assets * (ts + 1) / (ta + 1)
    }
    fn to_assets(e: &Env, c: &Config, shares: i128) -> i128 {
        let ts = total_shares(e);
        let ta = cash(e, c) + total_borrows(e);
        shares * (ta + 1) / (ts + 1)
    }
    // Shares to BURN for an exact `assets` withdrawal: ceil so the vault never
    // gives out more value than the burned shares represent (ERC-4626 withdraw).
    fn to_shares_ceil(e: &Env, c: &Config, assets: i128) -> i128 {
        let ts = total_shares(e);
        let ta = cash(e, c) + total_borrows(e);
        (assets * (ts + 1) + ta) / (ta + 1) // (num + denom - 1) / denom, denom = ta+1
    }

    // ───────── LP side ─────────
    pub fn deposit(e: Env, from: Address, assets: i128) -> i128 {
        from.require_auth();
        if assets <= 0 {
            panic_with_error!(&e, Error::ZeroAmount);
        }
        let c = cfg(&e);
        let shares = Self::to_shares(&e, &c, assets);
        // Pull USDC into the vault, THEN mint shares (balance now reflects deposit;
        // to_shares was computed pre-transfer, which is the ERC-4626 convention).
        usdc_client(&e, &c).transfer(&from, &e.current_contract_address(), &assets);
        set_shares_of(&e, &from, shares_of(&e, &from) + shares);
        set_total_shares(&e, total_shares(&e) + shares);
        bump_instance(&e);
        e.events().publish((symbol_short!("deposit"), from), (assets, shares));
        shares
    }

    /// ERC-4626 `withdraw`: burn shares to receive an EXACT `assets` amount of
    /// USDC. This is the entry point the frontend uses (`evault.withdraw(amount,
    /// receiver, owner)` — the user types a USDC amount). Returns shares burned.
    pub fn withdraw(e: Env, from: Address, assets: i128) -> i128 {
        from.require_auth();
        if assets <= 0 {
            panic_with_error!(&e, Error::ZeroAmount);
        }
        let c = cfg(&e);
        if assets > cash(&e, &c) {
            panic_with_error!(&e, Error::InsufficientCash); // not enough idle liquidity
        }
        let shares = Self::to_shares_ceil(&e, &c, assets);
        let bal = shares_of(&e, &from);
        if shares > bal {
            panic_with_error!(&e, Error::InsufficientShares);
        }
        set_shares_of(&e, &from, bal - shares);
        set_total_shares(&e, total_shares(&e) - shares);
        usdc_client(&e, &c).transfer(&e.current_contract_address(), &from, &assets);
        bump_instance(&e);
        e.events().publish((symbol_short!("withdraw"), from), (assets, shares));
        shares
    }

    /// ERC-4626 `redeem`: burn an EXACT `shares` amount, receive floor(assets).
    /// Useful for "withdraw everything" (redeem the full share balance).
    pub fn redeem(e: Env, from: Address, shares: i128) -> i128 {
        from.require_auth();
        if shares <= 0 {
            panic_with_error!(&e, Error::ZeroAmount);
        }
        let bal = shares_of(&e, &from);
        if shares > bal {
            panic_with_error!(&e, Error::InsufficientShares);
        }
        let c = cfg(&e);
        let assets = Self::to_assets(&e, &c, shares);
        if assets > cash(&e, &c) {
            panic_with_error!(&e, Error::InsufficientCash); // not enough idle liquidity
        }
        set_shares_of(&e, &from, bal - shares);
        set_total_shares(&e, total_shares(&e) - shares);
        usdc_client(&e, &c).transfer(&e.current_contract_address(), &from, &assets);
        bump_instance(&e);
        e.events().publish((symbol_short!("redeem"), from), (assets, shares));
        assets
    }

    // ───────── borrow / repay ─────────
    /// Only entry point to take a loan. Inline credit check + atomic open_loan.
    pub fn borrow_with_term(e: Env, borrower: Address, amount: i128, tenor_days: u32, fee_bps: u32) -> i128 {
        borrower.require_auth();
        if amount <= 0 {
            panic_with_error!(&e, Error::ZeroAmount);
        }
        let c = cfg(&e);
        let lm = LoanManagerClient::new(&e, &c.loan_manager);

        // Inline uncollateralized check (replaces RiskManagerUncollat).
        if amount > lm.credit_limit(&borrower) {
            panic_with_error!(&e, Error::OverCreditLimit);
        }
        if amount > cash(&e, &c) {
            panic_with_error!(&e, Error::InsufficientCash);
        }

        // Disburse, then register the loan (open_loan re-validates offer/limit;
        // any revert there unwinds this whole call atomically).
        usdc_client(&e, &c).transfer(&e.current_contract_address(), &borrower, &amount);
        set_total_borrows(&e, total_borrows(&e) + amount);
        lm.open_loan(&borrower, &amount, &tenor_days, &fee_bps);
        bump_instance(&e);
        e.events().publish((symbol_short!("borrow"), borrower), (amount, tenor_days, fee_bps));
        amount // assets disbursed (mirrors EVM borrowWithTerm's uint256 return)
    }

    /// Full repayment only (mirrors EVK MustRepayFullAmountDue). `payer` funds
    /// the loan of `borrower`. 5% protocol fee on the interest portion.
    pub fn repay(e: Env, payer: Address, borrower: Address) -> i128 {
        payer.require_auth();
        let c = cfg(&e);
        let lm = LoanManagerClient::new(&e, &c.loan_manager);

        let loan = lm.get_loan(&borrower);
        if !loan.active || loan.amount_due <= 0 {
            panic_with_error!(&e, Error::NoActiveLoan);
        }
        let pay = loan.amount_due;
        let principal = loan.principal;
        let interest = if pay > principal { pay - principal } else { 0 };
        let fee = interest * PROTOCOL_FEE_BPS / BPS_DENOM;

        // Pull full amount from payer; skim protocol fee.
        usdc_client(&e, &c).transfer(&payer, &e.current_contract_address(), &pay);
        if fee > 0 {
            usdc_client(&e, &c).transfer(&e.current_contract_address(), &c.fee_recipient, &fee);
        }

        // Reduce only the principal still counted in total_borrows (post-writeoff aware).
        let wo = written_off(&e, &borrower);
        let principal_in_borrows = if principal > wo { principal - wo } else { 0 };
        set_total_borrows(&e, total_borrows(&e) - principal_in_borrows);
        set_written_off(&e, &borrower, 0);

        lm.close_loan(&borrower, &pay);
        bump_instance(&e);
        e.events().publish((symbol_short!("repay"), borrower), (pay, fee));
        pay // amount repaid (mirrors EVM repay's uint256 return)
    }

    /// Recognize a defaulted loan's loss in vault accounting. Owner-gated.
    /// Requires the loan-manager to have flagged the borrower defaulted.
    pub fn manual_write_off(e: Env, borrower: Address, amount: i128) {
        let c = cfg(&e);
        c.owner.require_auth();
        let lm = LoanManagerClient::new(&e, &c.loan_manager);
        if !lm.is_defaulted(&borrower) {
            panic_with_error!(&e, Error::NotDefaulted);
        }
        let loan = lm.get_loan(&borrower);
        let already = written_off(&e, &borrower);
        let owed_principal = if loan.principal > already { loan.principal - already } else { 0 };
        let amt = if amount < owed_principal { amount } else { owed_principal };
        if amt <= 0 {
            return; // idempotent
        }
        set_total_borrows(&e, total_borrows(&e) - amt);
        set_written_off(&e, &borrower, already + amt);
        bump_instance(&e);
        e.events().publish((symbol_short!("writeoff"), borrower), amt);
    }

    // ───────── governance ─────────
    pub fn set_fee_recipient(e: Env, recipient: Address) {
        let mut c = cfg(&e);
        c.owner.require_auth();
        c.fee_recipient = recipient;
        e.storage().instance().set(&DataKey::Config, &c);
        bump_instance(&e);
    }

    pub fn upgrade(e: Env, new_wasm_hash: BytesN<32>) {
        cfg(&e).owner.require_auth();
        e.deployer().update_current_contract_wasm(new_wasm_hash);
    }
}

mod test;
