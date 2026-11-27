#![allow(deprecated)] // events().publish: same topic/data shape the indexer already parses; #[contractevent] migration is a separate task
//! Governance primitives shared by the vault and the loan-manager.
//!
//! * **Roles** (`Admin`, `Underwriter`, `Operator`, `Pauser`): one address per
//!   role, stored under [`GovKey::Role`]. `Admin` is expected to be a Stellar
//!   account with multisig thresholds (2-of-3), which Soroban honours on
//!   `require_auth` — no multisig logic lives in the contract.
//! * **Two-step admin transfer**: the new admin must `accept_admin`, so a typo
//!   can never hand the contract to a dead address.
//! * **Pause**: `Admin` or `Pauser` can pause; only `Admin` can unpause. The
//!   contract decides *which* functions a pause blocks (new exposure: deposits,
//!   borrows, investing) and which stay open (LP exits, repayments).
//! * **Timelocked upgrade**: `propose_upgrade` → wait `upgrade_delay` →
//!   `execute_upgrade(same hash)`. `Admin` or `Pauser` can cancel (veto).
//!
//! Every write emits an event so an indexer / alerting job can watch governance
//! without polling storage.

use soroban_sdk::{contracterror, contracttype, panic_with_error, symbol_short, Address, BytesN, Env};

/// Hard floor for the upgrade delay (10 min): enough to demo on testnet, and
/// mainnet deploys use 48 h. A delay below this is a misconfiguration.
pub const MIN_UPGRADE_DELAY: u64 = 600;
/// A matured proposal stays executable for this long after `eta`; after that
/// it must be re-proposed (no "sleeper" upgrades, review B12).
pub const PROPOSAL_WINDOW: u64 = 7 * 86_400;

/// Error codes 101–110 are reserved for governance so they never overlap the
/// contracts' own enums (1–99).
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum GovError {
    Unauthorized = 101,
    Paused = 102,
    NotPaused = 103,
    NoPendingAdmin = 104,
    NoPendingUpgrade = 105,
    TimelockNotReady = 106,
    UpgradeHashMismatch = 107,
    DelayTooShort = 108,
    RoleNotSet = 109,
    ProposalExpired = 110,
}

#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    Admin,
    Underwriter,
    Operator,
    Pauser,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PendingUpgrade {
    pub wasm_hash: BytesN<32>,
    pub eta: u64,
}

/// Instance-storage keys. A separate enum from the contract's `DataKey`, so the
/// two can coexist in the same instance map (variant names differ, so the
/// encoded keys differ).
#[contracttype]
pub enum GovKey {
    Role(Role),
    PendingAdmin,
    Paused,
    PendingUpgrade,
    UpgradeDelay,
}

// ───────────────────────── init / reads ─────────────────────────

/// Called once from the contract constructor.
pub fn init(e: &Env, admin: &Address, upgrade_delay_secs: u64) {
    if upgrade_delay_secs < MIN_UPGRADE_DELAY {
        panic_with_error!(e, GovError::DelayTooShort);
    }
    e.storage().instance().set(&GovKey::Role(Role::Admin), admin);
    e.storage().instance().set(&GovKey::UpgradeDelay, &upgrade_delay_secs);
    e.storage().instance().set(&GovKey::Paused, &false);
}

pub fn role(e: &Env, r: Role) -> Option<Address> {
    e.storage().instance().get(&GovKey::Role(r))
}

pub fn is_paused(e: &Env) -> bool {
    e.storage().instance().get(&GovKey::Paused).unwrap_or(false)
}

pub fn upgrade_delay(e: &Env) -> u64 {
    e.storage().instance().get(&GovKey::UpgradeDelay).unwrap_or(MIN_UPGRADE_DELAY)
}

pub fn pending_upgrade(e: &Env) -> Option<PendingUpgrade> {
    e.storage().instance().get(&GovKey::PendingUpgrade)
}

pub fn pending_admin(e: &Env) -> Option<Address> {
    e.storage().instance().get(&GovKey::PendingAdmin)
}

// ───────────────────────── guards ─────────────────────────

/// The address holding `r` must have authorized this invocation.
pub fn require_role(e: &Env, r: Role) -> Address {
    match role(e, r) {
        Some(a) => {
            a.require_auth();
            a
        }
        None => panic_with_error!(e, GovError::RoleNotSet),
    }
}

/// `caller` must have authorized the invocation AND hold one of `roles`.
/// (Soroban has no `msg.sender`; "admin OR pauser" is expressed by naming the
/// caller explicitly and checking membership.)
pub fn require_any_of(e: &Env, caller: &Address, roles: &[Role]) {
    caller.require_auth();
    for r in roles {
        if let Some(a) = role(e, *r) {
            if a == *caller {
                return;
            }
        }
    }
    panic_with_error!(e, GovError::Unauthorized);
}

pub fn require_not_paused(e: &Env) {
    if is_paused(e) {
        panic_with_error!(e, GovError::Paused);
    }
}

// ───────────────────────── roles ─────────────────────────

/// Admin-only. `Admin` itself cannot be set here: use the two-step transfer.
pub fn set_role(e: &Env, r: Role, addr: &Address) {
    if r == Role::Admin {
        panic_with_error!(e, GovError::Unauthorized);
    }
    require_role(e, Role::Admin);
    e.storage().instance().set(&GovKey::Role(r), addr);
    e.events().publish((symbol_short!("roleset"), r), addr.clone());
}

pub fn transfer_admin(e: &Env, new_admin: &Address) {
    require_role(e, Role::Admin);
    e.storage().instance().set(&GovKey::PendingAdmin, new_admin);
    e.events().publish((symbol_short!("adminprop"),), new_admin.clone());
}

/// The pending admin signs; only then does control move.
pub fn accept_admin(e: &Env) -> Address {
    let pending: Address = match pending_admin(e) {
        Some(a) => a,
        None => panic_with_error!(e, GovError::NoPendingAdmin),
    };
    pending.require_auth();
    e.storage().instance().set(&GovKey::Role(Role::Admin), &pending);
    e.storage().instance().remove(&GovKey::PendingAdmin);
    e.events().publish((symbol_short!("adminacc"),), pending.clone());
    pending
}

pub fn cancel_admin_transfer(e: &Env) {
    require_role(e, Role::Admin);
    e.storage().instance().remove(&GovKey::PendingAdmin);
    e.events().publish((symbol_short!("admincncl"),), ());
}

// ───────────────────────── pause ─────────────────────────

/// `caller` must be Admin or Pauser.
pub fn pause(e: &Env, caller: &Address) {
    require_any_of(e, caller, &[Role::Admin, Role::Pauser]);
    e.storage().instance().set(&GovKey::Paused, &true);
    e.events().publish((symbol_short!("pause"),), caller.clone());
}

/// Admin only: the role that can stop is not the role that can resume.
pub fn unpause(e: &Env) {
    let admin = require_role(e, Role::Admin);
    if !is_paused(e) {
        panic_with_error!(e, GovError::NotPaused);
    }
    e.storage().instance().set(&GovKey::Paused, &false);
    e.events().publish((symbol_short!("unpause"),), admin);
}

// ───────────────────────── timelocked upgrade ─────────────────────────

pub fn propose_upgrade(e: &Env, new_wasm_hash: &BytesN<32>) -> u64 {
    let admin = require_role(e, Role::Admin);
    if pending_upgrade(e).is_some() {
        // replacing a pending proposal: tell the indexer the old one is gone
        e.events().publish((symbol_short!("upgcancl"),), admin);
    }
    let eta = e.ledger().timestamp() + upgrade_delay(e);
    e.storage().instance().set(
        &GovKey::PendingUpgrade,
        &PendingUpgrade { wasm_hash: new_wasm_hash.clone(), eta },
    );
    e.events().publish((symbol_short!("upgprop"),), (new_wasm_hash.clone(), eta));
    eta
}

/// Admin only, after `eta`, and the hash must match what was proposed (so a
/// proposal cannot be swapped for a different wasm at execution time).
pub fn execute_upgrade(e: &Env, expected_wasm_hash: &BytesN<32>) {
    require_role(e, Role::Admin);
    let p = match pending_upgrade(e) {
        Some(p) => p,
        None => panic_with_error!(e, GovError::NoPendingUpgrade),
    };
    if p.wasm_hash != *expected_wasm_hash {
        panic_with_error!(e, GovError::UpgradeHashMismatch);
    }
    let now = e.ledger().timestamp();
    if now < p.eta {
        panic_with_error!(e, GovError::TimelockNotReady);
    }
    if now > p.eta + PROPOSAL_WINDOW {
        panic_with_error!(e, GovError::ProposalExpired);
    }
    e.storage().instance().remove(&GovKey::PendingUpgrade);
    e.events().publish((symbol_short!("upgexec"),), p.wasm_hash.clone());
    e.deployer().update_current_contract_wasm(p.wasm_hash);
}

/// Admin or Pauser (veto power for the on-call key).
pub fn cancel_upgrade(e: &Env, caller: &Address) {
    require_any_of(e, caller, &[Role::Admin, Role::Pauser]);
    if pending_upgrade(e).is_none() {
        panic_with_error!(e, GovError::NoPendingUpgrade);
    }
    e.storage().instance().remove(&GovKey::PendingUpgrade);
    e.events().publish((symbol_short!("upgcancl"),), caller.clone());
}
