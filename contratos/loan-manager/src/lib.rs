#![no_std]
//! Lendoor Loan Manager (Credit Limit Manager) — Soroban port of `LoanManagerV3`.
//!
//! Source of truth for *who can borrow*, *how much*, *under what terms*, and
//! *when they default*. It sits between Lendoor's off-chain ML risk model (which
//! writes credit limits via `set_user_risk`) and the on-chain `vault` (which
//! calls `open_loan` / `close_loan` to register loan state changes).
//!
//! Differences vs the EVM version, by design:
//!   - No proxy: Soroban contracts upgrade in place (`upgrade`, admin-gated).
//!   - No `RiskManagerUncollat` contract: the `owed <= credit_limit` check lives
//!     inline in the vault's borrow path (Soroban calls are atomic, no EVC).
//!   - `msg.sender` -> explicit `Address` + `require_auth()`.
//!   - State lives in typed persistent/instance storage with explicit TTL bumps.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, Address,
    BytesN, Env,
};

// ───────────────────────── TTL (state archival) ─────────────────────────
// Stellar archives persistent/instance entries when their TTL hits 0; we bump
// on every touch (Blend's pattern). ~17280 ledgers/day at 5s/ledger.
const DAY: u32 = 17280;
const INSTANCE_THRESHOLD: u32 = DAY * 30;
const INSTANCE_BUMP: u32 = INSTANCE_THRESHOLD + DAY;
const USER_THRESHOLD: u32 = DAY * 100;
const USER_BUMP: u32 = USER_THRESHOLD + 20 * DAY;

const SECONDS_PER_DAY: u64 = 86_400;
const WAD: i128 = 1_000_000_000_000_000_000; // 1e18, late-rate fixed-point base
const BPS_DENOM: i128 = 10_000;

// ───────────────────────────── Errors ───────────────────────────────────
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    NotAuthorized = 3,
    ZeroAddress = 4,
    ZeroPrincipal = 5,
    Cooldown = 6,
    LoanActive = 7,
    OverCreditLimit = 8,
    NoOffer = 9,
    OfferExpired = 10,
    BadTenor = 11,
    BadFee = 12,
    OverOffer = 13,
    NoActiveLoan = 14,
    AlreadyDefaulted = 15,
    TooEarlyToDefault = 16,
    Underpaid = 17,
    InvalidParam = 18,
}

// ───────────────────────────── Types ────────────────────────────────────
/// Per-user risk profile written by the off-chain model. `limit` is in the
/// asset's smallest unit (USDC = 6 decimals: 1_000_000 = $1).
#[contracttype]
#[derive(Clone)]
pub struct UserRisk {
    pub score: u32,
    pub kyc_ok: bool,
    pub valid_until: u64, // 0 = no expiry
    pub last_update: u64,
    pub limit: i128,
}

/// One-shot loan offer. Created by `set_loan_offer`, consumed by `open_loan`.
#[contracttype]
#[derive(Clone)]
pub struct LoanOffer {
    pub tenor_days: u32,
    pub fee_bps: u32,
    pub valid_until: u64,
    pub max_amount: i128,
}

/// The single active (or most-recently-closed) loan per user.
#[contracttype]
#[derive(Clone)]
pub struct Loan {
    pub principal: i128,
    pub amount_due: i128,
    pub start: u64,
    pub due: u64,
    pub fee_bps: u32,
    pub grace_period: u64, // snapshotted at open
    pub tenor_days: u32,
    pub active: bool,
    pub defaulted: bool,
    pub last_accrued: u64,
}

/// Per-user premium / late-fee config. `late_rate_per_sec_wad` is used;
/// `premium_rate_per_sec_wad` is reserved (inert), kept for forward-compat.
#[contracttype]
#[derive(Clone)]
pub struct PremiumConfig {
    pub premium_rate_per_sec_wad: i128,
    pub late_rate_per_sec_wad: i128,
}

/// Global config (instance storage).
#[contracttype]
#[derive(Clone)]
pub struct Config {
    pub vault: Address,
    pub default_grace_period: u64, // seconds
    pub default_late_period: u64,  // seconds
}

// ─────────────────────────── Storage keys ───────────────────────────────
#[contracttype]
pub enum DataKey {
    Owner,             // instance: Address (operator = Lendoor backend signer)
    Config,            // instance: Config
    MinHold(u32),      // instance: u64 seconds, keyed by tenor_days
    Risk(Address),     // persistent: UserRisk
    Offer(Address),    // persistent: LoanOffer
    Loan(Address),     // persistent: Loan
    Premium(Address),  // persistent: PremiumConfig
    NextBorrow(Address), // persistent: u64 (earliest next-borrow ts)
}

// ─────────────────────────── Storage helpers ────────────────────────────
fn bump_instance(e: &Env) {
    e.storage().instance().extend_ttl(INSTANCE_THRESHOLD, INSTANCE_BUMP);
}

fn read_owner(e: &Env) -> Address {
    e.storage()
        .instance()
        .get(&DataKey::Owner)
        .unwrap_or_else(|| panic_with_error!(e, Error::NotInitialized))
}

fn read_config(e: &Env) -> Config {
    e.storage()
        .instance()
        .get(&DataKey::Config)
        .unwrap_or_else(|| panic_with_error!(e, Error::NotInitialized))
}

fn read_risk(e: &Env, a: &Address) -> Option<UserRisk> {
    let k = DataKey::Risk(a.clone());
    let v: Option<UserRisk> = e.storage().persistent().get(&k);
    if v.is_some() {
        e.storage().persistent().extend_ttl(&k, USER_THRESHOLD, USER_BUMP);
    }
    v
}

fn read_loan(e: &Env, a: &Address) -> Loan {
    let k = DataKey::Loan(a.clone());
    if let Some(l) = e.storage().persistent().get::<DataKey, Loan>(&k) {
        e.storage().persistent().extend_ttl(&k, USER_THRESHOLD, USER_BUMP);
        l
    } else {
        Loan { principal: 0, amount_due: 0, start: 0, due: 0, fee_bps: 0, grace_period: 0, tenor_days: 0, active: false, defaulted: false, last_accrued: 0 }
    }
}

fn write_loan(e: &Env, a: &Address, l: &Loan) {
    let k = DataKey::Loan(a.clone());
    e.storage().persistent().set(&k, l);
    e.storage().persistent().extend_ttl(&k, USER_THRESHOLD, USER_BUMP);
}

fn read_premium(e: &Env, a: &Address) -> PremiumConfig {
    let k = DataKey::Premium(a.clone());
    if let Some(p) = e.storage().persistent().get::<DataKey, PremiumConfig>(&k) {
        e.storage().persistent().extend_ttl(&k, USER_THRESHOLD, USER_BUMP);
        p
    } else {
        PremiumConfig { premium_rate_per_sec_wad: 0, late_rate_per_sec_wad: 0 }
    }
}

fn read_next_borrow(e: &Env, a: &Address) -> u64 {
    let k = DataKey::NextBorrow(a.clone());
    e.storage().persistent().get(&k).unwrap_or(0)
}

fn write_next_borrow(e: &Env, a: &Address, ts: u64) {
    let k = DataKey::NextBorrow(a.clone());
    e.storage().persistent().set(&k, &ts);
    e.storage().persistent().extend_ttl(&k, USER_THRESHOLD, USER_BUMP);
}

fn min_hold_secs(e: &Env, tenor_days: u32) -> u64 {
    e.storage().instance().get(&DataKey::MinHold(tenor_days)).unwrap_or(0u64)
}

// ───────────────────────────── Contract ─────────────────────────────────
#[contract]
pub struct LoanManager;

#[contractimpl]
impl LoanManager {
    /// One-time constructor. `owner` = operator (Lendoor backend signer);
    /// `vault` = the only contract allowed to call open_loan/close_loan.
    pub fn __constructor(e: Env, owner: Address, vault: Address) {
        if e.storage().instance().has(&DataKey::Owner) {
            panic_with_error!(&e, Error::AlreadyInitialized);
        }
        e.storage().instance().set(&DataKey::Owner, &owner);
        e.storage().instance().set(
            &DataKey::Config,
            &Config { vault, default_grace_period: SECONDS_PER_DAY, default_late_period: 15 * SECONDS_PER_DAY },
        );
        // Default min-hold per tenor (days), mirrors V3: {3->4,7->4,14->7,21->7,30->7}.
        e.storage().instance().set(&DataKey::MinHold(3), &(4 * SECONDS_PER_DAY));
        e.storage().instance().set(&DataKey::MinHold(7), &(4 * SECONDS_PER_DAY));
        e.storage().instance().set(&DataKey::MinHold(14), &(7 * SECONDS_PER_DAY));
        e.storage().instance().set(&DataKey::MinHold(21), &(7 * SECONDS_PER_DAY));
        e.storage().instance().set(&DataKey::MinHold(30), &(7 * SECONDS_PER_DAY));
        bump_instance(&e);
    }

    // ───────── admin (operator) ─────────
    pub fn set_owner(e: Env, new_owner: Address) {
        read_owner(&e).require_auth();
        e.storage().instance().set(&DataKey::Owner, &new_owner);
        bump_instance(&e);
        e.events().publish((symbol_short!("ownerset"),), new_owner);
    }

    pub fn set_vault(e: Env, vault: Address) {
        read_owner(&e).require_auth();
        let mut c = read_config(&e);
        c.vault = vault.clone();
        e.storage().instance().set(&DataKey::Config, &c);
        bump_instance(&e);
        e.events().publish((symbol_short!("vaultset"),), vault);
    }

    pub fn set_default_grace_period(e: Env, secs: u64) {
        read_owner(&e).require_auth();
        let mut c = read_config(&e);
        c.default_grace_period = secs;
        e.storage().instance().set(&DataKey::Config, &c);
        bump_instance(&e);
    }

    pub fn set_min_hold_for_tenor(e: Env, tenor_days: u32, min_hold_days: u32) {
        read_owner(&e).require_auth();
        e.storage()
            .instance()
            .set(&DataKey::MinHold(tenor_days), &(min_hold_days as u64 * SECONDS_PER_DAY));
        bump_instance(&e);
    }

    /// Upgrade the contract Wasm (Soroban-native, replaces UUPS). Owner-gated.
    pub fn upgrade(e: Env, new_wasm_hash: BytesN<32>) {
        read_owner(&e).require_auth();
        e.deployer().update_current_contract_wasm(new_wasm_hash);
    }

    // ───────── risk profile ─────────
    /// Write the off-chain model's verdict for a user.
    pub fn set_user_risk(e: Env, account: Address, score: u32, kyc_ok: bool, valid_until: u64, limit: i128) {
        read_owner(&e).require_auth();
        if limit < 0 {
            panic_with_error!(&e, Error::InvalidParam);
        }
        let k = DataKey::Risk(account.clone());
        e.storage().persistent().set(
            &k,
            &UserRisk { score, kyc_ok, valid_until, last_update: e.ledger().timestamp(), limit },
        );
        e.storage().persistent().extend_ttl(&k, USER_THRESHOLD, USER_BUMP);
        e.events().publish((symbol_short!("riskset"), account), limit);
    }

    /// Raw stored risk profile (mirrors the EVM `users(addr)` getter the
    /// frontend's `useCreditLine` polls for score / KYC / limit). Returns a
    /// zeroed profile if the user was never scored.
    pub fn get_user_risk(e: Env, account: Address) -> UserRisk {
        read_risk(&e, &account)
            .unwrap_or(UserRisk { score: 0, kyc_ok: false, valid_until: 0, last_update: 0, limit: 0 })
    }

    /// Earliest timestamp at which `account` may open a new loan (cooldown).
    /// Mirrors the EVM `nextBorrowTime(addr)` read.
    pub fn next_borrow_time(e: Env, account: Address) -> u64 {
        read_next_borrow(&e, &account)
    }

    /// Effective credit limit, factoring KYC + expiry. This is what the vault
    /// reads to gate borrowing (replaces RiskManagerUncollat's collateral hook).
    pub fn credit_limit(e: Env, account: Address) -> i128 {
        match read_risk(&e, &account) {
            None => 0,
            Some(u) => {
                if !u.kyc_ok {
                    return 0;
                }
                if u.valid_until != 0 && e.ledger().timestamp() > u.valid_until {
                    return 0;
                }
                u.limit
            }
        }
    }

    // ───────── offers ─────────
    pub fn set_loan_offer(e: Env, borrower: Address, tenor_days: u32, fee_bps: u32, valid_until: u64, max_amount: i128) {
        read_owner(&e).require_auth();
        if tenor_days == 0 || fee_bps == 0 || max_amount <= 0 {
            panic_with_error!(&e, Error::InvalidParam);
        }
        if valid_until <= e.ledger().timestamp() {
            panic_with_error!(&e, Error::OfferExpired);
        }
        let k = DataKey::Offer(borrower.clone());
        e.storage().persistent().set(&k, &LoanOffer { tenor_days, fee_bps, valid_until, max_amount });
        e.storage().persistent().extend_ttl(&k, USER_THRESHOLD, USER_BUMP);
        e.events().publish((symbol_short!("offerset"), borrower), (tenor_days, fee_bps, max_amount));
    }

    // ───────── loan lifecycle (vault-only) ─────────
    /// Register a fixed-term loan. Called by the vault inside borrow_with_term,
    /// AFTER it has pushed assets to the borrower. A revert here reverts the
    /// whole borrow (atomic).
    pub fn open_loan(e: Env, borrower: Address, principal: i128, tenor_days: u32, fee_bps: u32) {
        let cfg = read_config(&e);
        cfg.vault.require_auth(); // only the registered vault
        if principal <= 0 {
            panic_with_error!(&e, Error::ZeroPrincipal);
        }

        let now = e.ledger().timestamp();
        let allowed_since = read_next_borrow(&e, &borrower);
        if allowed_since != 0 && now < allowed_since {
            panic_with_error!(&e, Error::Cooldown);
        }

        let mut l = read_loan(&e, &borrower);
        if l.active {
            panic_with_error!(&e, Error::LoanActive);
        }

        if principal > Self::credit_limit(e.clone(), borrower.clone()) {
            panic_with_error!(&e, Error::OverCreditLimit);
        }

        let offer_key = DataKey::Offer(borrower.clone());
        let o: LoanOffer = e
            .storage()
            .persistent()
            .get(&offer_key)
            .unwrap_or_else(|| panic_with_error!(&e, Error::NoOffer));
        if now > o.valid_until {
            panic_with_error!(&e, Error::OfferExpired);
        }
        if tenor_days != o.tenor_days {
            panic_with_error!(&e, Error::BadTenor);
        }
        if fee_bps != o.fee_bps {
            panic_with_error!(&e, Error::BadFee);
        }
        if principal > o.max_amount {
            panic_with_error!(&e, Error::OverOffer);
        }

        // One-shot: consume the offer atomically.
        e.storage().persistent().remove(&offer_key);

        let amount_due = principal * (BPS_DENOM + fee_bps as i128) / BPS_DENOM;
        l = Loan {
            principal,
            amount_due,
            start: now,
            due: now + tenor_days as u64 * SECONDS_PER_DAY,
            fee_bps,
            grace_period: cfg.default_grace_period,
            tenor_days,
            active: true,
            defaulted: false,
            last_accrued: now,
        };
        write_loan(&e, &borrower, &l);
        e.events().publish((symbol_short!("loanopen"), borrower), (principal, amount_due, l.due));
    }

    /// Close the borrower's active loan after repayment. Vault-only. `paid`
    /// must be >= amount_due (with accrued late fees).
    pub fn close_loan(e: Env, borrower: Address, paid: i128) {
        read_config(&e).vault.require_auth();
        let mut l = read_loan(&e, &borrower);
        if !l.active {
            panic_with_error!(&e, Error::NoActiveLoan);
        }
        if paid < l.amount_due {
            panic_with_error!(&e, Error::Underpaid);
        }

        let now = e.ledger().timestamp();
        let min_from_start = l.start + min_hold_secs(&e, l.tenor_days);
        let wait_until = if now >= min_from_start { now } else { min_from_start };
        write_next_borrow(&e, &borrower, wait_until);

        // Zero the loan (matches V3 closeLoan; historical default fact lives in events).
        l = Loan { principal: 0, amount_due: 0, start: 0, due: 0, fee_bps: 0, grace_period: 0, tenor_days: 0, active: false, defaulted: false, last_accrued: 0 };
        write_loan(&e, &borrower, &l);
        e.events().publish((symbol_short!("loanclos"), borrower), paid);
    }

    /// Mark a loan defaulted (admin flag). Does NOT touch vault accounting — the
    /// vault's `manual_write_off` does that (and checks is_defaulted first).
    pub fn mark_default(e: Env, borrower: Address) {
        read_owner(&e).require_auth();
        let mut l = read_loan(&e, &borrower);
        if !l.active {
            panic_with_error!(&e, Error::NoActiveLoan);
        }
        if l.defaulted {
            panic_with_error!(&e, Error::AlreadyDefaulted);
        }
        let cfg = read_config(&e);
        let limit_ts = l.due + l.grace_period + cfg.default_late_period;
        if e.ledger().timestamp() <= limit_ts {
            panic_with_error!(&e, Error::TooEarlyToDefault);
        }

        l.defaulted = true;
        write_loan(&e, &borrower, &l);

        // Zero the limit and apply a 30-day extra cooldown.
        if let Some(mut r) = read_risk(&e, &borrower) {
            r.limit = 0;
            let k = DataKey::Risk(borrower.clone());
            e.storage().persistent().set(&k, &r);
            e.storage().persistent().extend_ttl(&k, USER_THRESHOLD, USER_BUMP);
        }
        write_next_borrow(&e, &borrower, e.ledger().timestamp() + 30 * SECONDS_PER_DAY);
        e.events().publish((symbol_short!("default"), borrower), e.ledger().timestamp());
    }

    pub fn is_defaulted(e: Env, borrower: Address) -> bool {
        read_loan(&e, &borrower).defaulted
    }

    pub fn get_loan(e: Env, borrower: Address) -> Loan {
        read_loan(&e, &borrower)
    }

    // ───────── late fees ─────────
    pub fn set_premium_config(e: Env, borrower: Address, premium_rate_per_sec_wad: i128, late_rate_per_sec_wad: i128) {
        read_owner(&e).require_auth();
        if premium_rate_per_sec_wad < 0 || late_rate_per_sec_wad < 0 {
            panic_with_error!(&e, Error::InvalidParam);
        }
        let k = DataKey::Premium(borrower.clone());
        e.storage().persistent().set(&k, &PremiumConfig { premium_rate_per_sec_wad, late_rate_per_sec_wad });
        e.storage().persistent().extend_ttl(&k, USER_THRESHOLD, USER_BUMP);
        e.events().publish((symbol_short!("premium"), borrower), late_rate_per_sec_wad);
    }

    /// Per-user premium / late-fee config (mirrors the EVM `premiums(addr)`
    /// read the frontend uses to drive the live late-fee ticker).
    pub fn get_premium(e: Env, account: Address) -> PremiumConfig {
        read_premium(&e, &account)
    }

    /// View: amount_due if a repay happened now, including unaccrued late fees.
    pub fn preview_owed(e: Env, borrower: Address) -> i128 {
        let l = read_loan(&e, &borrower);
        let p = read_premium(&e, &borrower);
        Self::owed_with_late(&e, &l, &p)
    }

    /// `(principal, amount_due_with_late)` — mirrors the EVM
    /// `previewLoanWithLate(addr)` tuple the frontend reads for repay UX.
    pub fn preview_loan_with_late(e: Env, borrower: Address) -> (i128, i128) {
        let l = read_loan(&e, &borrower);
        let p = read_premium(&e, &borrower);
        (l.principal, Self::owed_with_late(&e, &l, &p))
    }

    /// Materialize accrued late fees into the stored amount_due. Idempotent.
    /// Permissionless on purpose (no attack surface, fixes the V3 keeper leak).
    pub fn accrue_late(e: Env, borrower: Address) {
        let mut l = read_loan(&e, &borrower);
        if !l.active {
            return;
        }
        let p = read_premium(&e, &borrower);
        let now = e.ledger().timestamp();
        let new_due = Self::owed_with_late(&e, &l, &p);
        l.amount_due = new_due;
        l.last_accrued = now;
        write_loan(&e, &borrower, &l);
    }

    // Linear late-fee accrual from max(last_accrued, due+grace). Pure helper.
    fn owed_with_late(e: &Env, l: &Loan, p: &PremiumConfig) -> i128 {
        if !l.active || p.late_rate_per_sec_wad == 0 {
            return l.amount_due;
        }
        let now = e.ledger().timestamp();
        let from = if l.last_accrued == 0 { l.start } else { l.last_accrued };
        let late_start = l.due + l.grace_period;
        let accrual_from = if from > late_start { from } else { late_start };
        if now <= accrual_from {
            return l.amount_due;
        }
        let t_late = (now - accrual_from) as i128;
        let extra = p.late_rate_per_sec_wad * t_late * l.amount_due / WAD;
        l.amount_due + extra
    }
}

mod test;
