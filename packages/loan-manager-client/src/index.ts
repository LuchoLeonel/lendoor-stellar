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
    contractId: "CDBB3B6PZAV5OH7NACXQTL3YLZLJ3NNUMHCMFV54WIR6MDCO6GKGFSCJ",
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
  18: {message:"InvalidParam"}
}


/**
 * Global config (instance storage).
 */
export interface Config {
  default_grace_period: u64;
  default_late_period: u64;
  vault: string;
}

export type DataKey = {tag: "Owner", values: void} | {tag: "Config", values: void} | {tag: "MinHold", values: readonly [u32]} | {tag: "Risk", values: readonly [string]} | {tag: "Offer", values: readonly [string]} | {tag: "Loan", values: readonly [string]} | {tag: "Premium", values: readonly [string]} | {tag: "NextBorrow", values: readonly [string]};


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

export interface Client {
  /**
   * Construct and simulate a upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Upgrade the contract Wasm (Soroban-native, replaces UUPS). Owner-gated.
   */
  upgrade: ({new_wasm_hash}: {new_wasm_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_loan transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_loan: ({borrower}: {borrower: string}, options?: MethodOptions) => Promise<AssembledTransaction<Loan>>

  /**
   * Construct and simulate a open_loan transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Register a fixed-term loan. Called by the vault inside borrow_with_term,
   * AFTER it has pushed assets to the borrower. A revert here reverts the
   * whole borrow (atomic).
   */
  open_loan: ({borrower, principal, tenor_days, fee_bps}: {borrower: string, principal: i128, tenor_days: u32, fee_bps: u32}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a set_owner transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_owner: ({new_owner}: {new_owner: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

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
   * Materialize accrued late fees into the stored amount_due. Idempotent.
   * Permissionless on purpose (no attack surface, fixes the V3 keeper leak).
   */
  accrue_late: ({borrower}: {borrower: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_premium transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Per-user premium / late-fee config (mirrors the EVM `premiums(addr)`
   * read the frontend uses to drive the live late-fee ticker).
   */
  get_premium: ({account}: {account: string}, options?: MethodOptions) => Promise<AssembledTransaction<PremiumConfig>>

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
   * Construct and simulate a set_loan_offer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_loan_offer: ({borrower, tenor_days, fee_bps, valid_until, max_amount}: {borrower: string, tenor_days: u32, fee_bps: u32, valid_until: u64, max_amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

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
        {owner, vault}: {owner: string, vault: string},
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
    return ContractClient.deploy({owner, vault}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAQAAADpUaGUgc2luZ2xlIGFjdGl2ZSAob3IgbW9zdC1yZWNlbnRseS1jbG9zZWQpIGxvYW4gcGVyIHVzZXIuAAAAAAAAAAAABExvYW4AAAAKAAAAAAAAAAZhY3RpdmUAAAAAAAEAAAAAAAAACmFtb3VudF9kdWUAAAAAAAsAAAAAAAAACWRlZmF1bHRlZAAAAAAAAAEAAAAAAAAAA2R1ZQAAAAAGAAAAAAAAAAdmZWVfYnBzAAAAAAQAAAAAAAAADGdyYWNlX3BlcmlvZAAAAAYAAAAAAAAADGxhc3RfYWNjcnVlZAAAAAYAAAAAAAAACXByaW5jaXBhbAAAAAAAAAsAAAAAAAAABXN0YXJ0AAAAAAAABgAAAAAAAAAKdGVub3JfZGF5cwAAAAAABA==",
        "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAAEgAAAAAAAAASQWxyZWFkeUluaXRpYWxpemVkAAAAAAABAAAAAAAAAA5Ob3RJbml0aWFsaXplZAAAAAAAAgAAAAAAAAANTm90QXV0aG9yaXplZAAAAAAAAAMAAAAAAAAAC1plcm9BZGRyZXNzAAAAAAQAAAAAAAAADVplcm9QcmluY2lwYWwAAAAAAAAFAAAAAAAAAAhDb29sZG93bgAAAAYAAAAAAAAACkxvYW5BY3RpdmUAAAAAAAcAAAAAAAAAD092ZXJDcmVkaXRMaW1pdAAAAAAIAAAAAAAAAAdOb09mZmVyAAAAAAkAAAAAAAAADE9mZmVyRXhwaXJlZAAAAAoAAAAAAAAACEJhZFRlbm9yAAAACwAAAAAAAAAGQmFkRmVlAAAAAAAMAAAAAAAAAAlPdmVyT2ZmZXIAAAAAAAANAAAAAAAAAAxOb0FjdGl2ZUxvYW4AAAAOAAAAAAAAABBBbHJlYWR5RGVmYXVsdGVkAAAADwAAAAAAAAARVG9vRWFybHlUb0RlZmF1bHQAAAAAAAAQAAAAAAAAAAlVbmRlcnBhaWQAAAAAAAARAAAAAAAAAAxJbnZhbGlkUGFyYW0AAAAS",
        "AAAAAQAAACFHbG9iYWwgY29uZmlnIChpbnN0YW5jZSBzdG9yYWdlKS4AAAAAAAAAAAAABkNvbmZpZwAAAAAAAwAAAAAAAAAUZGVmYXVsdF9ncmFjZV9wZXJpb2QAAAAGAAAAAAAAABNkZWZhdWx0X2xhdGVfcGVyaW9kAAAAAAYAAAAAAAAABXZhdWx0AAAAAAAAEw==",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAACAAAAAAAAAAAAAAABU93bmVyAAAAAAAAAAAAAAAAAAAGQ29uZmlnAAAAAAABAAAAAAAAAAdNaW5Ib2xkAAAAAAEAAAAEAAAAAQAAAAAAAAAEUmlzawAAAAEAAAATAAAAAQAAAAAAAAAFT2ZmZXIAAAAAAAABAAAAEwAAAAEAAAAAAAAABExvYW4AAAABAAAAEwAAAAEAAAAAAAAAB1ByZW1pdW0AAAAAAQAAABMAAAABAAAAAAAAAApOZXh0Qm9ycm93AAAAAAABAAAAEw==",
        "AAAAAQAAAIJQZXItdXNlciByaXNrIHByb2ZpbGUgd3JpdHRlbiBieSB0aGUgb2ZmLWNoYWluIG1vZGVsLiBgbGltaXRgIGlzIGluIHRoZQphc3NldCdzIHNtYWxsZXN0IHVuaXQgKFVTREMgPSA2IGRlY2ltYWxzOiAxXzAwMF8wMDAgPSAkMSkuAAAAAAAAAAAACFVzZXJSaXNrAAAABQAAAAAAAAAGa3ljX29rAAAAAAABAAAAAAAAAAtsYXN0X3VwZGF0ZQAAAAAGAAAAAAAAAAVsaW1pdAAAAAAAAAsAAAAAAAAABXNjb3JlAAAAAAAABAAAAAAAAAALdmFsaWRfdW50aWwAAAAABg==",
        "AAAAAQAAAEpPbmUtc2hvdCBsb2FuIG9mZmVyLiBDcmVhdGVkIGJ5IGBzZXRfbG9hbl9vZmZlcmAsIGNvbnN1bWVkIGJ5IGBvcGVuX2xvYW5gLgAAAAAAAAAAAAlMb2FuT2ZmZXIAAAAAAAAEAAAAAAAAAAdmZWVfYnBzAAAAAAQAAAAAAAAACm1heF9hbW91bnQAAAAAAAsAAAAAAAAACnRlbm9yX2RheXMAAAAAAAQAAAAAAAAAC3ZhbGlkX3VudGlsAAAAAAY=",
        "AAAAAAAAAEdVcGdyYWRlIHRoZSBjb250cmFjdCBXYXNtIChTb3JvYmFuLW5hdGl2ZSwgcmVwbGFjZXMgVVVQUykuIE93bmVyLWdhdGVkLgAAAAAHdXBncmFkZQAAAAABAAAAAAAAAA1uZXdfd2FzbV9oYXNoAAAAAAAD7gAAACAAAAAA",
        "AAAAAAAAAAAAAAAIZ2V0X2xvYW4AAAABAAAAAAAAAAhib3Jyb3dlcgAAABMAAAABAAAH0AAAAARMb2Fu",
        "AAAAAQAAAI1QZXItdXNlciBwcmVtaXVtIC8gbGF0ZS1mZWUgY29uZmlnLiBgbGF0ZV9yYXRlX3Blcl9zZWNfd2FkYCBpcyB1c2VkOwpgcHJlbWl1bV9yYXRlX3Blcl9zZWNfd2FkYCBpcyByZXNlcnZlZCAoaW5lcnQpLCBrZXB0IGZvciBmb3J3YXJkLWNvbXBhdC4AAAAAAAAAAAAADVByZW1pdW1Db25maWcAAAAAAAACAAAAAAAAABVsYXRlX3JhdGVfcGVyX3NlY193YWQAAAAAAAALAAAAAAAAABhwcmVtaXVtX3JhdGVfcGVyX3NlY193YWQAAAAL",
        "AAAAAAAAAKVSZWdpc3RlciBhIGZpeGVkLXRlcm0gbG9hbi4gQ2FsbGVkIGJ5IHRoZSB2YXVsdCBpbnNpZGUgYm9ycm93X3dpdGhfdGVybSwKQUZURVIgaXQgaGFzIHB1c2hlZCBhc3NldHMgdG8gdGhlIGJvcnJvd2VyLiBBIHJldmVydCBoZXJlIHJldmVydHMgdGhlCndob2xlIGJvcnJvdyAoYXRvbWljKS4AAAAAAAAJb3Blbl9sb2FuAAAAAAAABAAAAAAAAAAIYm9ycm93ZXIAAAATAAAAAAAAAAlwcmluY2lwYWwAAAAAAAALAAAAAAAAAAp0ZW5vcl9kYXlzAAAAAAAEAAAAAAAAAAdmZWVfYnBzAAAAAAQAAAAA",
        "AAAAAAAAAAAAAAAJc2V0X293bmVyAAAAAAAAAQAAAAAAAAAJbmV3X293bmVyAAAAAAAAEwAAAAA=",
        "AAAAAAAAAAAAAAAJc2V0X3ZhdWx0AAAAAAAAAQAAAAAAAAAFdmF1bHQAAAAAAAATAAAAAA==",
        "AAAAAAAAAHRDbG9zZSB0aGUgYm9ycm93ZXIncyBhY3RpdmUgbG9hbiBhZnRlciByZXBheW1lbnQuIFZhdWx0LW9ubHkuIGBwYWlkYAptdXN0IGJlID49IGFtb3VudF9kdWUgKHdpdGggYWNjcnVlZCBsYXRlIGZlZXMpLgAAAApjbG9zZV9sb2FuAAAAAAACAAAAAAAAAAhib3Jyb3dlcgAAABMAAAAAAAAABHBhaWQAAAALAAAAAA==",
        "AAAAAAAAAI5NYXRlcmlhbGl6ZSBhY2NydWVkIGxhdGUgZmVlcyBpbnRvIHRoZSBzdG9yZWQgYW1vdW50X2R1ZS4gSWRlbXBvdGVudC4KUGVybWlzc2lvbmxlc3Mgb24gcHVycG9zZSAobm8gYXR0YWNrIHN1cmZhY2UsIGZpeGVzIHRoZSBWMyBrZWVwZXIgbGVhaykuAAAAAAALYWNjcnVlX2xhdGUAAAAAAQAAAAAAAAAIYm9ycm93ZXIAAAATAAAAAA==",
        "AAAAAAAAAH9QZXItdXNlciBwcmVtaXVtIC8gbGF0ZS1mZWUgY29uZmlnIChtaXJyb3JzIHRoZSBFVk0gYHByZW1pdW1zKGFkZHIpYApyZWFkIHRoZSBmcm9udGVuZCB1c2VzIHRvIGRyaXZlIHRoZSBsaXZlIGxhdGUtZmVlIHRpY2tlcikuAAAAAAtnZXRfcHJlbWl1bQAAAAABAAAAAAAAAAdhY2NvdW50AAAAABMAAAABAAAH0AAAAA1QcmVtaXVtQ29uZmlnAAAA",
        "AAAAAAAAAJBFZmZlY3RpdmUgY3JlZGl0IGxpbWl0LCBmYWN0b3JpbmcgS1lDICsgZXhwaXJ5LiBUaGlzIGlzIHdoYXQgdGhlIHZhdWx0CnJlYWRzIHRvIGdhdGUgYm9ycm93aW5nIChyZXBsYWNlcyBSaXNrTWFuYWdlclVuY29sbGF0J3MgY29sbGF0ZXJhbCBob29rKS4AAAAMY3JlZGl0X2xpbWl0AAAAAQAAAAAAAAAHYWNjb3VudAAAAAATAAAAAQAAAAs=",
        "AAAAAAAAAAAAAAAMaXNfZGVmYXVsdGVkAAAAAQAAAAAAAAAIYm9ycm93ZXIAAAATAAAAAQAAAAE=",
        "AAAAAAAAAJFNYXJrIGEgbG9hbiBkZWZhdWx0ZWQgKGFkbWluIGZsYWcpLiBEb2VzIE5PVCB0b3VjaCB2YXVsdCBhY2NvdW50aW5nIOKAlCB0aGUKdmF1bHQncyBgbWFudWFsX3dyaXRlX29mZmAgZG9lcyB0aGF0IChhbmQgY2hlY2tzIGlzX2RlZmF1bHRlZCBmaXJzdCkuAAAAAAAADG1hcmtfZGVmYXVsdAAAAAEAAAAAAAAACGJvcnJvd2VyAAAAEwAAAAA=",
        "AAAAAAAAAEhWaWV3OiBhbW91bnRfZHVlIGlmIGEgcmVwYXkgaGFwcGVuZWQgbm93LCBpbmNsdWRpbmcgdW5hY2NydWVkIGxhdGUgZmVlcy4AAAAMcHJldmlld19vd2VkAAAAAQAAAAAAAAAIYm9ycm93ZXIAAAATAAAAAQAAAAs=",
        "AAAAAAAAAIRPbmUtdGltZSBjb25zdHJ1Y3Rvci4gYG93bmVyYCA9IG9wZXJhdG9yIChMZW5kb29yIGJhY2tlbmQgc2lnbmVyKTsKYHZhdWx0YCA9IHRoZSBvbmx5IGNvbnRyYWN0IGFsbG93ZWQgdG8gY2FsbCBvcGVuX2xvYW4vY2xvc2VfbG9hbi4AAAANX19jb25zdHJ1Y3RvcgAAAAAAAAIAAAAAAAAABW93bmVyAAAAAAAAEwAAAAAAAAAFdmF1bHQAAAAAAAATAAAAAA==",
        "AAAAAAAAALNSYXcgc3RvcmVkIHJpc2sgcHJvZmlsZSAobWlycm9ycyB0aGUgRVZNIGB1c2VycyhhZGRyKWAgZ2V0dGVyIHRoZQpmcm9udGVuZCdzIGB1c2VDcmVkaXRMaW5lYCBwb2xscyBmb3Igc2NvcmUgLyBLWUMgLyBsaW1pdCkuIFJldHVybnMgYQp6ZXJvZWQgcHJvZmlsZSBpZiB0aGUgdXNlciB3YXMgbmV2ZXIgc2NvcmVkLgAAAAANZ2V0X3VzZXJfcmlzawAAAAAAAAEAAAAAAAAAB2FjY291bnQAAAAAEwAAAAEAAAfQAAAACFVzZXJSaXNr",
        "AAAAAAAAAC9Xcml0ZSB0aGUgb2ZmLWNoYWluIG1vZGVsJ3MgdmVyZGljdCBmb3IgYSB1c2VyLgAAAAANc2V0X3VzZXJfcmlzawAAAAAAAAUAAAAAAAAAB2FjY291bnQAAAAAEwAAAAAAAAAFc2NvcmUAAAAAAAAEAAAAAAAAAAZreWNfb2sAAAAAAAEAAAAAAAAAC3ZhbGlkX3VudGlsAAAAAAYAAAAAAAAABWxpbWl0AAAAAAAACwAAAAA=",
        "AAAAAAAAAAAAAAAOc2V0X2xvYW5fb2ZmZXIAAAAAAAUAAAAAAAAACGJvcnJvd2VyAAAAEwAAAAAAAAAKdGVub3JfZGF5cwAAAAAABAAAAAAAAAAHZmVlX2JwcwAAAAAEAAAAAAAAAAt2YWxpZF91bnRpbAAAAAAGAAAAAAAAAAptYXhfYW1vdW50AAAAAAALAAAAAA==",
        "AAAAAAAAAHJFYXJsaWVzdCB0aW1lc3RhbXAgYXQgd2hpY2ggYGFjY291bnRgIG1heSBvcGVuIGEgbmV3IGxvYW4gKGNvb2xkb3duKS4KTWlycm9ycyB0aGUgRVZNIGBuZXh0Qm9ycm93VGltZShhZGRyKWAgcmVhZC4AAAAAABBuZXh0X2JvcnJvd190aW1lAAAAAQAAAAAAAAAHYWNjb3VudAAAAAATAAAAAQAAAAY=",
        "AAAAAAAAAAAAAAASc2V0X3ByZW1pdW1fY29uZmlnAAAAAAADAAAAAAAAAAhib3Jyb3dlcgAAABMAAAAAAAAAGHByZW1pdW1fcmF0ZV9wZXJfc2VjX3dhZAAAAAsAAAAAAAAAFWxhdGVfcmF0ZV9wZXJfc2VjX3dhZAAAAAAAAAsAAAAA",
        "AAAAAAAAAHpgKHByaW5jaXBhbCwgYW1vdW50X2R1ZV93aXRoX2xhdGUpYCDigJQgbWlycm9ycyB0aGUgRVZNCmBwcmV2aWV3TG9hbldpdGhMYXRlKGFkZHIpYCB0dXBsZSB0aGUgZnJvbnRlbmQgcmVhZHMgZm9yIHJlcGF5IFVYLgAAAAAAFnByZXZpZXdfbG9hbl93aXRoX2xhdGUAAAAAAAEAAAAAAAAACGJvcnJvd2VyAAAAEwAAAAEAAAPtAAAAAgAAAAsAAAAL",
        "AAAAAAAAAAAAAAAWc2V0X21pbl9ob2xkX2Zvcl90ZW5vcgAAAAAAAgAAAAAAAAAKdGVub3JfZGF5cwAAAAAABAAAAAAAAAANbWluX2hvbGRfZGF5cwAAAAAAAAQAAAAA",
        "AAAAAAAAAAAAAAAYc2V0X2RlZmF1bHRfZ3JhY2VfcGVyaW9kAAAAAQAAAAAAAAAEc2VjcwAAAAYAAAAA" ]),
      options
    )
  }
  public readonly fromJSON = {
    upgrade: this.txFromJSON<null>,
        get_loan: this.txFromJSON<Loan>,
        open_loan: this.txFromJSON<null>,
        set_owner: this.txFromJSON<null>,
        set_vault: this.txFromJSON<null>,
        close_loan: this.txFromJSON<null>,
        accrue_late: this.txFromJSON<null>,
        get_premium: this.txFromJSON<PremiumConfig>,
        credit_limit: this.txFromJSON<i128>,
        is_defaulted: this.txFromJSON<boolean>,
        mark_default: this.txFromJSON<null>,
        preview_owed: this.txFromJSON<i128>,
        get_user_risk: this.txFromJSON<UserRisk>,
        set_user_risk: this.txFromJSON<null>,
        set_loan_offer: this.txFromJSON<null>,
        next_borrow_time: this.txFromJSON<u64>,
        set_premium_config: this.txFromJSON<null>,
        preview_loan_with_late: this.txFromJSON<readonly [i128, i128]>,
        set_min_hold_for_tenor: this.txFromJSON<null>,
        set_default_grace_period: this.txFromJSON<null>
  }
}