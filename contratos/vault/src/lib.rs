#![no_std]
#![allow(deprecated)] // events().publish: same topic/data shape the indexer already parses; #[contractevent] migration is a separate task
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
//! needed.
//!
//! SCF #45 Tranche 2 (D2.3, custody hardening):
//!   - OZ virtual-shares math with a REAL decimals offset (`DECIMALS_OFFSET` =
//!     3 → 1 USDC unit = 1_000 share units at par) plus an ENFORCED seed
//!     deposit in the constructor whose shares belong to the contract itself
//!     (dead by construction). Together they make the donation / inflation
//!     attack ≥ 1000× more expensive and remove the "supply 0 + donation"
//!     bricked state that killed an earlier testnet pair.
//!   - Every multiply-then-divide goes through `lendoor_common::math` (I256,
//!     no intermediate overflow, typed `MathOverflow` instead of a bare trap).
//!   - Roles (admin / operator / pauser), two-step admin transfer, emergency
//!     pause and a timelocked upgrade come from `lendoor_common::gov`. Pause
//!     blocks NEW exposure (deposit, deposit_from, borrow); it never blocks LP
//!     exits (withdraw, redeem) nor repayments.
//!   - Protocol fees accrue inside the vault (`FeesAccrued`, excluded from
//!     `total_assets`) and are pulled with `claim_fees`: repayments never
//!     transfer to the fee recipient, so neither a footprint miss nor a broken
//!     trustline can block them.

use lendoor_common::gov::{self, GovError, PendingUpgrade, Role};
use lendoor_common::math::{bps_of, mul_div_ceil, mul_div_floor};
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
    fn preview_owed(e: Env, borrower: Address) -> i128;
    fn apply_payment(e: Env, borrower: Address, paid: i128) -> (i128, i128, i128);
}

const DAY: u32 = 17280;
const INSTANCE_THRESHOLD: u32 = DAY * 30;
const INSTANCE_BUMP: u32 = INSTANCE_THRESHOLD + DAY;
const USER_THRESHOLD: u32 = DAY * 100;
const USER_BUMP: u32 = USER_THRESHOLD + 20 * DAY;

const PROTOCOL_FEE_BPS: i128 = 500; // 5% of the interest portion

/// OZ virtual-shares decimals offset: shares carry 3 more decimals than the
/// asset, i.e. `VIRTUAL_SHARES` share units per asset unit at par.
pub const DECIMALS_OFFSET: u32 = 3;
pub const VIRTUAL_SHARES: i128 = 1_000;
/// Minimum seed the deployer must lock at construction (1 USDC at 7 dp).
pub const MIN_SEED_ASSETS: i128 = 10_000_000;

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
    ZeroShares = 9,
    InvalidBeneficiary = 10,
    SeedTooSmall = 11,
    MathOverflow = 12,
    // D2.2 strategy
    NoStrategy = 13,
    StrategyNotEmpty = 14,
    StrategyAssetMismatch = 15,
    StrategyShort = 16,
    BadBuffer = 17,
    NoPendingStrategy = 18,
    StrategyNotReady = 19,
    StrategyCallFailed = 20,
    StrategyDisabled = 21,
    StrategyProposalExpired = 22,
}

#[contracttype]
#[derive(Clone)]
pub struct Config {
    pub usdc: Address,          // underlying asset (SAC of USDC)
    pub loan_manager: Address,  // credit limits + loan lifecycle
    pub fee_recipient: Address, // 5% protocol fee sink
}

/// Constructor parameters (one struct so the deploy script stays readable and
/// stellar-cli can take them as JSON).
#[contracttype]
#[derive(Clone)]
pub struct InitParams {
    pub admin: Address,           // governance (multisig account): roles, fees, timelocked upgrade
    pub operator: Address,        // liquidity operations (D2.2 rebalance / sync)
    pub pauser: Address,          // can pause (not unpause) and veto upgrades
    pub usdc: Address,
    pub loan_manager: Address,
    pub fee_recipient: Address,
    pub upgrade_delay_secs: u64,  // >= gov::MIN_UPGRADE_DELAY
    pub seed_payer: Address,      // pays the seed deposit (signs the deploy)
    pub seed_assets: i128,        // >= MIN_SEED_ASSETS; shares stay in the contract forever
}

#[contracttype]
pub enum DataKey {
    Config,               // instance
    TotalShares,          // instance: i128
    TotalBorrows,         // instance: i128 (outstanding principal)
    Shares(Address),      // persistent: i128 (LP share balance)
    WrittenOff(Address),  // persistent: i128 (principal already written off)
    // D2.2
    Strategy,             // instance: Address (DeFindex vault), absent = none
    StrategyPos,          // instance: StrategyPos (cached position)
    Buffer,               // instance: BufferCfg
    PendingStrategy,      // instance: PendingStrategy (timelocked change)
    FeesAccrued,          // instance: i128 (protocol fees waiting to be claimed; NOT LP assets)
}

pub(crate) fn bump_instance(e: &Env) {
    e.storage().instance().extend_ttl(INSTANCE_THRESHOLD, INSTANCE_BUMP);
}
pub(crate) fn cfg(e: &Env) -> Config {
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

pub(crate) fn usdc_client<'a>(e: &Env, c: &Config) -> token::Client<'a> {
    token::Client::new(e, &c.usdc)
}
pub(crate) fn cash(e: &Env, c: &Config) -> i128 {
    usdc_client(e, c).balance(&e.current_contract_address())
}
pub(crate) fn fees_accrued(e: &Env) -> i128 {
    e.storage().instance().get(&DataKey::FeesAccrued).unwrap_or(0)
}
fn set_fees_accrued(e: &Env, v: i128) {
    e.storage().instance().set(&DataKey::FeesAccrued, &v);
}
/// Idle USDC that belongs to LPs: the token balance minus the protocol fees
/// waiting to be claimed. Every liquidity check uses this, never `cash`.
pub(crate) fn available_cash(e: &Env, c: &Config) -> i128 {
    cash(e, c) - fees_accrued(e)
}
/// Single source of truth for the asset side of the share price:
/// LP cash + outstanding principal + the CACHED DeFindex position (D2.2).
/// Accrued protocol fees sit in the same token balance but are excluded.
fn total_assets_internal(e: &Env, c: &Config) -> i128 {
    available_cash(e, c) + total_borrows(e) + strategy::strategy_assets(e)
}
pub(crate) fn or_overflow(e: &Env, v: Option<i128>) -> i128 {
    match v {
        Some(x) => x,
        None => panic_with_error!(e, Error::MathOverflow),
    }
}

#[contract]
pub struct Vault;

#[contractimpl]
impl Vault {
    /// One-time constructor. Locks a seed deposit paid by `seed_payer` whose
    /// shares belong to the contract address itself: nobody can ever redeem
    /// them, so total supply never returns to zero.
    pub fn __constructor(e: Env, p: InitParams) {
        if e.storage().instance().has(&DataKey::Config) {
            panic_with_error!(&e, Error::AlreadyInitialized);
        }
        if p.seed_assets < MIN_SEED_ASSETS {
            panic_with_error!(&e, Error::SeedTooSmall);
        }
        gov::init(&e, &p.admin, p.upgrade_delay_secs);
        e.storage().instance().set(&gov::GovKey::Role(Role::Operator), &p.operator);
        e.storage().instance().set(&gov::GovKey::Role(Role::Pauser), &p.pauser);

        let c = Config { usdc: p.usdc, loan_manager: p.loan_manager, fee_recipient: p.fee_recipient };
        e.storage().instance().set(&DataKey::Config, &c);
        e.storage().instance().set(&DataKey::TotalShares, &0i128);
        e.storage().instance().set(&DataKey::TotalBorrows, &0i128);

        // Seed: pull first, then mint at the (empty-vault) price = VIRTUAL_SHARES
        // per asset unit, to the contract itself.
        p.seed_payer.require_auth();
        usdc_client(&e, &c).transfer(&p.seed_payer, &e.current_contract_address(), &p.seed_assets);
        let seed_shares = or_overflow(&e, p.seed_assets.checked_mul(VIRTUAL_SHARES));
        let me = e.current_contract_address();
        set_shares_of(&e, &me, seed_shares);
        set_total_shares(&e, seed_shares);
        bump_instance(&e);
        e.events().publish((symbol_short!("seeded"), p.seed_payer), (p.seed_assets, seed_shares));
    }

    // ───────── views ─────────
    pub fn total_assets(e: Env) -> i128 {
        let c = cfg(&e);
        total_assets_internal(&e, &c)
    }
    /// Share balance of `account` (mirrors the EVM EVault `balanceOf`).
    pub fn balance_of(e: Env, account: Address) -> i128 {
        shares_of(&e, &account)
    }
    /// Total shares outstanding (mirrors the EVM EVault `totalSupply`).
    pub fn total_supply(e: Env) -> i128 {
        total_shares(&e)
    }
    /// Settlement asset (review PR #4: el script de deploy verificaba contra
    /// un getter inexistente y el fallo se tragaba en silencio — ahora existe).
    pub fn usdc(e: Env) -> Address {
        cfg(&e).usdc
    }
    /// ERC-4626 `convertToAssets`: value of `shares` at the current price.
    pub fn convert_to_assets(e: Env, shares: i128) -> i128 {
        let c = cfg(&e);
        Self::to_assets(&e, &c, shares)
    }
    /// ERC-4626 `convertToShares`: shares minted today for `assets`.
    pub fn convert_to_shares(e: Env, assets: i128) -> i128 {
        let c = cfg(&e);
        Self::to_shares(&e, &c, assets)
    }
    /// ERC-4626 `maxWithdraw`: what `account` can take out right now
    /// (its position, capped by the liquidity a withdraw can reach: idle LP
    /// cash plus the cached strategy position net of the slippage floor, which
    /// `withdraw` pulls on demand).
    pub fn max_withdraw(e: Env, account: Address) -> i128 {
        let c = cfg(&e);
        let pos = Self::to_assets(&e, &c, shares_of(&e, &account));
        let b = strategy::buffer(&e);
        let strat_net = or_overflow(&e, bps_of(&e, strategy::strategy_assets(&e), b.min_out_bps as i128));
        let reachable = available_cash(&e, &c) + strat_net;
        if pos < reachable { pos } else { reachable }
    }
    /// Protocol fees accrued and not yet claimed (excluded from `total_assets`).
    pub fn fees_accrued(e: Env) -> i128 {
        fees_accrued(&e)
    }
    /// Pull pattern for protocol fees (review A3): anyone can trigger it, the
    /// money only ever goes to `fee_recipient`. Repayments never depend on the
    /// recipient's trustline any more.
    pub fn claim_fees(e: Env) -> i128 {
        let c = cfg(&e);
        let amt = fees_accrued(&e);
        if amt <= 0 {
            return 0;
        }
        set_fees_accrued(&e, 0);
        usdc_client(&e, &c).transfer(&e.current_contract_address(), &c.fee_recipient, &amt);
        bump_instance(&e);
        e.events().publish((symbol_short!("feeclaim"), c.fee_recipient), amt);
        amt
    }
    pub fn decimals_offset(_e: Env) -> u32 {
        DECIMALS_OFFSET
    }
    pub fn get_role(e: Env, role: Role) -> Option<Address> {
        gov::role(&e, role)
    }
    pub fn is_paused(e: Env) -> bool {
        gov::is_paused(&e)
    }
    pub fn pending_upgrade(e: Env) -> Option<PendingUpgrade> {
        gov::pending_upgrade(&e)
    }
    pub fn upgrade_delay(e: Env) -> u64 {
        gov::upgrade_delay(&e)
    }

    // OZ virtual-shares conversions (offset = DECIMALS_OFFSET): floor,
    // multiply-before-divide, in I256 so the product can never overflow.
    fn to_shares(e: &Env, c: &Config, assets: i128) -> i128 {
        let ts = total_shares(e);
        let ta = total_assets_internal(e, c);
        or_overflow(e, mul_div_floor(e, assets, ts + VIRTUAL_SHARES, ta + 1))
    }
    fn to_assets(e: &Env, c: &Config, shares: i128) -> i128 {
        let ts = total_shares(e);
        let ta = total_assets_internal(e, c);
        or_overflow(e, mul_div_floor(e, shares, ta + 1, ts + VIRTUAL_SHARES))
    }
    // Shares to BURN for an exact `assets` withdrawal: ceil so the vault never
    // gives out more value than the burned shares represent (ERC-4626 withdraw).
    fn to_shares_ceil(e: &Env, c: &Config, assets: i128) -> i128 {
        let ts = total_shares(e);
        let ta = total_assets_internal(e, c);
        or_overflow(e, mul_div_ceil(e, assets, ts + VIRTUAL_SHARES, ta + 1))
    }

    // ───────── LP side ─────────
    pub fn deposit(e: Env, from: Address, assets: i128) -> i128 {
        from.require_auth();
        gov::require_not_paused(&e);
        if assets <= 0 {
            panic_with_error!(&e, Error::ZeroAmount);
        }
        let c = cfg(&e);
        strategy::soft_sync(&e); // price in any yield accrued since the last sync
        let shares = Self::to_shares(&e, &c, assets);
        // Inflation / first-depositor guard: never pull funds in exchange for 0
        // shares. With the decimals offset + the locked seed this can only trip
        // on dust after an extreme donation; kept as defense in depth.
        if shares <= 0 {
            panic_with_error!(&e, Error::ZeroShares);
        }
        // Pull USDC into the vault, THEN mint shares (balance now reflects deposit;
        // to_shares was computed pre-transfer, which is the ERC-4626 convention).
        usdc_client(&e, &c).transfer(&from, &e.current_contract_address(), &assets);
        set_shares_of(&e, &from, shares_of(&e, &from) + shares);
        set_total_shares(&e, total_shares(&e) + shares);
        bump_instance(&e);
        e.events().publish((symbol_short!("deposit"), from), (assets, shares));
        shares
    }

    /// CCTP / on-ramp entry: `payer` funds the deposit, `beneficiary` receives
    /// the shares. The award architecture (docs/ARCHITECTURE.md §2.1) promises
    /// CCTP minting "directly into the Vault" with LP share accounting —
    /// `deposit()` cannot express that: it requires the share recipient's own
    /// auth and shares are not transferable, so a bridge could only donate
    /// (inflating PPS) or split the flow in two transactions. Here the ONLY
    /// auth is the payer's (their funds move); receiving shares needs no
    /// consent, same as receiving a token transfer. Mirrors `deposit` exactly —
    /// same conversion, same ZeroShares/donation guard — so it adds no new
    /// PPS-inflation surface: shares are always minted at the current price
    /// against assets actually pulled in.
    pub fn deposit_from(e: Env, payer: Address, beneficiary: Address, assets: i128) -> i128 {
        payer.require_auth();
        gov::require_not_paused(&e);
        if assets <= 0 {
            panic_with_error!(&e, Error::ZeroAmount);
        }
        // (review PR #3) un beneficiary == el propio vault bloquearia los
        // fondos PARA SIEMPRE: las shares no se transfieren y el vault no
        // puede redimirse a si mismo. Es el default plausible de un bridge
        // mal cableado (recipient → beneficiary), asi que se rechaza aca.
        if beneficiary == e.current_contract_address() {
            // error PROPIO (review PR #4): ZeroShares aca mandaba al operador
            // a debuggear la guarda anti-donacion en vez del bridge mal cableado.
            panic_with_error!(&e, Error::InvalidBeneficiary);
        }
        let c = cfg(&e);
        strategy::soft_sync(&e);
        let shares = Self::to_shares(&e, &c, assets);
        if shares <= 0 {
            panic_with_error!(&e, Error::ZeroShares);
        }
        usdc_client(&e, &c).transfer(&payer, &e.current_contract_address(), &assets);
        set_shares_of(&e, &beneficiary, shares_of(&e, &beneficiary) + shares);
        set_total_shares(&e, total_shares(&e) + shares);
        bump_instance(&e);
        // (review PR #3) DOBLE evento a proposito: 'deposit' con la misma
        // forma que el deposito de LP — para que todo indexer/monitor
        // suscripto al topic 'deposit' vea tambien los inflows del bridge —
        // mas 'dep_from' con el detalle payer/beneficiary para el camino CCTP.
        e.events().publish(
            (symbol_short!("deposit"), beneficiary.clone()),
            (assets, shares),
        );
        e.events().publish(
            (symbol_short!("dep_from"), payer, beneficiary),
            (assets, shares),
        );
        shares
    }

    /// ERC-4626 `withdraw`: burn shares to receive an EXACT `assets` amount of
    /// USDC. This is the entry point the frontend uses (`evault.withdraw(amount,
    /// receiver, owner)` — the user types a USDC amount). Returns shares burned.
    /// Never blocked by pause: an LP exit is not new exposure.
    pub fn withdraw(e: Env, from: Address, assets: i128) -> i128 {
        from.require_auth();
        if assets <= 0 {
            panic_with_error!(&e, Error::ZeroAmount);
        }
        let c = cfg(&e);
        strategy::soft_sync(&e);
        strategy::ensure_cash(&e, &c, assets); // D2.2: pull from the strategy on demand
        if assets > available_cash(&e, &c) {
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
    /// Never blocked by pause.
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
        strategy::soft_sync(&e);
        let wanted = Self::to_assets(&e, &c, shares);
        strategy::ensure_cash(&e, &c, wanted); // D2.2: pull from the strategy on demand
        // (review B6) re-price AFTER the pull: a tolerated haircut on the way out
        // is shared by everyone, the redeemer included, exactly like `withdraw`.
        let assets = Self::to_assets(&e, &c, shares);
        if assets > available_cash(&e, &c) {
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
    /// Blocked by pause (new exposure).
    pub fn borrow_with_term(e: Env, borrower: Address, amount: i128, tenor_days: u32, fee_bps: u32) -> i128 {
        borrower.require_auth();
        gov::require_not_paused(&e);
        if amount <= 0 {
            panic_with_error!(&e, Error::ZeroAmount);
        }
        let c = cfg(&e);
        let lm = LoanManagerClient::new(&e, &c.loan_manager);

        // Inline uncollateralized check (replaces RiskManagerUncollat).
        if amount > lm.credit_limit(&borrower) {
            panic_with_error!(&e, Error::OverCreditLimit);
        }
        strategy::ensure_cash(&e, &c, amount); // D2.2: the loan is served from the strategy if idle is short
        if amount > available_cash(&e, &c) {
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
    /// Never blocked by pause (repaying reduces exposure).
    pub fn repay(e: Env, payer: Address, borrower: Address) -> i128 {
        payer.require_auth();
        let c = cfg(&e);
        let lm = LoanManagerClient::new(&e, &c.loan_manager);

        let loan = lm.get_loan(&borrower);
        if !loan.active {
            panic_with_error!(&e, Error::NoActiveLoan);
        }
        // Saldo DEVENGADO al momento: pagar temprano cuesta menos (pro-rata),
        // pagar tarde incluye la mora. Es la vista que el frontend ya usa.
        let pay = lm.preview_owed(&borrower);
        if pay <= 0 {
            panic_with_error!(&e, Error::NoActiveLoan);
        }
        let principal = loan.principal;

        // Pull full amount from payer; apply via the LM (interest-first).
        usdc_client(&e, &c).transfer(&payer, &e.current_contract_address(), &pay);
        let (_principal_paid, interest_paid, _rem) = lm.apply_payment(&borrower, &pay);
        let fee = or_overflow(&e, bps_of(&e, interest_paid, PROTOCOL_FEE_BPS));
        // (review A3) fees ACCRUE in the vault and are pulled with `claim_fees`:
        // no per-repay transfer, so neither the footprint nor the recipient's
        // trustline can ever block a repayment.
        set_fees_accrued(&e, fees_accrued(&e) + fee);

        // Reduce only the principal still counted in total_borrows (post-writeoff aware).
        let wo = written_off(&e, &borrower);
        let principal_in_borrows = if principal > wo { principal - wo } else { 0 };
        set_total_borrows(&e, total_borrows(&e) - principal_in_borrows);
        set_written_off(&e, &borrower, 0);

        bump_instance(&e);
        e.events().publish((symbol_short!("repay"), borrower), (pay, fee));
        pay // amount repaid (mirrors EVM repay's uint256 return)
    }

    /// Pago PARCIAL (revolvente): `amount` se imputa primero al interes/mora
    /// devengado y despues al principal; el prestamo sigue activo hasta saldar.
    /// Si `amount` cubre el saldo devengado completo, cierra — y ESTE es el
    /// camino correcto para saldar en vivo (preview + colchon): `repay` sin
    /// monto recalcula el saldo al ejecutar y en la red real eso rompe la
    /// autorizacion firmada (el saldo crece por segundo).
    /// Prestamos en default quedan excluidos (el LM lo rechaza): su curacion
    /// post-write-off exige el pago total por el camino de `repay`.
    /// Never blocked by pause.
    pub fn repay_partial(e: Env, payer: Address, borrower: Address, amount: i128) -> i128 {
        payer.require_auth();
        if amount <= 0 {
            panic_with_error!(&e, Error::ZeroAmount);
        }
        let c = cfg(&e);
        let lm = LoanManagerClient::new(&e, &c.loan_manager);
        let loan = lm.get_loan(&borrower);
        if !loan.active {
            panic_with_error!(&e, Error::NoActiveLoan);
        }
        // AUTH-DETERMINISTA (lección de la testnet real): el sobre firmado
        // autoriza el transfer con un monto EXACTO, y el saldo revolvente
        // crece por segundo — si el contrato recalculara cuánto tirar, lo
        // firmado en la simulación ya no calza al ejecutar (auth
        // invalid_action). Por eso acá se tira EXACTO lo que el pagador firmó
        // y el excedente sobre el saldo vivo se DEVUELVE en la misma
        // transacción. Para saldar: mandar el preview + un colchón.
        usdc_client(&e, &c).transfer(&payer, &e.current_contract_address(), &amount);
        let owed = lm.preview_owed(&borrower);
        let pay = if amount < owed { amount } else { owed };
        let refund = amount - pay;
        if refund > 0 {
            usdc_client(&e, &c).transfer(&e.current_contract_address(), &payer, &refund);
        }
        let (principal_paid, interest_paid, remaining) = lm.apply_payment(&borrower, &pay);
        let fee = or_overflow(&e, bps_of(&e, interest_paid, PROTOCOL_FEE_BPS));
        set_fees_accrued(&e, fees_accrued(&e) + fee); // (review A3) pull pattern, see `claim_fees`
        // (review PR #4) el clamp del write-off es UNIVERSAL: un payoff TOTAL
        // por este camino cierra prestamos defaulted (el LM solo bloquea los
        // parciales), y sin el clamp el principal ya descontado por
        // manual_write_off se descontaba DOS veces — total_borrows fantasma
        // negativo y el PPS de todos los LPs al piso.
        let wo = written_off(&e, &borrower);
        let principal_in_borrows = if principal_paid > wo { principal_paid - wo } else { 0 };
        if principal_in_borrows > 0 {
            set_total_borrows(&e, total_borrows(&e) - principal_in_borrows);
        }
        if remaining == 0 {
            set_written_off(&e, &borrower, 0);
            // (review PR #4) el cierre por este camino tambien emite 'repay':
            // es EL camino de liquidacion en vivo, y los indexers suscriptos a
            // ese topic no pueden perderse justamente los cierres reales.
            e.events().publish((symbol_short!("repay"), borrower.clone()), (pay, fee));
        }
        bump_instance(&e);
        e.events().publish((symbol_short!("partrepay"), borrower), (pay, fee, remaining));
        remaining
    }

    /// Recognize a defaulted loan's loss in vault accounting. Admin-gated.
    /// Requires the loan-manager to have flagged the borrower defaulted.
    pub fn manual_write_off(e: Env, borrower: Address, amount: i128) {
        gov::require_role(&e, Role::Admin);
        let c = cfg(&e);
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

    // ───────── governance (roles, pause, timelocked upgrade) ─────────
    pub fn set_fee_recipient(e: Env, recipient: Address) {
        gov::require_role(&e, Role::Admin);
        let mut c = cfg(&e);
        c.fee_recipient = recipient.clone();
        e.storage().instance().set(&DataKey::Config, &c);
        bump_instance(&e);
        e.events().publish((symbol_short!("feerecip"),), recipient);
    }
    /// Admin: assign `operator` or `pauser`. `admin` moves only via the
    /// two-step transfer below.
    pub fn set_role(e: Env, role: Role, account: Address) {
        gov::set_role(&e, role, &account);
        bump_instance(&e);
    }
    pub fn transfer_admin(e: Env, new_admin: Address) {
        gov::transfer_admin(&e, &new_admin);
    }
    pub fn accept_admin(e: Env) -> Address {
        gov::accept_admin(&e)
    }
    pub fn cancel_admin_transfer(e: Env) {
        gov::cancel_admin_transfer(&e);
    }
    /// `caller` must be the admin or the pauser.
    pub fn pause(e: Env, caller: Address) {
        gov::pause(&e, &caller);
    }
    /// Admin only.
    pub fn unpause(e: Env) {
        gov::unpause(&e);
    }
    /// Admin: schedule a wasm upgrade; executable after `upgrade_delay`.
    pub fn propose_upgrade(e: Env, new_wasm_hash: BytesN<32>) -> u64 {
        gov::propose_upgrade(&e, &new_wasm_hash)
    }
    /// Admin, after the delay, same hash as proposed.
    pub fn execute_upgrade(e: Env, new_wasm_hash: BytesN<32>) {
        gov::execute_upgrade(&e, &new_wasm_hash);
    }
    /// Admin or pauser (veto).
    pub fn cancel_upgrade(e: Env, caller: Address) {
        gov::cancel_upgrade(&e, &caller);
    }
}

// Re-exported so clients can match governance errors without importing the
// common crate (codes 101–110).
pub type GovernanceError = GovError;

mod strategy;
pub use strategy::{BufferCfg, DfAssetStrategySet, DfStrategy, PendingStrategy, StrategyPos};

#[cfg(test)]
mod test_mocks;
mod test;
