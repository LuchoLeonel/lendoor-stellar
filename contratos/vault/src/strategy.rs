//! D2.2 — DeFindex idle-buffer routing (SCF #45 Tranche 2).
//!
//! The vault keeps a small idle buffer and routes the excess into a DeFindex
//! vault ("the strategy") in fixed tranches; it pulls tranches back when a
//! withdrawal, redemption or borrow needs more cash than is idle.
//!
//! Accounting (fee-vault-v2 pattern): the DeFindex position is a CACHED value,
//!   total_assets = cash + total_borrows + strategy_assets
//! where `strategy_assets` only changes in `sync_strategy`, `rebalance`, the
//! on-demand pull and `emergency_unwind`. User operations never read DeFindex
//! for pricing (`get_asset_amounts_per_shares` is a WRITE on their side: it
//! locks fees), and they keep working if DeFindex is down: LP operations do a
//! best-effort "soft sync" first (so nobody can sandwich a stale price), and
//! fall back to the cache on failure.
//!
//! Every DeFindex interaction MEASURES balance deltas instead of trusting the
//! amounts DeFindex reports (its `withdraw` returns the requested amount, not
//! the delivered one), and the share mint for an LP deposit is computed from
//! the measured state.
//!
//! Authorization (verified on testnet, spike 0.2): DeFindex's own
//! `from.require_auth()` is satisfied because this contract is the direct
//! invoker; the token `transfer(from = this vault)` that DeFindex performs one
//! frame deeper is pre-authorized with `authorize_as_current_contract` for
//! exactly that frame.
//!
//! The strategy address itself is governed: it changes only through the same
//! timelock as upgrades and only while the position is empty.

use lendoor_common::gov::{self, Role};
use lendoor_common::math::{bps_of, mul_div_ceil, mul_div_floor};
use soroban_sdk::{
    auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation},
    contractclient, contractimpl, contracttype, panic_with_error, symbol_short, vec, Address, Env,
    IntoVal, String, Symbol, Val, Vec,
};

use crate::{bump_instance, cash, cfg, or_overflow, Config, DataKey, Error, Vault, VaultArgs, VaultClient};

// ───────────────────────── types ─────────────────────────

/// Cached DeFindex position of this vault.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StrategyPos {
    pub shares: i128,    // DeFindex vault shares held by this contract (measured)
    pub assets: i128,    // underlying value of those shares at the last sync
    pub last_sync: u64,  // ledger timestamp of the last sync
}

/// Buffer policy. `tranche == 0` disables routing even if a strategy is set.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BufferCfg {
    pub idle_target: i128, // cash the vault tries to keep idle
    pub tranche: i128,     // size of each push / pull
    pub min_out_bps: u32,  // slippage floor on pulls (e.g. 9_900 = accept ≥ 99 %)
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PendingStrategy {
    pub strategy: Option<Address>,
    pub eta: u64,
}

/// Mirrors of DeFindex's `Strategy` / `AssetStrategySet` (decoded by field
/// name, so the names must match theirs exactly).
#[contracttype]
#[derive(Clone)]
pub struct DfStrategy {
    pub address: Address,
    pub name: String,
    pub paused: bool,
}
#[contracttype]
#[derive(Clone)]
pub struct DfAssetStrategySet {
    pub address: Address,
    pub strategies: Vec<DfStrategy>,
}

/// Subset of the DeFindex vault interface this contract uses
/// (defindex-io/stellar-contracts, vault/src/interface.rs, verified 26/11/2026).
#[allow(dead_code)] // only the generated client is used
#[contractclient(name = "DefindexClient")]
pub trait Defindex {
    fn deposit(e: Env, amounts_desired: Vec<i128>, amounts_min: Vec<i128>, from: Address, invest: bool) -> Val;
    fn withdraw(e: Env, df_amount: i128, min_amounts_out: Vec<i128>, from: Address) -> Vec<i128>;
    fn balance(e: Env, id: Address) -> i128;
    fn get_asset_amounts_per_shares(e: Env, vault_shares: i128) -> Vec<i128>;
    fn get_assets(e: Env) -> Vec<DfAssetStrategySet>;
}

const BPS: i128 = 10_000;

// ───────────────────────── storage ─────────────────────────

pub(crate) fn strategy(e: &Env) -> Option<Address> {
    e.storage().instance().get(&DataKey::Strategy)
}
pub(crate) fn pos(e: &Env) -> StrategyPos {
    e.storage()
        .instance()
        .get(&DataKey::StrategyPos)
        .unwrap_or(StrategyPos { shares: 0, assets: 0, last_sync: 0 })
}
fn set_pos(e: &Env, p: &StrategyPos) {
    e.storage().instance().set(&DataKey::StrategyPos, p);
}
pub(crate) fn buffer(e: &Env) -> BufferCfg {
    e.storage()
        .instance()
        .get(&DataKey::Buffer)
        .unwrap_or(BufferCfg { idle_target: 0, tranche: 0, min_out_bps: BPS as u32 })
}
/// What `total_assets` adds for the strategy: the cached underlying value.
pub(crate) fn strategy_assets(e: &Env) -> i128 {
    pos(e).assets
}

// ───────────────────────── sync ─────────────────────────

/// Re-read the position's underlying value. `strict` panics on a DeFindex
/// failure (used right after we moved funds); non-strict keeps the cache and
/// emits `syncfail` (used before LP operations so they never get stuck).
pub(crate) fn sync(e: &Env, strict: bool) -> i128 {
    let p = pos(e);
    let st = match strategy(e) {
        Some(s) => s,
        None => return p.assets,
    };
    if p.shares <= 0 {
        if p.assets != 0 || p.shares != 0 {
            set_pos(e, &StrategyPos { shares: 0, assets: 0, last_sync: e.ledger().timestamp() });
        }
        return 0;
    }
    let client = DefindexClient::new(e, &st);
    match client.try_get_asset_amounts_per_shares(&p.shares) {
        Ok(Ok(v)) => {
            let new_assets = v.get(0).unwrap_or(0);
            set_pos(e, &StrategyPos { shares: p.shares, assets: new_assets, last_sync: e.ledger().timestamp() });
            e.events().publish((symbol_short!("sync"),), (p.assets, new_assets));
            new_assets
        }
        _ => {
            if strict {
                panic_with_error!(e, Error::StrategyCallFailed);
            }
            e.events().publish((symbol_short!("syncfail"),), p.assets);
            p.assets
        }
    }
}

/// Best-effort sync before an LP operation (no-op without a position).
pub(crate) fn soft_sync(e: &Env) {
    if pos(e).shares > 0 {
        sync(e, false);
    }
}

// ───────────────────────── moving funds ─────────────────────────

fn me(e: &Env) -> Address {
    e.current_contract_address()
}

/// Deposit `amount` of idle USDC into the strategy. Measures what left the
/// vault and what shares arrived; refuses a partial fill.
fn push(e: &Env, c: &Config, st: &Address, amount: i128) -> i128 {
    let vault = me(e);
    let client = DefindexClient::new(e, st);
    let cash_before = cash(e, c);
    let shares_before = client.balance(&vault);

    // Pre-authorize the deeper frame DeFindex will run on our behalf:
    //   token.transfer(from = vault, to = defindex, amount)
    let args: Vec<Val> = (vault.clone(), st.clone(), amount).into_val(e);
    e.authorize_as_current_contract(vec![
        e,
        InvokerContractAuthEntry::Contract(SubContractInvocation {
            context: ContractContext { contract: c.usdc.clone(), fn_name: Symbol::new(e, "transfer"), args },
            sub_invocations: vec![e],
        }),
    ]);
    client.deposit(&vec![e, amount], &vec![e, amount], &vault, &true);

    let moved = cash_before - cash(e, c);
    if moved != amount {
        panic_with_error!(e, Error::StrategyCallFailed);
    }
    let minted = client.balance(&vault) - shares_before;
    if minted <= 0 {
        panic_with_error!(e, Error::StrategyCallFailed);
    }
    let p = pos(e);
    set_pos(e, &StrategyPos { shares: p.shares + minted, assets: p.assets, last_sync: p.last_sync });
    let assets = sync(e, true);
    e.events().publish((symbol_short!("stratin"),), (amount, minted, assets));
    amount
}

/// Withdraw ~`want` USDC from the strategy. Returns the USDC actually
/// received (measured). Panics if the strategy delivers less than the
/// configured slippage floor.
fn pull(e: &Env, c: &Config, st: &Address, want: i128) -> i128 {
    let vault = me(e);
    let client = DefindexClient::new(e, st);
    let p = pos(e);
    if p.shares <= 0 || want <= 0 {
        return 0;
    }
    // Fresh underlying value, so the share count we burn is right.
    let fresh = sync(e, true);
    if fresh <= 0 {
        return 0;
    }
    let want = if want > fresh { fresh } else { want };
    let mut shares_to_burn = or_overflow(e, mul_div_ceil(e, want, p.shares, fresh));
    if shares_to_burn > p.shares {
        shares_to_burn = p.shares;
    }
    let min_out = or_overflow(e, bps_of(e, want, buffer(e).min_out_bps as i128));

    let cash_before = cash(e, c);
    let shares_before = client.balance(&vault);
    client.withdraw(&shares_to_burn, &vec![e, min_out], &vault);
    let received = cash(e, c) - cash_before;
    let burned = shares_before - client.balance(&vault);
    if received < min_out {
        panic_with_error!(e, Error::StrategyShort);
    }
    let p2 = pos(e);
    let left = p2.shares - burned;
    set_pos(e, &StrategyPos { shares: if left > 0 { left } else { 0 }, assets: p2.assets, last_sync: p2.last_sync });
    let assets = sync(e, true);
    e.events().publish((symbol_short!("stratout"),), (want, received, burned, assets));
    received
}

/// Pull-on-demand hook used by withdraw / redeem / borrow BEFORE their
/// `InsufficientCash` check: if idle cash cannot cover `needed`, bring back at
/// least the deficit (rounded up to a tranche) from the strategy. Never
/// panics on its own when there is nothing to pull: the caller's check does.
pub(crate) fn ensure_cash(e: &Env, c: &Config, needed: i128) {
    let idle = cash(e, c);
    if needed <= idle {
        return;
    }
    let p = pos(e);
    let st = match strategy(e) {
        Some(s) if p.shares > 0 => s,
        _ => return,
    };
    let deficit = needed - idle;
    let tranche = buffer(e).tranche;
    let want = if tranche > deficit { tranche } else { deficit };
    pull(e, c, &st, want);
}

/// One rebalance step: push one tranche if cash exceeds the buffer by at least
/// a tranche; otherwise pull one tranche if cash is below the buffer. Returns
/// the amount moved (positive = into the strategy, negative = back to idle).
fn rebalance_step(e: &Env, c: &Config) -> i128 {
    let st = match strategy(e) {
        Some(s) => s,
        None => panic_with_error!(e, Error::NoStrategy),
    };
    let b = buffer(e);
    if b.tranche <= 0 {
        panic_with_error!(e, Error::StrategyDisabled);
    }
    let idle = cash(e, c);
    if idle >= b.idle_target + b.tranche {
        gov::require_not_paused(e); // investing is new exposure
        return push(e, c, &st, b.tranche);
    }
    if idle < b.idle_target && pos(e).shares > 0 {
        let deficit = b.idle_target - idle;
        let want = if deficit < b.tranche { deficit } else { b.tranche };
        return -pull(e, c, &st, want);
    }
    0
}

// ───────────────────────── public surface ─────────────────────────

#[contractimpl]
impl Vault {
    // ── views ──
    pub fn strategy(e: Env) -> Option<Address> {
        strategy(&e)
    }
    pub fn strategy_position(e: Env) -> StrategyPos {
        pos(&e)
    }
    pub fn buffer(e: Env) -> BufferCfg {
        buffer(&e)
    }
    pub fn pending_strategy(e: Env) -> Option<PendingStrategy> {
        e.storage().instance().get(&DataKey::PendingStrategy)
    }

    // ── admin: policy ──
    /// Admin. `tranche == 0` disables routing. `min_out_bps` in [9_000, 10_000].
    pub fn set_buffer(e: Env, idle_target: i128, tranche: i128, min_out_bps: u32) {
        gov::require_role(&e, Role::Admin);
        if idle_target < 0 || tranche < 0 || min_out_bps < 9_000 || min_out_bps > BPS as u32 {
            panic_with_error!(&e, Error::BadBuffer);
        }
        e.storage().instance().set(&DataKey::Buffer, &BufferCfg { idle_target, tranche, min_out_bps });
        bump_instance(&e);
        e.events().publish((symbol_short!("bufset"),), (idle_target, tranche, min_out_bps));
    }

    // ── admin: strategy address, timelocked ──
    /// Admin: schedule a strategy change (or removal with `None`); executable
    /// after the upgrade delay and only while the position is empty.
    pub fn propose_strategy(e: Env, strategy: Option<Address>) -> u64 {
        gov::require_role(&e, Role::Admin);
        let eta = e.ledger().timestamp() + gov::upgrade_delay(&e);
        e.storage().instance().set(&DataKey::PendingStrategy, &PendingStrategy { strategy: strategy.clone(), eta });
        bump_instance(&e);
        e.events().publish((symbol_short!("stratprop"),), (strategy, eta));
        eta
    }
    pub fn execute_strategy(e: Env) {
        gov::require_role(&e, Role::Admin);
        let pending: PendingStrategy = match e.storage().instance().get(&DataKey::PendingStrategy) {
            Some(p) => p,
            None => panic_with_error!(&e, Error::NoPendingStrategy),
        };
        if e.ledger().timestamp() < pending.eta {
            panic_with_error!(&e, Error::StrategyNotReady);
        }
        if pos(&e).shares > 0 {
            panic_with_error!(&e, Error::StrategyNotEmpty);
        }
        if let Some(ref st) = pending.strategy {
            // Fail closed: the DeFindex vault must settle in our asset.
            let c = cfg(&e);
            let assets = DefindexClient::new(&e, st).get_assets();
            let first = assets.get(0).unwrap_or_else(|| panic_with_error!(&e, Error::StrategyAssetMismatch));
            if first.address != c.usdc {
                panic_with_error!(&e, Error::StrategyAssetMismatch);
            }
            e.storage().instance().set(&DataKey::Strategy, st);
        } else {
            e.storage().instance().remove(&DataKey::Strategy);
        }
        e.storage().instance().remove(&DataKey::PendingStrategy);
        set_pos(&e, &StrategyPos { shares: 0, assets: 0, last_sync: e.ledger().timestamp() });
        bump_instance(&e);
        e.events().publish((symbol_short!("stratexec"),), pending.strategy);
    }
    /// Admin or pauser (veto).
    pub fn cancel_strategy(e: Env, caller: Address) {
        gov::require_any_of(&e, &caller, &[Role::Admin, Role::Pauser]);
        if !e.storage().instance().has(&DataKey::PendingStrategy) {
            panic_with_error!(&e, Error::NoPendingStrategy);
        }
        e.storage().instance().remove(&DataKey::PendingStrategy);
        e.events().publish((symbol_short!("stratcncl"),), caller);
    }

    // ── operator: routing ──
    /// Operator. One tranche per call (bounded footprint); the keeper loops.
    pub fn rebalance(e: Env) -> i128 {
        gov::require_role(&e, Role::Operator);
        let c = cfg(&e);
        let moved = rebalance_step(&e, &c);
        bump_instance(&e);
        moved
    }
    /// Permissionless: refresh the cached value of the position (yield shows
    /// up in the share price after this).
    pub fn sync_strategy(e: Env) -> i128 {
        sync(&e, true)
    }
    /// Admin or pauser: bring everything back to idle (incident response).
    /// Works while paused. Accepts whatever the strategy returns (min_out 0)
    /// because getting the funds home beats a slippage floor in an emergency.
    pub fn emergency_unwind(e: Env, caller: Address) -> i128 {
        gov::require_any_of(&e, &caller, &[Role::Admin, Role::Pauser]);
        let c = cfg(&e);
        let st = match strategy(&e) {
            Some(s) => s,
            None => panic_with_error!(&e, Error::NoStrategy),
        };
        let p = pos(&e);
        if p.shares <= 0 {
            return 0;
        }
        let vault = me(&e);
        let client = DefindexClient::new(&e, &st);
        let cash_before = cash(&e, &c);
        client.withdraw(&p.shares, &vec![&e, 0i128], &vault);
        let received = cash(&e, &c) - cash_before;
        let left = client.balance(&vault);
        set_pos(&e, &StrategyPos { shares: left, assets: 0, last_sync: e.ledger().timestamp() });
        if left > 0 {
            sync(&e, false);
        }
        bump_instance(&e);
        e.events().publish((symbol_short!("unwind"),), (received, left));
        received
    }
}

// Keep the generated client/args types reachable from the crate root for
// tests and bindings (the second contractimpl block extends the same types).
#[allow(dead_code)]
fn _touch(_a: Option<VaultArgs>, _c: Option<VaultClient>) {}
#[allow(dead_code)]
fn _unused(e: &Env) -> i128 {
    or_overflow(e, mul_div_floor(e, 1, 1, 1))
}
