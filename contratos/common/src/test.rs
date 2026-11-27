#![cfg(test)]
//! Unit tests for the shared math and governance primitives. Governance is
//! exercised through a tiny host contract (`Gov`) because roles, pause and the
//! timelock live in instance storage and go through `require_auth`.

use crate::gov::{self, GovError, Role, MIN_UPGRADE_DELAY};
use crate::math::{bps_of, mul_div_ceil, mul_div_floor};
use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Ledger, MockAuth, MockAuthInvoke},
    Address, BytesN, Env, IntoVal,
};

// ───────────────────────── math ─────────────────────────

#[test]
fn mul_div_floor_and_ceil_basic() {
    let e = Env::default();
    assert_eq!(mul_div_floor(&e, 7, 3, 2), Some(10)); // 21/2 = 10.5
    assert_eq!(mul_div_ceil(&e, 7, 3, 2), Some(11));
    assert_eq!(mul_div_floor(&e, 10, 10, 5), Some(20)); // exact
    assert_eq!(mul_div_ceil(&e, 10, 10, 5), Some(20));
    assert_eq!(bps_of(&e, 1_000_000, 500), Some(50_000)); // 5 %
}

#[test]
fn mul_div_no_intermediate_overflow() {
    let e = Env::default();
    // a * b overflows i128 (≈ 1.7e38) but the quotient fits.
    let a = i128::MAX / 2;
    let b = 4;
    let c = 4;
    assert_eq!(mul_div_floor(&e, a, b, c), Some(a));
    assert_eq!(mul_div_ceil(&e, a, b, c), Some(a));
}

#[test]
fn mul_div_rejects_zero_divisor_negative_inputs_and_i128_overflow() {
    let e = Env::default();
    assert_eq!(mul_div_floor(&e, 1, 1, 0), None);
    assert_eq!(mul_div_floor(&e, -1, 1, 1), None);
    assert_eq!(mul_div_ceil(&e, 1, -1, 1), None);
    // quotient larger than i128::MAX
    assert_eq!(mul_div_floor(&e, i128::MAX, 2, 1), None);
    assert_eq!(mul_div_ceil(&e, i128::MAX, 2, 1), None);
}

// ───────────────────────── governance host contract ─────────────────────────

#[contract]
pub struct Gov;

#[contractimpl]
impl Gov {
    pub fn __constructor(e: Env, admin: Address, delay: u64) {
        gov::init(&e, &admin, delay);
    }
    pub fn role(e: Env, r: Role) -> Option<Address> {
        gov::role(&e, r)
    }
    pub fn set_role(e: Env, r: Role, a: Address) {
        gov::set_role(&e, r, &a)
    }
    pub fn transfer_admin(e: Env, a: Address) {
        gov::transfer_admin(&e, &a)
    }
    pub fn accept_admin(e: Env) -> Address {
        gov::accept_admin(&e)
    }
    pub fn pause(e: Env, caller: Address) {
        gov::pause(&e, &caller)
    }
    pub fn unpause(e: Env) {
        gov::unpause(&e)
    }
    pub fn is_paused(e: Env) -> bool {
        gov::is_paused(&e)
    }
    pub fn guarded(e: Env) -> u32 {
        gov::require_not_paused(&e);
        1
    }
    pub fn propose_upgrade(e: Env, h: BytesN<32>) -> u64 {
        gov::propose_upgrade(&e, &h)
    }
    pub fn execute_upgrade(e: Env, h: BytesN<32>) {
        gov::execute_upgrade(&e, &h)
    }
    pub fn cancel_upgrade(e: Env, caller: Address) {
        gov::cancel_upgrade(&e, &caller)
    }
    pub fn pending_upgrade(e: Env) -> Option<gov::PendingUpgrade> {
        gov::pending_upgrade(&e)
    }
    pub fn operator_only(e: Env) -> u32 {
        gov::require_role(&e, Role::Operator);
        2
    }
}

fn setup(mock: bool) -> (Env, Address, GovClient<'static>) {
    let e = Env::default();
    if mock {
        e.mock_all_auths();
    }
    let admin = Address::generate(&e);
    let id = e.register(Gov, (admin.clone(), MIN_UPGRADE_DELAY));
    let c = GovClient::new(&e, &id);
    (e, admin, c)
}

fn advance(e: &Env, secs: u64) {
    e.ledger().with_mut(|li| li.timestamp += secs);
}

#[test]
#[should_panic(expected = "Error(Contract, #108)")]
fn init_rejects_delay_below_floor() {
    let e = Env::default();
    let admin = Address::generate(&e);
    e.register(Gov, (admin, MIN_UPGRADE_DELAY - 1));
}

#[test]
fn roles_set_read_and_admin_cannot_be_set_directly() {
    let (e, admin, c) = setup(true);
    assert_eq!(c.role(&Role::Admin), Some(admin.clone()));
    assert_eq!(c.role(&Role::Operator), None);
    let op = Address::generate(&e);
    c.set_role(&Role::Operator, &op);
    assert_eq!(c.role(&Role::Operator), Some(op.clone()));
    assert_eq!(c.operator_only(), 2);
    let r = c.try_set_role(&Role::Admin, &op);
    assert_eq!(r, Err(Ok(GovError::Unauthorized.into())));
}

#[test]
fn set_role_requires_admin_signature() {
    let (e, _admin, c) = setup(false);
    let attacker = Address::generate(&e);
    let op = Address::generate(&e);
    // attacker signs, but the gate names the admin -> auth fails
    let r = c
        .mock_auths(&[MockAuth {
            address: &attacker,
            invoke: &MockAuthInvoke {
                contract: &c.address,
                fn_name: "set_role",
                args: (Role::Operator, op.clone()).into_val(&e),
                sub_invokes: &[],
            },
        }])
        .try_set_role(&Role::Operator, &op);
    assert!(r.is_err());
    assert_eq!(c.role(&Role::Operator), None);
}

#[test]
fn admin_transfer_is_two_step_and_old_admin_keeps_control_until_accept() {
    let (e, admin, c) = setup(true);
    let new_admin = Address::generate(&e);
    c.transfer_admin(&new_admin);
    assert_eq!(c.role(&Role::Admin), Some(admin.clone())); // not yet
    assert_eq!(c.accept_admin(), new_admin.clone());
    assert_eq!(c.role(&Role::Admin), Some(new_admin));
    // a second accept with nothing pending fails
    assert_eq!(c.try_accept_admin(), Err(Ok(GovError::NoPendingAdmin.into())));
}

#[test]
fn pause_by_pauser_blocks_guarded_and_only_admin_unpauses() {
    let (e, admin, c) = setup(true);
    let pauser = Address::generate(&e);
    c.set_role(&Role::Pauser, &pauser);
    assert_eq!(c.guarded(), 1);
    c.pause(&pauser);
    assert!(c.is_paused());
    assert_eq!(c.try_guarded(), Err(Ok(GovError::Paused.into())));
    // a stranger cannot pause
    let stranger = Address::generate(&e);
    assert_eq!(c.try_pause(&stranger), Err(Ok(GovError::Unauthorized.into())));
    // admin can also pause (idempotent) and is the only one who unpauses
    c.pause(&admin);
    c.unpause();
    assert!(!c.is_paused());
    assert_eq!(c.try_unpause(), Err(Ok(GovError::NotPaused.into())));
}

#[test]
fn pauser_cannot_unpause() {
    let (e, _admin, c) = setup(false);
    let pauser = Address::generate(&e);
    // give the pauser role with the admin's (mocked) signature
    let admin = c.role(&Role::Admin).unwrap();
    c.mock_auths(&[MockAuth {
        address: &admin,
        invoke: &MockAuthInvoke {
            contract: &c.address,
            fn_name: "set_role",
            args: (Role::Pauser, pauser.clone()).into_val(&e),
            sub_invokes: &[],
        },
    }])
    .set_role(&Role::Pauser, &pauser);
    c.mock_auths(&[MockAuth {
        address: &pauser,
        invoke: &MockAuthInvoke {
            contract: &c.address,
            fn_name: "pause",
            args: (pauser.clone(),).into_val(&e),
            sub_invokes: &[],
        },
    }])
    .pause(&pauser);
    assert!(c.is_paused());
    // unpause names the admin; a pauser-only signature does not satisfy it
    let r = c
        .mock_auths(&[MockAuth {
            address: &pauser,
            invoke: &MockAuthInvoke {
                contract: &c.address,
                fn_name: "unpause",
                args: ().into_val(&e),
                sub_invokes: &[],
            },
        }])
        .try_unpause();
    assert!(r.is_err());
    assert!(c.is_paused());
}

#[test]
fn timelock_execute_before_eta_fails_wrong_hash_fails_cancel_clears() {
    let (e, _admin, c) = setup(true);
    let h = BytesN::from_array(&e, &[7u8; 32]);
    let other = BytesN::from_array(&e, &[9u8; 32]);
    let eta = c.propose_upgrade(&h);
    assert_eq!(eta, e.ledger().timestamp() + MIN_UPGRADE_DELAY);
    assert_eq!(c.try_execute_upgrade(&h), Err(Ok(GovError::TimelockNotReady.into())));
    assert_eq!(c.try_execute_upgrade(&other), Err(Ok(GovError::UpgradeHashMismatch.into())));
    let pauser = Address::generate(&e);
    c.set_role(&Role::Pauser, &pauser);
    c.cancel_upgrade(&pauser); // veto
    advance(&e, MIN_UPGRADE_DELAY + 1);
    assert_eq!(c.try_execute_upgrade(&h), Err(Ok(GovError::NoPendingUpgrade.into())));
    assert_eq!(c.try_cancel_upgrade(&pauser), Err(Ok(GovError::NoPendingUpgrade.into())));
}

#[test]
fn timelock_execute_after_eta_reaches_the_wasm_update() {
    let (e, _admin, c) = setup(true);
    // an unknown hash: the gate passes and the host rejects the missing wasm,
    // which proves we got past every governance check.
    let h = BytesN::from_array(&e, &[1u8; 32]);
    c.propose_upgrade(&h);
    advance(&e, MIN_UPGRADE_DELAY);
    let r = c.try_execute_upgrade(&h);
    // Every governance gate was passed: the only acceptable failure is the
    // host rejecting the unknown wasm hash (a Context error), never one of ours.
    assert!(r.is_err());
    for ge in [
        GovError::TimelockNotReady,
        GovError::NoPendingUpgrade,
        GovError::UpgradeHashMismatch,
        GovError::Unauthorized,
    ] {
        assert_ne!(r, Err(Ok(ge.into())), "governance gate rejected a valid execute");
    }
    // A failed host call rolls the whole invocation back, so the proposal is
    // still pending (nothing was consumed by the failed attempt).
    assert!(c.pending_upgrade().is_some());
}
