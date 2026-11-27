#![cfg(test)]
//! Test double for a DeFindex vault (D2.2). Same entry points and the same
//! quirks the real one has (verified on testnet, 26/11/2026):
//!   * `deposit` pulls the asset with `token.transfer(from, self, amount)`, so
//!     the caller must have pre-authorized that deeper frame
//!     (`authorize_as_current_contract`); `from.require_auth()` is satisfied
//!     by being the direct invoker.
//!   * `withdraw` returns the REQUESTED amount, not the delivered one — a
//!     `haircut_bps` knob makes it deliver less, to prove the vault measures.
//!   * value per share = asset balance / total shares; yield is simulated by
//!     minting the asset straight to the mock.
//!   * `set_fail(true)` makes every call panic (DeFindex down).

use soroban_sdk::{contract, contractimpl, contracttype, panic_with_error, token, vec, Address, Env, String, Val, Vec, IntoVal, contracterror};

use crate::{DfAssetStrategySet, DfStrategy};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum MockError {
    Down = 900,
    MinOut = 901,
    NoShares = 902,
}

#[contracttype]
pub enum MKey {
    Asset,
    Total,
    Shares(Address),
    Haircut,
    Fail,
}

#[contract]
pub struct MockDefindex;

fn asset(e: &Env) -> Address {
    e.storage().instance().get(&MKey::Asset).unwrap()
}
fn total(e: &Env) -> i128 {
    e.storage().instance().get(&MKey::Total).unwrap_or(0)
}
fn shares_of(e: &Env, a: &Address) -> i128 {
    e.storage().persistent().get(&MKey::Shares(a.clone())).unwrap_or(0)
}
fn managed(e: &Env) -> i128 {
    token::Client::new(e, &asset(e)).balance(&e.current_contract_address())
}
fn guard(e: &Env) {
    if e.storage().instance().get(&MKey::Fail).unwrap_or(false) {
        panic_with_error!(e, MockError::Down);
    }
}

#[contractimpl]
impl MockDefindex {
    pub fn init(e: Env, asset: Address) {
        e.storage().instance().set(&MKey::Asset, &asset);
    }
    pub fn set_haircut_bps(e: Env, bps: u32) {
        e.storage().instance().set(&MKey::Haircut, &bps);
    }
    pub fn set_fail(e: Env, fail: bool) {
        e.storage().instance().set(&MKey::Fail, &fail);
    }

    pub fn deposit(e: Env, amounts_desired: Vec<i128>, _amounts_min: Vec<i128>, from: Address, _invest: bool) -> Val {
        guard(&e);
        from.require_auth();
        let amt = amounts_desired.get(0).unwrap_or(0);
        let t = total(&e);
        let m = managed(&e);
        let minted = if t == 0 || m == 0 { amt } else { amt * t / m };
        token::Client::new(&e, &asset(&e)).transfer(&from, &e.current_contract_address(), &amt);
        e.storage().persistent().set(&MKey::Shares(from.clone()), &(shares_of(&e, &from) + minted));
        e.storage().instance().set(&MKey::Total, &(t + minted));
        (vec![&e, amt], minted).into_val(&e)
    }

    pub fn withdraw(e: Env, df_amount: i128, min_amounts_out: Vec<i128>, from: Address) -> Vec<i128> {
        guard(&e);
        from.require_auth();
        let have = shares_of(&e, &from);
        if df_amount <= 0 || df_amount > have {
            panic_with_error!(&e, MockError::NoShares);
        }
        let t = total(&e);
        let intended = df_amount * managed(&e) / t;
        let haircut: u32 = e.storage().instance().get(&MKey::Haircut).unwrap_or(0);
        let paid = intended * (10_000 - haircut as i128) / 10_000;
        // like the real one: the floor is checked against the INTENDED amount
        if intended < min_amounts_out.get(0).unwrap_or(0) {
            panic_with_error!(&e, MockError::MinOut);
        }
        e.storage().persistent().set(&MKey::Shares(from.clone()), &(have - df_amount));
        e.storage().instance().set(&MKey::Total, &(t - df_amount));
        token::Client::new(&e, &asset(&e)).transfer(&e.current_contract_address(), &from, &paid);
        vec![&e, intended]
    }

    pub fn balance(e: Env, id: Address) -> i128 {
        guard(&e);
        shares_of(&e, &id)
    }

    pub fn get_asset_amounts_per_shares(e: Env, vault_shares: i128) -> Vec<i128> {
        guard(&e);
        let t = total(&e);
        let v = if t == 0 { 0 } else { vault_shares * managed(&e) / t };
        vec![&e, v]
    }

    pub fn get_assets(e: Env) -> Vec<DfAssetStrategySet> {
        guard(&e);
        vec![
            &e,
            DfAssetStrategySet {
                address: asset(&e),
                strategies: vec![
                    &e,
                    DfStrategy { address: e.current_contract_address(), name: String::from_str(&e, "mock"), paused: false },
                ],
            },
        ]
    }
}
