#![no_std]
//! lendoor-common — pieces shared by the vault and the loan-manager
//! (SCF #45 Tranche 2, D2.3 "production hardening for fund custody"):
//!
//! * [`math`] — `mul_div_floor` / `mul_div_ceil` over `I256`: no intermediate
//!   overflow, explicit error instead of a silent wrap or a bare abort.
//! * [`gov`]  — roles (admin / underwriter / operator / pauser), two-step admin
//!   transfer, emergency pause and a timelocked upgrade. Storage keys live in
//!   their own `#[contracttype]` enum so they never collide with a contract's
//!   `DataKey`, and every admin action emits an event.
//!
//! Nothing here holds funds or talks to tokens: it is pure policy.

pub mod gov;
pub mod math;

#[cfg(test)]
mod test;
