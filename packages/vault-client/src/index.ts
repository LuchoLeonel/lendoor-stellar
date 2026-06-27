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
    contractId: "CDVWUWSBHFVQGPCZGLBRTHDDIJBKWLXTVC2QIPXG6UJWNDFGZUP7S7KO",
  }
} as const


/**
 * Mirror of loan-manager's `Loan` (same SCVal layout for cross-contract reads).
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
  3: {message:"ZeroAmount"},
  4: {message:"InsufficientCash"},
  5: {message:"InsufficientShares"},
  6: {message:"OverCreditLimit"},
  7: {message:"NoActiveLoan"},
  8: {message:"NotDefaulted"}
}


export interface Config {
  fee_recipient: string;
  loan_manager: string;
  owner: string;
  usdc: string;
}

export type DataKey = {tag: "Config", values: void} | {tag: "TotalShares", values: void} | {tag: "TotalBorrows", values: void} | {tag: "Shares", values: readonly [string]} | {tag: "WrittenOff", values: readonly [string]};

export interface Client {
  /**
   * Construct and simulate a repay transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Full repayment only (mirrors EVK MustRepayFullAmountDue). `payer` funds
   * the loan of `borrower`. 5% protocol fee on the interest portion.
   */
  repay: ({payer, borrower}: {payer: string, borrower: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a redeem transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * ERC-4626 `redeem`: burn an EXACT `shares` amount, receive floor(assets).
   * Useful for "withdraw everything" (redeem the full share balance).
   */
  redeem: ({from, shares}: {from: string, shares: i128}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a deposit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  deposit: ({from, assets}: {from: string, assets: i128}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  upgrade: ({new_wasm_hash}: {new_wasm_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a withdraw transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * ERC-4626 `withdraw`: burn shares to receive an EXACT `assets` amount of
   * USDC. This is the entry point the frontend uses (`evault.withdraw(amount,
   * receiver, owner)` — the user types a USDC amount). Returns shares burned.
   */
  withdraw: ({from, assets}: {from: string, assets: i128}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a balance_of transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Share balance of `account` (mirrors the EVM EVault `balanceOf`).
   */
  balance_of: ({account}: {account: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a total_assets transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  total_assets: (options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a total_supply transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Total shares outstanding (mirrors the EVM EVault `totalSupply`).
   */
  total_supply: (options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a borrow_with_term transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Only entry point to take a loan. Inline credit check + atomic open_loan.
   */
  borrow_with_term: ({borrower, amount, tenor_days, fee_bps}: {borrower: string, amount: i128, tenor_days: u32, fee_bps: u32}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a manual_write_off transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Recognize a defaulted loan's loss in vault accounting. Owner-gated.
   * Requires the loan-manager to have flagged the borrower defaulted.
   */
  manual_write_off: ({borrower, amount}: {borrower: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a set_fee_recipient transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_fee_recipient: ({recipient}: {recipient: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {owner, usdc, loan_manager, fee_recipient}: {owner: string, usdc: string, loan_manager: string, fee_recipient: string},
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
    return ContractClient.deploy({owner, usdc, loan_manager, fee_recipient}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAQAAAE1NaXJyb3Igb2YgbG9hbi1tYW5hZ2VyJ3MgYExvYW5gIChzYW1lIFNDVmFsIGxheW91dCBmb3IgY3Jvc3MtY29udHJhY3QgcmVhZHMpLgAAAAAAAAAAAAAETG9hbgAAAAoAAAAAAAAABmFjdGl2ZQAAAAAAAQAAAAAAAAAKYW1vdW50X2R1ZQAAAAAACwAAAAAAAAAJZGVmYXVsdGVkAAAAAAAAAQAAAAAAAAADZHVlAAAAAAYAAAAAAAAAB2ZlZV9icHMAAAAABAAAAAAAAAAMZ3JhY2VfcGVyaW9kAAAABgAAAAAAAAAMbGFzdF9hY2NydWVkAAAABgAAAAAAAAAJcHJpbmNpcGFsAAAAAAAACwAAAAAAAAAFc3RhcnQAAAAAAAAGAAAAAAAAAAp0ZW5vcl9kYXlzAAAAAAAE",
        "AAAAAAAAAIhGdWxsIHJlcGF5bWVudCBvbmx5IChtaXJyb3JzIEVWSyBNdXN0UmVwYXlGdWxsQW1vdW50RHVlKS4gYHBheWVyYCBmdW5kcwp0aGUgbG9hbiBvZiBgYm9ycm93ZXJgLiA1JSBwcm90b2NvbCBmZWUgb24gdGhlIGludGVyZXN0IHBvcnRpb24uAAAABXJlcGF5AAAAAAAAAgAAAAAAAAAFcGF5ZXIAAAAAAAATAAAAAAAAAAhib3Jyb3dlcgAAABMAAAABAAAACw==",
        "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAACAAAAAAAAAASQWxyZWFkeUluaXRpYWxpemVkAAAAAAABAAAAAAAAAA5Ob3RJbml0aWFsaXplZAAAAAAAAgAAAAAAAAAKWmVyb0Ftb3VudAAAAAAAAwAAAAAAAAAQSW5zdWZmaWNpZW50Q2FzaAAAAAQAAAAAAAAAEkluc3VmZmljaWVudFNoYXJlcwAAAAAABQAAAAAAAAAPT3ZlckNyZWRpdExpbWl0AAAAAAYAAAAAAAAADE5vQWN0aXZlTG9hbgAAAAcAAAAAAAAADE5vdERlZmF1bHRlZAAAAAg=",
        "AAAAAAAAAIpFUkMtNDYyNiBgcmVkZWVtYDogYnVybiBhbiBFWEFDVCBgc2hhcmVzYCBhbW91bnQsIHJlY2VpdmUgZmxvb3IoYXNzZXRzKS4KVXNlZnVsIGZvciAid2l0aGRyYXcgZXZlcnl0aGluZyIgKHJlZGVlbSB0aGUgZnVsbCBzaGFyZSBiYWxhbmNlKS4AAAAAAAZyZWRlZW0AAAAAAAIAAAAAAAAABGZyb20AAAATAAAAAAAAAAZzaGFyZXMAAAAAAAsAAAABAAAACw==",
        "AAAAAQAAAAAAAAAAAAAABkNvbmZpZwAAAAAABAAAAAAAAAANZmVlX3JlY2lwaWVudAAAAAAAABMAAAAAAAAADGxvYW5fbWFuYWdlcgAAABMAAAAAAAAABW93bmVyAAAAAAAAEwAAAAAAAAAEdXNkYwAAABM=",
        "AAAAAAAAAAAAAAAHZGVwb3NpdAAAAAACAAAAAAAAAARmcm9tAAAAEwAAAAAAAAAGYXNzZXRzAAAAAAALAAAAAQAAAAs=",
        "AAAAAAAAAAAAAAAHdXBncmFkZQAAAAABAAAAAAAAAA1uZXdfd2FzbV9oYXNoAAAAAAAD7gAAACAAAAAA",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAABQAAAAAAAAAAAAAABkNvbmZpZwAAAAAAAAAAAAAAAAALVG90YWxTaGFyZXMAAAAAAAAAAAAAAAAMVG90YWxCb3Jyb3dzAAAAAQAAAAAAAAAGU2hhcmVzAAAAAAABAAAAEwAAAAEAAAAAAAAACldyaXR0ZW5PZmYAAAAAAAEAAAAT",
        "AAAAAAAAAN1FUkMtNDYyNiBgd2l0aGRyYXdgOiBidXJuIHNoYXJlcyB0byByZWNlaXZlIGFuIEVYQUNUIGBhc3NldHNgIGFtb3VudCBvZgpVU0RDLiBUaGlzIGlzIHRoZSBlbnRyeSBwb2ludCB0aGUgZnJvbnRlbmQgdXNlcyAoYGV2YXVsdC53aXRoZHJhdyhhbW91bnQsCnJlY2VpdmVyLCBvd25lcilgIOKAlCB0aGUgdXNlciB0eXBlcyBhIFVTREMgYW1vdW50KS4gUmV0dXJucyBzaGFyZXMgYnVybmVkLgAAAAAAAAh3aXRoZHJhdwAAAAIAAAAAAAAABGZyb20AAAATAAAAAAAAAAZhc3NldHMAAAAAAAsAAAABAAAACw==",
        "AAAAAAAAAEBTaGFyZSBiYWxhbmNlIG9mIGBhY2NvdW50YCAobWlycm9ycyB0aGUgRVZNIEVWYXVsdCBgYmFsYW5jZU9mYCkuAAAACmJhbGFuY2Vfb2YAAAAAAAEAAAAAAAAAB2FjY291bnQAAAAAEwAAAAEAAAAL",
        "AAAAAAAAAAAAAAAMdG90YWxfYXNzZXRzAAAAAAAAAAEAAAAL",
        "AAAAAAAAAEBUb3RhbCBzaGFyZXMgb3V0c3RhbmRpbmcgKG1pcnJvcnMgdGhlIEVWTSBFVmF1bHQgYHRvdGFsU3VwcGx5YCkuAAAADHRvdGFsX3N1cHBseQAAAAAAAAABAAAACw==",
        "AAAAAAAAAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAQAAAAAAAAABW93bmVyAAAAAAAAEwAAAAAAAAAEdXNkYwAAABMAAAAAAAAADGxvYW5fbWFuYWdlcgAAABMAAAAAAAAADWZlZV9yZWNpcGllbnQAAAAAAAATAAAAAA==",
        "AAAAAAAAAEhPbmx5IGVudHJ5IHBvaW50IHRvIHRha2UgYSBsb2FuLiBJbmxpbmUgY3JlZGl0IGNoZWNrICsgYXRvbWljIG9wZW5fbG9hbi4AAAAQYm9ycm93X3dpdGhfdGVybQAAAAQAAAAAAAAACGJvcnJvd2VyAAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAp0ZW5vcl9kYXlzAAAAAAAEAAAAAAAAAAdmZWVfYnBzAAAAAAQAAAABAAAACw==",
        "AAAAAAAAAIVSZWNvZ25pemUgYSBkZWZhdWx0ZWQgbG9hbidzIGxvc3MgaW4gdmF1bHQgYWNjb3VudGluZy4gT3duZXItZ2F0ZWQuClJlcXVpcmVzIHRoZSBsb2FuLW1hbmFnZXIgdG8gaGF2ZSBmbGFnZ2VkIHRoZSBib3Jyb3dlciBkZWZhdWx0ZWQuAAAAAAAAEG1hbnVhbF93cml0ZV9vZmYAAAACAAAAAAAAAAhib3Jyb3dlcgAAABMAAAAAAAAABmFtb3VudAAAAAAACwAAAAA=",
        "AAAAAAAAAAAAAAARc2V0X2ZlZV9yZWNpcGllbnQAAAAAAAABAAAAAAAAAAlyZWNpcGllbnQAAAAAAAATAAAAAA==" ]),
      options
    )
  }
  public readonly fromJSON = {
    repay: this.txFromJSON<i128>,
        redeem: this.txFromJSON<i128>,
        deposit: this.txFromJSON<i128>,
        upgrade: this.txFromJSON<null>,
        withdraw: this.txFromJSON<i128>,
        balance_of: this.txFromJSON<i128>,
        total_assets: this.txFromJSON<i128>,
        total_supply: this.txFromJSON<i128>,
        borrow_with_term: this.txFromJSON<i128>,
        manual_write_off: this.txFromJSON<null>,
        set_fee_recipient: this.txFromJSON<null>
  }
}