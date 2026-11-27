import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}


export const networks = {
  testnet: {
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId: "CCJTYVKKRD5MQI7BLHF4BYAYFXZS5S5J3SZ33ZXTJC4SA55V27NUBGX2",
  }
} as const


/**
 * The single active (or most-recently-closed) loan per user.
 */
export interface Loan {
  active: boolean;
  amount_due: i128;
  defaulted: boolean;
  due: u64;
  fee_bps: u32;
  grace_period: u64;
  last_accrued: u64;
  principal: i128;
  start: u64;
  tenor_days: u32;
}

export const Errors = {
  1: {message:"AlreadyInitialized"},
  2: {message:"NotInitialized"},
  3: {message:"NotAuthorized"},
  4: {message:"ZeroAddress"},
  5: {message:"ZeroPrincipal"},
  6: {message:"Cooldown"},
  7: {message:"LoanActive"},
  8: {message:"OverCreditLimit"},
  9: {message:"NoOffer"},
  10: {message:"OfferExpired"},
  11: {message:"BadTenor"},
  12: {message:"BadFee"},
  13: {message:"OverOffer"},
  14: {message:"NoActiveLoan"},
  15: {message:"AlreadyDefaulted"},
  16: {message:"TooEarlyToDefault"},
  17: {message:"Underpaid"},
  18: {message:"InvalidParam"},
  19: {message:"MathOverflow"}
}


/**
 * Global config (instance storage).
 */
export interface Config {
  default_grace_period: u64;
  default_late_period: u64;
  vault: string;
}

export type DataKey = {tag: "Config", values: void} | {tag: "MinHold", values: readonly [u32]} | {tag: "Risk", values: readonly [string]} | {tag: "Offer", values: readonly [string]} | {tag: "Loan", values: readonly [string]} | {tag: "Premium", values: readonly [string]} | {tag: "NextBorrow", values: readonly [string]};


/**
 * Per-user risk profile written by the off-chain model. `limit` is in the
 * asset's smallest unit (USDC = 6 decimals: 1_000_000 = $1).
 */
export interface UserRisk {
  kyc_ok: boolean;
  last_update: u64;
  limit: i128;
  score: u32;
  valid_until: u64;
}


/**
 * One-shot loan offer. Created by `set_loan_offer`, consumed by `open_loan`.
 */
export interface LoanOffer {
  fee_bps: u32;
  max_amount: i128;
  tenor_days: u32;
  valid_until: u64;
}


/**
 * Per-user premium / late-fee config. `late_rate_per_sec_wad` is used;
 * `premium_rate_per_sec_wad` is reserved (inert), kept for forward-compat.
 */
export interface PremiumConfig {
  late_rate_per_sec_wad: i128;
  premium_rate_per_sec_wad: i128;
}

export type Role = {tag: "Admin", values: void} | {tag: "Underwriter", values: void} | {tag: "Operator", values: void} | {tag: "Pauser", values: void};

/**
 * Instance-storage keys. A separate enum from the contract's `DataKey`, so the
 * two can coexist in the same instance map (variant names differ, so the
 * encoded keys differ).
 */
export type GovKey = {tag: "Role", values: readonly [Role]} | {tag: "PendingAdmin", values: void} | {tag: "Paused", values: void} | {tag: "PendingUpgrade", values: void} | {tag: "UpgradeDelay", values: void};

/**
 * Error codes 101–110 are reserved for governance so they never overlap the
 * contracts' own enums (1–99).
 */
export const GovError = {
  101: {message:"Unauthorized"},
  102: {message:"Paused"},
  103: {message:"NotPaused"},
  104: {message:"NoPendingAdmin"},
  105: {message:"NoPendingUpgrade"},
  106: {message:"TimelockNotReady"},
  107: {message:"UpgradeHashMismatch"},
  108: {message:"DelayTooShort"},
  109: {message:"RoleNotSet"},
  110: {message:"MathOverflow"}
}


export interface PendingUpgrade {
  eta: u64;
  wasm_hash: Buffer;
}

export interface Client {
  /**
   * Construct and simulate a pause transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * `caller` must be the admin or the pauser.
   */
  pause: ({caller}: {caller: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a unpause transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Admin only.
   */
  unpause: (options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_loan transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_loan: ({borrower}: {borrower: string}, options?: MethodOptions) => Promise<AssembledTransaction<Loan>>

  /**
   * Construct and simulate a get_role transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_role: ({role}: {role: Role}, options?: MethodOptions) => Promise<AssembledTransaction<Option<string>>>

  /**
   * Construct and simulate a set_role transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Admin: assign `underwriter` or `pauser`; `admin` moves only via the
   * two-step transfer.
   */
  set_role: ({role, account}: {role: Role, account: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a is_paused transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  is_paused: (options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a open_loan transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Register a fixed-term loan. Called by the vault inside borrow_with_term,
   * AFTER it has pushed assets to the borrower. A revert here reverts the
   * whole borrow (atomic).
   */
  open_loan: ({borrower, principal, tenor_days, fee_bps}: {borrower: string, principal: i128, tenor_days: u32, fee_bps: u32}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a set_vault transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_vault: ({vault}: {vault: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a close_loan transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Close the borrower's active loan after repayment. Vault-only. `paid`
   * must be >= amount_due (with accrued late fees).
   */
  close_loan: ({borrower, paid}: {borrower: string, paid: i128}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a accrue_late transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Materialize accrued interest (pre-due, pro-rata) and late fees
   * (post-due+grace) into the stored amount_due. Idempotent. Permissionless
   * on purpose (no attack surface, fixes the V3 keeper leak). Keeps its
   * historical name so the generated clients don't churn.
   */
  accrue_late: ({borrower}: {borrower: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_premium transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Per-user premium / late-fee config (mirrors the EVM `premiums(addr)`
   * read the frontend uses to drive the live late-fee ticker).
   */
  get_premium: ({account}: {account: string}, options?: MethodOptions) => Promise<AssembledTransaction<PremiumConfig>>

  /**
   * Construct and simulate a accept_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  accept_admin: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a credit_limit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Effective credit limit, factoring KYC + expiry. This is what the vault
   * reads to gate borrowing (replaces RiskManagerUncollat's collateral hook).
   */
  credit_limit: ({account}: {account: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a is_defaulted transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  is_defaulted: ({borrower}: {borrower: string}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a mark_default transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Mark a loan defaulted (admin flag). Does NOT touch vault accounting — the
   * vault's `manual_write_off` does that (and checks is_defaulted first).
   */
  mark_default: ({borrower}: {borrower: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a preview_owed transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * View: amount_due if a repay happened now, including unaccrued late fees.
   */
  preview_owed: ({borrower}: {borrower: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a apply_payment transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Vault-only. Aplica un pago (parcial o total) al prestamo vivo, con
   * imputacion interes-primero. Devuelve
   * (principal_pagado, interes_pagado, saldo_restante); si el saldo llega a
   * 0 cierra el prestamo (mismos efectos que close_loan). Prestamos en
   * default: SOLO pago total — la curacion post-write-off del vault asume
   * el monto completo.
   */
  apply_payment: ({borrower, paid}: {borrower: string, paid: i128}, options?: MethodOptions) => Promise<AssembledTransaction<readonly [i128, i128, i128]>>

  /**
   * Construct and simulate a get_user_risk transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Raw stored risk profile (mirrors the EVM `users(addr)` getter the
   * frontend's `useCreditLine` polls for score / KYC / limit). Returns a
   * zeroed profile if the user was never scored.
   */
  get_user_risk: ({account}: {account: string}, options?: MethodOptions) => Promise<AssembledTransaction<UserRisk>>

  /**
   * Construct and simulate a set_user_risk transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Write the off-chain model's verdict for a user.
   */
  set_user_risk: ({account, score, kyc_ok, valid_until, limit}: {account: string, score: u32, kyc_ok: boolean, valid_until: u64, limit: i128}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a upgrade_delay transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  upgrade_delay: (options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a cancel_upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  cancel_upgrade: ({caller}: {caller: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a set_loan_offer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_loan_offer: ({borrower, tenor_days, fee_bps, valid_until, max_amount}: {borrower: string, tenor_days: u32, fee_bps: u32, valid_until: u64, max_amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a transfer_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  transfer_admin: ({new_admin}: {new_admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a execute_upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  execute_upgrade: ({new_wasm_hash}: {new_wasm_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a pending_upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  pending_upgrade: (options?: MethodOptions) => Promise<AssembledTransaction<Option<PendingUpgrade>>>

  /**
   * Construct and simulate a propose_upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  propose_upgrade: ({new_wasm_hash}: {new_wasm_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a next_borrow_time transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Earliest timestamp at which `account` may open a new loan (cooldown).
   * Mirrors the EVM `nextBorrowTime(addr)` read.
   */
  next_borrow_time: ({account}: {account: string}, options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a set_premium_config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_premium_config: ({borrower, premium_rate_per_sec_wad, late_rate_per_sec_wad}: {borrower: string, premium_rate_per_sec_wad: i128, late_rate_per_sec_wad: i128}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a cancel_admin_transfer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  cancel_admin_transfer: (options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a preview_loan_with_late transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * `(principal, amount_due_with_late)` — mirrors the EVM
   * `previewLoanWithLate(addr)` tuple the frontend reads for repay UX.
   */
  preview_loan_with_late: ({borrower}: {borrower: string}, options?: MethodOptions) => Promise<AssembledTransaction<readonly [i128, i128]>>

  /**
   * Construct and simulate a set_min_hold_for_tenor transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_min_hold_for_tenor: ({tenor_days, min_hold_days}: {tenor_days: u32, min_hold_days: u32}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a set_default_grace_period transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_default_grace_period: ({secs}: {secs: u64}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {admin, underwriter, pauser, vault, upgrade_delay_secs}: {admin: string, underwriter: string, pauser: string, vault: string, upgrade_delay_secs: u64},
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy({admin, underwriter, pauser, vault, upgrade_delay_secs}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAQAAADpUaGUgc2luZ2xlIGFjdGl2ZSAob3IgbW9zdC1yZWNlbnRseS1jbG9zZWQpIGxvYW4gcGVyIHVzZXIuAAAAAAAAAAAABExvYW4AAAAKAAAAAAAAAAZhY3RpdmUAAAAAAAEAAAAAAAAACmFtb3VudF9kdWUAAAAAAAsAAAAAAAAACWRlZmF1bHRlZAAAAAAAAAEAAAAAAAAAA2R1ZQAAAAAGAAAAAAAAAAdmZWVfYnBzAAAAAAQAAAAAAAAADGdyYWNlX3BlcmlvZAAAAAYAAAAAAAAADGxhc3RfYWNjcnVlZAAAAAYAAAAAAAAACXByaW5jaXBhbAAAAAAAAAsAAAAAAAAABXN0YXJ0AAAAAAAABgAAAAAAAAAKdGVub3JfZGF5cwAAAAAABA==",
        "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAAEwAAAAAAAAASQWxyZWFkeUluaXRpYWxpemVkAAAAAAABAAAAAAAAAA5Ob3RJbml0aWFsaXplZAAAAAAAAgAAAAAAAAANTm90QXV0aG9yaXplZAAAAAAAAAMAAAAAAAAAC1plcm9BZGRyZXNzAAAAAAQAAAAAAAAADVplcm9QcmluY2lwYWwAAAAAAAAFAAAAAAAAAAhDb29sZG93bgAAAAYAAAAAAAAACkxvYW5BY3RpdmUAAAAAAAcAAAAAAAAAD092ZXJDcmVkaXRMaW1pdAAAAAAIAAAAAAAAAAdOb09mZmVyAAAAAAkAAAAAAAAADE9mZmVyRXhwaXJlZAAAAAoAAAAAAAAACEJhZFRlbm9yAAAACwAAAAAAAAAGQmFkRmVlAAAAAAAMAAAAAAAAAAlPdmVyT2ZmZXIAAAAAAAANAAAAAAAAAAxOb0FjdGl2ZUxvYW4AAAAOAAAAAAAAABBBbHJlYWR5RGVmYXVsdGVkAAAADwAAAAAAAAARVG9vRWFybHlUb0RlZmF1bHQAAAAAAAAQAAAAAAAAAAlVbmRlcnBhaWQAAAAAAAARAAAAAAAAAAxJbnZhbGlkUGFyYW0AAAASAAAAAAAAAAxNYXRoT3ZlcmZsb3cAAAAT",
        "AAAAAQAAACFHbG9iYWwgY29uZmlnIChpbnN0YW5jZSBzdG9yYWdlKS4AAAAAAAAAAAAABkNvbmZpZwAAAAAAAwAAAAAAAAAUZGVmYXVsdF9ncmFjZV9wZXJpb2QAAAAGAAAAAAAAABNkZWZhdWx0X2xhdGVfcGVyaW9kAAAAAAYAAAAAAAAABXZhdWx0AAAAAAAAEw==",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAABwAAAAAAAAAAAAAABkNvbmZpZwAAAAAAAQAAAAAAAAAHTWluSG9sZAAAAAABAAAABAAAAAEAAAAAAAAABFJpc2sAAAABAAAAEwAAAAEAAAAAAAAABU9mZmVyAAAAAAAAAQAAABMAAAABAAAAAAAAAARMb2FuAAAAAQAAABMAAAABAAAAAAAAAAdQcmVtaXVtAAAAAAEAAAATAAAAAQAAAAAAAAAKTmV4dEJvcnJvdwAAAAAAAQAAABM=",
        "AAAAAQAAAIJQZXItdXNlciByaXNrIHByb2ZpbGUgd3JpdHRlbiBieSB0aGUgb2ZmLWNoYWluIG1vZGVsLiBgbGltaXRgIGlzIGluIHRoZQphc3NldCdzIHNtYWxsZXN0IHVuaXQgKFVTREMgPSA2IGRlY2ltYWxzOiAxXzAwMF8wMDAgPSAkMSkuAAAAAAAAAAAACFVzZXJSaXNrAAAABQAAAAAAAAAGa3ljX29rAAAAAAABAAAAAAAAAAtsYXN0X3VwZGF0ZQAAAAAGAAAAAAAAAAVsaW1pdAAAAAAAAAsAAAAAAAAABXNjb3JlAAAAAAAABAAAAAAAAAALdmFsaWRfdW50aWwAAAAABg==",
        "AAAAAQAAAEpPbmUtc2hvdCBsb2FuIG9mZmVyLiBDcmVhdGVkIGJ5IGBzZXRfbG9hbl9vZmZlcmAsIGNvbnN1bWVkIGJ5IGBvcGVuX2xvYW5gLgAAAAAAAAAAAAlMb2FuT2ZmZXIAAAAAAAAEAAAAAAAAAAdmZWVfYnBzAAAAAAQAAAAAAAAACm1heF9hbW91bnQAAAAAAAsAAAAAAAAACnRlbm9yX2RheXMAAAAAAAQAAAAAAAAAC3ZhbGlkX3VudGlsAAAAAAY=",
        "AAAAAAAAAClgY2FsbGVyYCBtdXN0IGJlIHRoZSBhZG1pbiBvciB0aGUgcGF1c2VyLgAAAAAAAAVwYXVzZQAAAAAAAAEAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAA=",
        "AAAAAAAAAAtBZG1pbiBvbmx5LgAAAAAHdW5wYXVzZQAAAAAAAAAAAA==",
        "AAAAAAAAAAAAAAAIZ2V0X2xvYW4AAAABAAAAAAAAAAhib3Jyb3dlcgAAABMAAAABAAAH0AAAAARMb2Fu",
        "AAAAAAAAAAAAAAAIZ2V0X3JvbGUAAAABAAAAAAAAAARyb2xlAAAH0AAAAARSb2xlAAAAAQAAA+gAAAAT",
        "AAAAAAAAAFZBZG1pbjogYXNzaWduIGB1bmRlcndyaXRlcmAgb3IgYHBhdXNlcmA7IGBhZG1pbmAgbW92ZXMgb25seSB2aWEgdGhlCnR3by1zdGVwIHRyYW5zZmVyLgAAAAAACHNldF9yb2xlAAAAAgAAAAAAAAAEcm9sZQAAB9AAAAAEUm9sZQAAAAAAAAAHYWNjb3VudAAAAAATAAAAAA==",
        "AAAAAQAAAI1QZXItdXNlciBwcmVtaXVtIC8gbGF0ZS1mZWUgY29uZmlnLiBgbGF0ZV9yYXRlX3Blcl9zZWNfd2FkYCBpcyB1c2VkOwpgcHJlbWl1bV9yYXRlX3Blcl9zZWNfd2FkYCBpcyByZXNlcnZlZCAoaW5lcnQpLCBrZXB0IGZvciBmb3J3YXJkLWNvbXBhdC4AAAAAAAAAAAAADVByZW1pdW1Db25maWcAAAAAAAACAAAAAAAAABVsYXRlX3JhdGVfcGVyX3NlY193YWQAAAAAAAALAAAAAAAAABhwcmVtaXVtX3JhdGVfcGVyX3NlY193YWQAAAAL",
        "AAAAAAAAAAAAAAAJaXNfcGF1c2VkAAAAAAAAAAAAAAEAAAAB",
        "AAAAAAAAAKVSZWdpc3RlciBhIGZpeGVkLXRlcm0gbG9hbi4gQ2FsbGVkIGJ5IHRoZSB2YXVsdCBpbnNpZGUgYm9ycm93X3dpdGhfdGVybSwKQUZURVIgaXQgaGFzIHB1c2hlZCBhc3NldHMgdG8gdGhlIGJvcnJvd2VyLiBBIHJldmVydCBoZXJlIHJldmVydHMgdGhlCndob2xlIGJvcnJvdyAoYXRvbWljKS4AAAAAAAAJb3Blbl9sb2FuAAAAAAAABAAAAAAAAAAIYm9ycm93ZXIAAAATAAAAAAAAAAlwcmluY2lwYWwAAAAAAAALAAAAAAAAAAp0ZW5vcl9kYXlzAAAAAAAEAAAAAAAAAAdmZWVfYnBzAAAAAAQAAAAA",
        "AAAAAAAAAAAAAAAJc2V0X3ZhdWx0AAAAAAAAAQAAAAAAAAAFdmF1bHQAAAAAAAATAAAAAA==",
        "AAAAAAAAAHRDbG9zZSB0aGUgYm9ycm93ZXIncyBhY3RpdmUgbG9hbiBhZnRlciByZXBheW1lbnQuIFZhdWx0LW9ubHkuIGBwYWlkYAptdXN0IGJlID49IGFtb3VudF9kdWUgKHdpdGggYWNjcnVlZCBsYXRlIGZlZXMpLgAAAApjbG9zZV9sb2FuAAAAAAACAAAAAAAAAAhib3Jyb3dlcgAAABMAAAAAAAAABHBhaWQAAAALAAAAAA==",
        "AAAAAAAAAQBNYXRlcmlhbGl6ZSBhY2NydWVkIGludGVyZXN0IChwcmUtZHVlLCBwcm8tcmF0YSkgYW5kIGxhdGUgZmVlcwoocG9zdC1kdWUrZ3JhY2UpIGludG8gdGhlIHN0b3JlZCBhbW91bnRfZHVlLiBJZGVtcG90ZW50LiBQZXJtaXNzaW9ubGVzcwpvbiBwdXJwb3NlIChubyBhdHRhY2sgc3VyZmFjZSwgZml4ZXMgdGhlIFYzIGtlZXBlciBsZWFrKS4gS2VlcHMgaXRzCmhpc3RvcmljYWwgbmFtZSBzbyB0aGUgZ2VuZXJhdGVkIGNsaWVudHMgZG9uJ3QgY2h1cm4uAAAAC2FjY3J1ZV9sYXRlAAAAAAEAAAAAAAAACGJvcnJvd2VyAAAAEwAAAAA=",
        "AAAAAAAAAH9QZXItdXNlciBwcmVtaXVtIC8gbGF0ZS1mZWUgY29uZmlnIChtaXJyb3JzIHRoZSBFVk0gYHByZW1pdW1zKGFkZHIpYApyZWFkIHRoZSBmcm9udGVuZCB1c2VzIHRvIGRyaXZlIHRoZSBsaXZlIGxhdGUtZmVlIHRpY2tlcikuAAAAAAtnZXRfcHJlbWl1bQAAAAABAAAAAAAAAAdhY2NvdW50AAAAABMAAAABAAAH0AAAAA1QcmVtaXVtQ29uZmlnAAAA",
        "AAAAAAAAAAAAAAAMYWNjZXB0X2FkbWluAAAAAAAAAAEAAAAT",
        "AAAAAAAAAJBFZmZlY3RpdmUgY3JlZGl0IGxpbWl0LCBmYWN0b3JpbmcgS1lDICsgZXhwaXJ5LiBUaGlzIGlzIHdoYXQgdGhlIHZhdWx0CnJlYWRzIHRvIGdhdGUgYm9ycm93aW5nIChyZXBsYWNlcyBSaXNrTWFuYWdlclVuY29sbGF0J3MgY29sbGF0ZXJhbCBob29rKS4AAAAMY3JlZGl0X2xpbWl0AAAAAQAAAAAAAAAHYWNjb3VudAAAAAATAAAAAQAAAAs=",
        "AAAAAAAAAAAAAAAMaXNfZGVmYXVsdGVkAAAAAQAAAAAAAAAIYm9ycm93ZXIAAAATAAAAAQAAAAE=",
        "AAAAAAAAAJFNYXJrIGEgbG9hbiBkZWZhdWx0ZWQgKGFkbWluIGZsYWcpLiBEb2VzIE5PVCB0b3VjaCB2YXVsdCBhY2NvdW50aW5nIOKAlCB0aGUKdmF1bHQncyBgbWFudWFsX3dyaXRlX29mZmAgZG9lcyB0aGF0IChhbmQgY2hlY2tzIGlzX2RlZmF1bHRlZCBmaXJzdCkuAAAAAAAADG1hcmtfZGVmYXVsdAAAAAEAAAAAAAAACGJvcnJvd2VyAAAAEwAAAAA=",
        "AAAAAAAAAEhWaWV3OiBhbW91bnRfZHVlIGlmIGEgcmVwYXkgaGFwcGVuZWQgbm93LCBpbmNsdWRpbmcgdW5hY2NydWVkIGxhdGUgZmVlcy4AAAAMcHJldmlld19vd2VkAAAAAQAAAAAAAAAIYm9ycm93ZXIAAAATAAAAAQAAAAs=",
        "AAAAAAAAAPtPbmUtdGltZSBjb25zdHJ1Y3Rvci4gYGFkbWluYCA9IGdvdmVybmFuY2UgKG11bHRpc2lnIGFjY291bnQpOwpgdW5kZXJ3cml0ZXJgID0gdGhlIExlbmRvb3IgYmFja2VuZCBzaWduZXIgKHJpc2ssIG9mZmVycywgcHJlbWl1bXMsCmRlZmF1bHRzKTsgYHBhdXNlcmAgPSBvbi1jYWxsIGtleSAocGF1c2UgLyB2ZXRvIG9ubHkpOwpgdmF1bHRgID0gdGhlIG9ubHkgY29udHJhY3QgYWxsb3dlZCB0byBjYWxsIG9wZW5fbG9hbi9jbG9zZV9sb2FuLgAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAUAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAALdW5kZXJ3cml0ZXIAAAAAEwAAAAAAAAAGcGF1c2VyAAAAAAATAAAAAAAAAAV2YXVsdAAAAAAAABMAAAAAAAAAEnVwZ3JhZGVfZGVsYXlfc2VjcwAAAAAABgAAAAA=",
        "AAAAAAAAAU1WYXVsdC1vbmx5LiBBcGxpY2EgdW4gcGFnbyAocGFyY2lhbCBvIHRvdGFsKSBhbCBwcmVzdGFtbyB2aXZvLCBjb24KaW1wdXRhY2lvbiBpbnRlcmVzLXByaW1lcm8uIERldnVlbHZlCihwcmluY2lwYWxfcGFnYWRvLCBpbnRlcmVzX3BhZ2Fkbywgc2FsZG9fcmVzdGFudGUpOyBzaSBlbCBzYWxkbyBsbGVnYSBhCjAgY2llcnJhIGVsIHByZXN0YW1vIChtaXNtb3MgZWZlY3RvcyBxdWUgY2xvc2VfbG9hbikuIFByZXN0YW1vcyBlbgpkZWZhdWx0OiBTT0xPIHBhZ28gdG90YWwg4oCUIGxhIGN1cmFjaW9uIHBvc3Qtd3JpdGUtb2ZmIGRlbCB2YXVsdCBhc3VtZQplbCBtb250byBjb21wbGV0by4AAAAAAAANYXBwbHlfcGF5bWVudAAAAAAAAAIAAAAAAAAACGJvcnJvd2VyAAAAEwAAAAAAAAAEcGFpZAAAAAsAAAABAAAD7QAAAAMAAAALAAAACwAAAAs=",
        "AAAAAAAAALNSYXcgc3RvcmVkIHJpc2sgcHJvZmlsZSAobWlycm9ycyB0aGUgRVZNIGB1c2VycyhhZGRyKWAgZ2V0dGVyIHRoZQpmcm9udGVuZCdzIGB1c2VDcmVkaXRMaW5lYCBwb2xscyBmb3Igc2NvcmUgLyBLWUMgLyBsaW1pdCkuIFJldHVybnMgYQp6ZXJvZWQgcHJvZmlsZSBpZiB0aGUgdXNlciB3YXMgbmV2ZXIgc2NvcmVkLgAAAAANZ2V0X3VzZXJfcmlzawAAAAAAAAEAAAAAAAAAB2FjY291bnQAAAAAEwAAAAEAAAfQAAAACFVzZXJSaXNr",
        "AAAAAAAAAC9Xcml0ZSB0aGUgb2ZmLWNoYWluIG1vZGVsJ3MgdmVyZGljdCBmb3IgYSB1c2VyLgAAAAANc2V0X3VzZXJfcmlzawAAAAAAAAUAAAAAAAAAB2FjY291bnQAAAAAEwAAAAAAAAAFc2NvcmUAAAAAAAAEAAAAAAAAAAZreWNfb2sAAAAAAAEAAAAAAAAAC3ZhbGlkX3VudGlsAAAAAAYAAAAAAAAABWxpbWl0AAAAAAAACwAAAAA=",
        "AAAAAAAAAAAAAAANdXBncmFkZV9kZWxheQAAAAAAAAAAAAABAAAABg==",
        "AAAAAAAAAAAAAAAOY2FuY2VsX3VwZ3JhZGUAAAAAAAEAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAA=",
        "AAAAAAAAAAAAAAAOc2V0X2xvYW5fb2ZmZXIAAAAAAAUAAAAAAAAACGJvcnJvd2VyAAAAEwAAAAAAAAAKdGVub3JfZGF5cwAAAAAABAAAAAAAAAAHZmVlX2JwcwAAAAAEAAAAAAAAAAt2YWxpZF91bnRpbAAAAAAGAAAAAAAAAAptYXhfYW1vdW50AAAAAAALAAAAAA==",
        "AAAAAAAAAAAAAAAOdHJhbnNmZXJfYWRtaW4AAAAAAAEAAAAAAAAACW5ld19hZG1pbgAAAAAAABMAAAAA",
        "AAAAAAAAAAAAAAAPZXhlY3V0ZV91cGdyYWRlAAAAAAEAAAAAAAAADW5ld193YXNtX2hhc2gAAAAAAAPuAAAAIAAAAAA=",
        "AAAAAAAAAAAAAAAPcGVuZGluZ191cGdyYWRlAAAAAAAAAAABAAAD6AAAB9AAAAAOUGVuZGluZ1VwZ3JhZGUAAA==",
        "AAAAAAAAAAAAAAAPcHJvcG9zZV91cGdyYWRlAAAAAAEAAAAAAAAADW5ld193YXNtX2hhc2gAAAAAAAPuAAAAIAAAAAEAAAAG",
        "AAAAAAAAAHJFYXJsaWVzdCB0aW1lc3RhbXAgYXQgd2hpY2ggYGFjY291bnRgIG1heSBvcGVuIGEgbmV3IGxvYW4gKGNvb2xkb3duKS4KTWlycm9ycyB0aGUgRVZNIGBuZXh0Qm9ycm93VGltZShhZGRyKWAgcmVhZC4AAAAAABBuZXh0X2JvcnJvd190aW1lAAAAAQAAAAAAAAAHYWNjb3VudAAAAAATAAAAAQAAAAY=",
        "AAAAAAAAAAAAAAASc2V0X3ByZW1pdW1fY29uZmlnAAAAAAADAAAAAAAAAAhib3Jyb3dlcgAAABMAAAAAAAAAGHByZW1pdW1fcmF0ZV9wZXJfc2VjX3dhZAAAAAsAAAAAAAAAFWxhdGVfcmF0ZV9wZXJfc2VjX3dhZAAAAAAAAAsAAAAA",
        "AAAAAAAAAAAAAAAVY2FuY2VsX2FkbWluX3RyYW5zZmVyAAAAAAAAAAAAAAA=",
        "AAAAAAAAAHpgKHByaW5jaXBhbCwgYW1vdW50X2R1ZV93aXRoX2xhdGUpYCDigJQgbWlycm9ycyB0aGUgRVZNCmBwcmV2aWV3TG9hbldpdGhMYXRlKGFkZHIpYCB0dXBsZSB0aGUgZnJvbnRlbmQgcmVhZHMgZm9yIHJlcGF5IFVYLgAAAAAAFnByZXZpZXdfbG9hbl93aXRoX2xhdGUAAAAAAAEAAAAAAAAACGJvcnJvd2VyAAAAEwAAAAEAAAPtAAAAAgAAAAsAAAAL",
        "AAAAAAAAAAAAAAAWc2V0X21pbl9ob2xkX2Zvcl90ZW5vcgAAAAAAAgAAAAAAAAAKdGVub3JfZGF5cwAAAAAABAAAAAAAAAANbWluX2hvbGRfZGF5cwAAAAAAAAQAAAAA",
        "AAAAAAAAAAAAAAAYc2V0X2RlZmF1bHRfZ3JhY2VfcGVyaW9kAAAAAQAAAAAAAAAEc2VjcwAAAAYAAAAA",
        "AAAAAgAAAAAAAAAAAAAABFJvbGUAAAAEAAAAAAAAAAAAAAAFQWRtaW4AAAAAAAAAAAAAAAAAAAtVbmRlcndyaXRlcgAAAAAAAAAAAAAAAAhPcGVyYXRvcgAAAAAAAAAAAAAABlBhdXNlcgAA",
        "AAAAAgAAAKlJbnN0YW5jZS1zdG9yYWdlIGtleXMuIEEgc2VwYXJhdGUgZW51bSBmcm9tIHRoZSBjb250cmFjdCdzIGBEYXRhS2V5YCwgc28gdGhlCnR3byBjYW4gY29leGlzdCBpbiB0aGUgc2FtZSBpbnN0YW5jZSBtYXAgKHZhcmlhbnQgbmFtZXMgZGlmZmVyLCBzbyB0aGUKZW5jb2RlZCBrZXlzIGRpZmZlcikuAAAAAAAAAAAAAAZHb3ZLZXkAAAAAAAUAAAABAAAAAAAAAARSb2xlAAAAAQAAB9AAAAAEUm9sZQAAAAAAAAAAAAAADFBlbmRpbmdBZG1pbgAAAAAAAAAAAAAABlBhdXNlZAAAAAAAAAAAAAAAAAAOUGVuZGluZ1VwZ3JhZGUAAAAAAAAAAAAAAAAADFVwZ3JhZGVEZWxheQ==",
        "AAAABAAAAGpFcnJvciBjb2RlcyAxMDHigJMxMTAgYXJlIHJlc2VydmVkIGZvciBnb3Zlcm5hbmNlIHNvIHRoZXkgbmV2ZXIgb3ZlcmxhcCB0aGUKY29udHJhY3RzJyBvd24gZW51bXMgKDHigJM5OSkuAAAAAAAAAAAACEdvdkVycm9yAAAACgAAAAAAAAAMVW5hdXRob3JpemVkAAAAZQAAAAAAAAAGUGF1c2VkAAAAAABmAAAAAAAAAAlOb3RQYXVzZWQAAAAAAABnAAAAAAAAAA5Ob1BlbmRpbmdBZG1pbgAAAAAAaAAAAAAAAAAQTm9QZW5kaW5nVXBncmFkZQAAAGkAAAAAAAAAEFRpbWVsb2NrTm90UmVhZHkAAABqAAAAAAAAABNVcGdyYWRlSGFzaE1pc21hdGNoAAAAAGsAAAAAAAAADURlbGF5VG9vU2hvcnQAAAAAAABsAAAAAAAAAApSb2xlTm90U2V0AAAAAABtAAAAAAAAAAxNYXRoT3ZlcmZsb3cAAABu",
        "AAAAAQAAAAAAAAAAAAAADlBlbmRpbmdVcGdyYWRlAAAAAAACAAAAAAAAAANldGEAAAAABgAAAAAAAAAJd2FzbV9oYXNoAAAAAAAD7gAAACA=" ]),
      options
    )
  }
  public readonly fromJSON = {
    pause: this.txFromJSON<null>,
        unpause: this.txFromJSON<null>,
        get_loan: this.txFromJSON<Loan>,
        get_role: this.txFromJSON<Option<string>>,
        set_role: this.txFromJSON<null>,
        is_paused: this.txFromJSON<boolean>,
        open_loan: this.txFromJSON<null>,
        set_vault: this.txFromJSON<null>,
        close_loan: this.txFromJSON<null>,
        accrue_late: this.txFromJSON<null>,
        get_premium: this.txFromJSON<PremiumConfig>,
        accept_admin: this.txFromJSON<string>,
        credit_limit: this.txFromJSON<i128>,
        is_defaulted: this.txFromJSON<boolean>,
        mark_default: this.txFromJSON<null>,
        preview_owed: this.txFromJSON<i128>,
        apply_payment: this.txFromJSON<readonly [i128, i128, i128]>,
        get_user_risk: this.txFromJSON<UserRisk>,
        set_user_risk: this.txFromJSON<null>,
        upgrade_delay: this.txFromJSON<u64>,
        cancel_upgrade: this.txFromJSON<null>,
        set_loan_offer: this.txFromJSON<null>,
        transfer_admin: this.txFromJSON<null>,
        execute_upgrade: this.txFromJSON<null>,
        pending_upgrade: this.txFromJSON<Option<PendingUpgrade>>,
        propose_upgrade: this.txFromJSON<u64>,
        next_borrow_time: this.txFromJSON<u64>,
        set_premium_config: this.txFromJSON<null>,
        cancel_admin_transfer: this.txFromJSON<null>,
        preview_loan_with_late: this.txFromJSON<readonly [i128, i128]>,
        set_min_hold_for_tenor: this.txFromJSON<null>,
        set_default_grace_period: this.txFromJSON<null>
  }
}