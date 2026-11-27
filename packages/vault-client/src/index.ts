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
    contractId: "CA23BR7WLIPAA2SGYXTGCFSWJEIIFM2YI2QWN2ES6EJQ5VGROM5W4BZ3",
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
  8: {message:"NotDefaulted"},
  9: {message:"ZeroShares"},
  10: {message:"InvalidBeneficiary"},
  11: {message:"SeedTooSmall"},
  12: {message:"MathOverflow"},
  13: {message:"NoStrategy"},
  14: {message:"StrategyNotEmpty"},
  15: {message:"StrategyAssetMismatch"},
  16: {message:"StrategyShort"},
  17: {message:"BadBuffer"},
  18: {message:"NoPendingStrategy"},
  19: {message:"StrategyNotReady"},
  20: {message:"StrategyCallFailed"},
  21: {message:"StrategyDisabled"}
}


export interface Config {
  fee_recipient: string;
  loan_manager: string;
  usdc: string;
}

export type DataKey = {tag: "Config", values: void} | {tag: "TotalShares", values: void} | {tag: "TotalBorrows", values: void} | {tag: "Shares", values: readonly [string]} | {tag: "WrittenOff", values: readonly [string]} | {tag: "Strategy", values: void} | {tag: "StrategyPos", values: void} | {tag: "Buffer", values: void} | {tag: "PendingStrategy", values: void};


/**
 * Constructor parameters (one struct so the deploy script stays readable and
 * stellar-cli can take them as JSON).
 */
export interface InitParams {
  admin: string;
  fee_recipient: string;
  loan_manager: string;
  operator: string;
  pauser: string;
  seed_assets: i128;
  seed_payer: string;
  upgrade_delay_secs: u64;
  usdc: string;
}


/**
 * Buffer policy. `tranche == 0` disables routing even if a strategy is set.
 */
export interface BufferCfg {
  idle_target: i128;
  min_out_bps: u32;
  tranche: i128;
}


/**
 * Mirrors of DeFindex's `Strategy` / `AssetStrategySet` (decoded by field
 * name, so the names must match theirs exactly).
 */
export interface DfStrategy {
  address: string;
  name: string;
  paused: boolean;
}


/**
 * Cached DeFindex position of this vault.
 */
export interface StrategyPos {
  assets: i128;
  last_sync: u64;
  shares: i128;
}


export interface PendingStrategy {
  eta: u64;
  strategy: Option<string>;
}


export interface DfAssetStrategySet {
  address: string;
  strategies: Array<DfStrategy>;
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
   * Construct and simulate a usdc transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Settlement asset (review PR #4: el script de deploy verificaba contra
   * un getter inexistente y el fallo se tragaba en silencio — ahora existe).
   */
  usdc: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a pause transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * `caller` must be the admin or the pauser.
   */
  pause: ({caller}: {caller: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a repay transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Full repayment only (mirrors EVK MustRepayFullAmountDue). `payer` funds
   * the loan of `borrower`. 5% protocol fee on the interest portion.
   * Never blocked by pause (repaying reduces exposure).
   */
  repay: ({payer, borrower}: {payer: string, borrower: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a redeem transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * ERC-4626 `redeem`: burn an EXACT `shares` amount, receive floor(assets).
   * Useful for "withdraw everything" (redeem the full share balance).
   * Never blocked by pause.
   */
  redeem: ({from, shares}: {from: string, shares: i128}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a deposit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  deposit: ({from, assets}: {from: string, assets: i128}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a unpause transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Admin only.
   */
  unpause: (options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_role transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_role: ({role}: {role: Role}, options?: MethodOptions) => Promise<AssembledTransaction<Option<string>>>

  /**
   * Construct and simulate a set_role transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Admin: assign `operator` or `pauser`. `admin` moves only via the
   * two-step transfer below.
   */
  set_role: ({role, account}: {role: Role, account: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a withdraw transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * ERC-4626 `withdraw`: burn shares to receive an EXACT `assets` amount of
   * USDC. This is the entry point the frontend uses (`evault.withdraw(amount,
   * receiver, owner)` — the user types a USDC amount). Returns shares burned.
   * Never blocked by pause: an LP exit is not new exposure.
   */
  withdraw: ({from, assets}: {from: string, assets: i128}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a is_paused transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  is_paused: (options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a balance_of transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Share balance of `account` (mirrors the EVM EVault `balanceOf`).
   */
  balance_of: ({account}: {account: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a accept_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  accept_admin: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a deposit_from transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * CCTP / on-ramp entry: `payer` funds the deposit, `beneficiary` receives
   * the shares. The award architecture (docs/ARCHITECTURE.md §2.1) promises
   * CCTP minting "directly into the Vault" with LP share accounting —
   * `deposit()` cannot express that: it requires the share recipient's own
   * auth and shares are not transferable, so a bridge could only donate
   * (inflating PPS) or split the flow in two transactions. Here the ONLY
   * auth is the payer's (their funds move); receiving shares needs no
   * consent, same as receiving a token transfer. Mirrors `deposit` exactly —
   * same conversion, same ZeroShares/donation guard — so it adds no new
   * PPS-inflation surface: shares are always minted at the current price
   * against assets actually pulled in.
   */
  deposit_from: ({payer, beneficiary, assets}: {payer: string, beneficiary: string, assets: i128}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a max_withdraw transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * ERC-4626 `maxWithdraw`: what `account` can take out right now
   * (its position, capped by the liquidity a withdraw can reach: idle cash
   * plus the cached strategy position, which `withdraw` pulls on demand).
   */
  max_withdraw: ({account}: {account: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

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
   * Construct and simulate a repay_partial transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Pago PARCIAL (revolvente): `amount` se imputa primero al interes/mora
   * devengado y despues al principal; el prestamo sigue activo hasta saldar.
   * Si `amount` cubre el saldo devengado completo, cierra — y ESTE es el
   * camino correcto para saldar en vivo (preview + colchon): `repay` sin
   * monto recalcula el saldo al ejecutar y en la red real eso rompe la
   * autorizacion firmada (el saldo crece por segundo).
   * Prestamos en default quedan excluidos (el LM lo rechaza): su curacion
   * post-write-off exige el pago total por el camino de `repay`.
   * Never blocked by pause.
   */
  repay_partial: ({payer, borrower, amount}: {payer: string, borrower: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a upgrade_delay transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  upgrade_delay: (options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a cancel_upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Admin or pauser (veto).
   */
  cancel_upgrade: ({caller}: {caller: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a transfer_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  transfer_admin: ({new_admin}: {new_admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a decimals_offset transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  decimals_offset: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a execute_upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Admin, after the delay, same hash as proposed.
   */
  execute_upgrade: ({new_wasm_hash}: {new_wasm_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a pending_upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  pending_upgrade: (options?: MethodOptions) => Promise<AssembledTransaction<Option<PendingUpgrade>>>

  /**
   * Construct and simulate a propose_upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Admin: schedule a wasm upgrade; executable after `upgrade_delay`.
   */
  propose_upgrade: ({new_wasm_hash}: {new_wasm_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a borrow_with_term transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Only entry point to take a loan. Inline credit check + atomic open_loan.
   * Blocked by pause (new exposure).
   */
  borrow_with_term: ({borrower, amount, tenor_days, fee_bps}: {borrower: string, amount: i128, tenor_days: u32, fee_bps: u32}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a manual_write_off transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Recognize a defaulted loan's loss in vault accounting. Admin-gated.
   * Requires the loan-manager to have flagged the borrower defaulted.
   */
  manual_write_off: ({borrower, amount}: {borrower: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a convert_to_assets transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * ERC-4626 `convertToAssets`: value of `shares` at the current price.
   */
  convert_to_assets: ({shares}: {shares: i128}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a convert_to_shares transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * ERC-4626 `convertToShares`: shares minted today for `assets`.
   */
  convert_to_shares: ({assets}: {assets: i128}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a set_fee_recipient transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_fee_recipient: ({recipient}: {recipient: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a cancel_admin_transfer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  cancel_admin_transfer: (options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a buffer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  buffer: (options?: MethodOptions) => Promise<AssembledTransaction<BufferCfg>>

  /**
   * Construct and simulate a strategy transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  strategy: (options?: MethodOptions) => Promise<AssembledTransaction<Option<string>>>

  /**
   * Construct and simulate a rebalance transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Operator. One tranche per call (bounded footprint); the keeper loops.
   */
  rebalance: (options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a set_buffer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Admin. `tranche == 0` disables routing. `min_out_bps` in [9_000, 10_000].
   */
  set_buffer: ({idle_target, tranche, min_out_bps}: {idle_target: i128, tranche: i128, min_out_bps: u32}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a sync_strategy transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Permissionless: refresh the cached value of the position (yield shows
   * up in the share price after this).
   */
  sync_strategy: (options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a cancel_strategy transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Admin or pauser (veto).
   */
  cancel_strategy: ({caller}: {caller: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a emergency_unwind transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Admin or pauser: bring everything back to idle (incident response).
   * Works while paused. Accepts whatever the strategy returns (min_out 0)
   * because getting the funds home beats a slippage floor in an emergency.
   */
  emergency_unwind: ({caller}: {caller: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a execute_strategy transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  execute_strategy: (options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a pending_strategy transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  pending_strategy: (options?: MethodOptions) => Promise<AssembledTransaction<Option<PendingStrategy>>>

  /**
   * Construct and simulate a propose_strategy transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Admin: schedule a strategy change (or removal with `None`); executable
   * after the upgrade delay and only while the position is empty.
   */
  propose_strategy: ({strategy}: {strategy: Option<string>}, options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a strategy_position transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  strategy_position: (options?: MethodOptions) => Promise<AssembledTransaction<StrategyPos>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {p}: {p: InitParams},
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
    return ContractClient.deploy({p}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAAAAAJBTZXR0bGVtZW50IGFzc2V0IChyZXZpZXcgUFIgIzQ6IGVsIHNjcmlwdCBkZSBkZXBsb3kgdmVyaWZpY2FiYSBjb250cmEKdW4gZ2V0dGVyIGluZXhpc3RlbnRlIHkgZWwgZmFsbG8gc2UgdHJhZ2FiYSBlbiBzaWxlbmNpbyDigJQgYWhvcmEgZXhpc3RlKS4AAAAEdXNkYwAAAAAAAAABAAAAEw==",
        "AAAAAQAAAE1NaXJyb3Igb2YgbG9hbi1tYW5hZ2VyJ3MgYExvYW5gIChzYW1lIFNDVmFsIGxheW91dCBmb3IgY3Jvc3MtY29udHJhY3QgcmVhZHMpLgAAAAAAAAAAAAAETG9hbgAAAAoAAAAAAAAABmFjdGl2ZQAAAAAAAQAAAAAAAAAKYW1vdW50X2R1ZQAAAAAACwAAAAAAAAAJZGVmYXVsdGVkAAAAAAAAAQAAAAAAAAADZHVlAAAAAAYAAAAAAAAAB2ZlZV9icHMAAAAABAAAAAAAAAAMZ3JhY2VfcGVyaW9kAAAABgAAAAAAAAAMbGFzdF9hY2NydWVkAAAABgAAAAAAAAAJcHJpbmNpcGFsAAAAAAAACwAAAAAAAAAFc3RhcnQAAAAAAAAGAAAAAAAAAAp0ZW5vcl9kYXlzAAAAAAAE",
        "AAAAAAAAAClgY2FsbGVyYCBtdXN0IGJlIHRoZSBhZG1pbiBvciB0aGUgcGF1c2VyLgAAAAAAAAVwYXVzZQAAAAAAAAEAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAA=",
        "AAAAAAAAALxGdWxsIHJlcGF5bWVudCBvbmx5IChtaXJyb3JzIEVWSyBNdXN0UmVwYXlGdWxsQW1vdW50RHVlKS4gYHBheWVyYCBmdW5kcwp0aGUgbG9hbiBvZiBgYm9ycm93ZXJgLiA1JSBwcm90b2NvbCBmZWUgb24gdGhlIGludGVyZXN0IHBvcnRpb24uCk5ldmVyIGJsb2NrZWQgYnkgcGF1c2UgKHJlcGF5aW5nIHJlZHVjZXMgZXhwb3N1cmUpLgAAAAVyZXBheQAAAAAAAAIAAAAAAAAABXBheWVyAAAAAAAAEwAAAAAAAAAIYm9ycm93ZXIAAAATAAAAAQAAAAs=",
        "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAAFQAAAAAAAAASQWxyZWFkeUluaXRpYWxpemVkAAAAAAABAAAAAAAAAA5Ob3RJbml0aWFsaXplZAAAAAAAAgAAAAAAAAAKWmVyb0Ftb3VudAAAAAAAAwAAAAAAAAAQSW5zdWZmaWNpZW50Q2FzaAAAAAQAAAAAAAAAEkluc3VmZmljaWVudFNoYXJlcwAAAAAABQAAAAAAAAAPT3ZlckNyZWRpdExpbWl0AAAAAAYAAAAAAAAADE5vQWN0aXZlTG9hbgAAAAcAAAAAAAAADE5vdERlZmF1bHRlZAAAAAgAAAAAAAAAClplcm9TaGFyZXMAAAAAAAkAAAAAAAAAEkludmFsaWRCZW5lZmljaWFyeQAAAAAACgAAAAAAAAAMU2VlZFRvb1NtYWxsAAAACwAAAAAAAAAMTWF0aE92ZXJmbG93AAAADAAAAAAAAAAKTm9TdHJhdGVneQAAAAAADQAAAAAAAAAQU3RyYXRlZ3lOb3RFbXB0eQAAAA4AAAAAAAAAFVN0cmF0ZWd5QXNzZXRNaXNtYXRjaAAAAAAAAA8AAAAAAAAADVN0cmF0ZWd5U2hvcnQAAAAAAAAQAAAAAAAAAAlCYWRCdWZmZXIAAAAAAAARAAAAAAAAABFOb1BlbmRpbmdTdHJhdGVneQAAAAAAABIAAAAAAAAAEFN0cmF0ZWd5Tm90UmVhZHkAAAATAAAAAAAAABJTdHJhdGVneUNhbGxGYWlsZWQAAAAAABQAAAAAAAAAEFN0cmF0ZWd5RGlzYWJsZWQAAAAV",
        "AAAAAAAAAKJFUkMtNDYyNiBgcmVkZWVtYDogYnVybiBhbiBFWEFDVCBgc2hhcmVzYCBhbW91bnQsIHJlY2VpdmUgZmxvb3IoYXNzZXRzKS4KVXNlZnVsIGZvciAid2l0aGRyYXcgZXZlcnl0aGluZyIgKHJlZGVlbSB0aGUgZnVsbCBzaGFyZSBiYWxhbmNlKS4KTmV2ZXIgYmxvY2tlZCBieSBwYXVzZS4AAAAAAAZyZWRlZW0AAAAAAAIAAAAAAAAABGZyb20AAAATAAAAAAAAAAZzaGFyZXMAAAAAAAsAAAABAAAACw==",
        "AAAAAQAAAAAAAAAAAAAABkNvbmZpZwAAAAAAAwAAAAAAAAANZmVlX3JlY2lwaWVudAAAAAAAABMAAAAAAAAADGxvYW5fbWFuYWdlcgAAABMAAAAAAAAABHVzZGMAAAAT",
        "AAAAAAAAAAAAAAAHZGVwb3NpdAAAAAACAAAAAAAAAARmcm9tAAAAEwAAAAAAAAAGYXNzZXRzAAAAAAALAAAAAQAAAAs=",
        "AAAAAAAAAAtBZG1pbiBvbmx5LgAAAAAHdW5wYXVzZQAAAAAAAAAAAA==",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAACQAAAAAAAAAAAAAABkNvbmZpZwAAAAAAAAAAAAAAAAALVG90YWxTaGFyZXMAAAAAAAAAAAAAAAAMVG90YWxCb3Jyb3dzAAAAAQAAAAAAAAAGU2hhcmVzAAAAAAABAAAAEwAAAAEAAAAAAAAACldyaXR0ZW5PZmYAAAAAAAEAAAATAAAAAAAAAAAAAAAIU3RyYXRlZ3kAAAAAAAAAAAAAAAtTdHJhdGVneVBvcwAAAAAAAAAAAAAAAAZCdWZmZXIAAAAAAAAAAAAAAAAAD1BlbmRpbmdTdHJhdGVneQA=",
        "AAAAAAAAAAAAAAAIZ2V0X3JvbGUAAAABAAAAAAAAAARyb2xlAAAH0AAAAARSb2xlAAAAAQAAA+gAAAAT",
        "AAAAAAAAAFlBZG1pbjogYXNzaWduIGBvcGVyYXRvcmAgb3IgYHBhdXNlcmAuIGBhZG1pbmAgbW92ZXMgb25seSB2aWEgdGhlCnR3by1zdGVwIHRyYW5zZmVyIGJlbG93LgAAAAAAAAhzZXRfcm9sZQAAAAIAAAAAAAAABHJvbGUAAAfQAAAABFJvbGUAAAAAAAAAB2FjY291bnQAAAAAEwAAAAA=",
        "AAAAAAAAARVFUkMtNDYyNiBgd2l0aGRyYXdgOiBidXJuIHNoYXJlcyB0byByZWNlaXZlIGFuIEVYQUNUIGBhc3NldHNgIGFtb3VudCBvZgpVU0RDLiBUaGlzIGlzIHRoZSBlbnRyeSBwb2ludCB0aGUgZnJvbnRlbmQgdXNlcyAoYGV2YXVsdC53aXRoZHJhdyhhbW91bnQsCnJlY2VpdmVyLCBvd25lcilgIOKAlCB0aGUgdXNlciB0eXBlcyBhIFVTREMgYW1vdW50KS4gUmV0dXJucyBzaGFyZXMgYnVybmVkLgpOZXZlciBibG9ja2VkIGJ5IHBhdXNlOiBhbiBMUCBleGl0IGlzIG5vdCBuZXcgZXhwb3N1cmUuAAAAAAAACHdpdGhkcmF3AAAAAgAAAAAAAAAEZnJvbQAAABMAAAAAAAAABmFzc2V0cwAAAAAACwAAAAEAAAAL",
        "AAAAAAAAAAAAAAAJaXNfcGF1c2VkAAAAAAAAAAAAAAEAAAAB",
        "AAAAAAAAAEBTaGFyZSBiYWxhbmNlIG9mIGBhY2NvdW50YCAobWlycm9ycyB0aGUgRVZNIEVWYXVsdCBgYmFsYW5jZU9mYCkuAAAACmJhbGFuY2Vfb2YAAAAAAAEAAAAAAAAAB2FjY291bnQAAAAAEwAAAAEAAAAL",
        "AAAAAQAAAG5Db25zdHJ1Y3RvciBwYXJhbWV0ZXJzIChvbmUgc3RydWN0IHNvIHRoZSBkZXBsb3kgc2NyaXB0IHN0YXlzIHJlYWRhYmxlIGFuZApzdGVsbGFyLWNsaSBjYW4gdGFrZSB0aGVtIGFzIEpTT04pLgAAAAAAAAAAAApJbml0UGFyYW1zAAAAAAAJAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAADWZlZV9yZWNpcGllbnQAAAAAAAATAAAAAAAAAAxsb2FuX21hbmFnZXIAAAATAAAAAAAAAAhvcGVyYXRvcgAAABMAAAAAAAAABnBhdXNlcgAAAAAAEwAAAAAAAAALc2VlZF9hc3NldHMAAAAACwAAAAAAAAAKc2VlZF9wYXllcgAAAAAAEwAAAAAAAAASdXBncmFkZV9kZWxheV9zZWNzAAAAAAAGAAAAAAAAAAR1c2RjAAAAEw==",
        "AAAAAAAAAAAAAAAMYWNjZXB0X2FkbWluAAAAAAAAAAEAAAAT",
        "AAAAAAAAAt9DQ1RQIC8gb24tcmFtcCBlbnRyeTogYHBheWVyYCBmdW5kcyB0aGUgZGVwb3NpdCwgYGJlbmVmaWNpYXJ5YCByZWNlaXZlcwp0aGUgc2hhcmVzLiBUaGUgYXdhcmQgYXJjaGl0ZWN0dXJlIChkb2NzL0FSQ0hJVEVDVFVSRS5tZCDCpzIuMSkgcHJvbWlzZXMKQ0NUUCBtaW50aW5nICJkaXJlY3RseSBpbnRvIHRoZSBWYXVsdCIgd2l0aCBMUCBzaGFyZSBhY2NvdW50aW5nIOKAlApgZGVwb3NpdCgpYCBjYW5ub3QgZXhwcmVzcyB0aGF0OiBpdCByZXF1aXJlcyB0aGUgc2hhcmUgcmVjaXBpZW50J3Mgb3duCmF1dGggYW5kIHNoYXJlcyBhcmUgbm90IHRyYW5zZmVyYWJsZSwgc28gYSBicmlkZ2UgY291bGQgb25seSBkb25hdGUKKGluZmxhdGluZyBQUFMpIG9yIHNwbGl0IHRoZSBmbG93IGluIHR3byB0cmFuc2FjdGlvbnMuIEhlcmUgdGhlIE9OTFkKYXV0aCBpcyB0aGUgcGF5ZXIncyAodGhlaXIgZnVuZHMgbW92ZSk7IHJlY2VpdmluZyBzaGFyZXMgbmVlZHMgbm8KY29uc2VudCwgc2FtZSBhcyByZWNlaXZpbmcgYSB0b2tlbiB0cmFuc2Zlci4gTWlycm9ycyBgZGVwb3NpdGAgZXhhY3RseSDigJQKc2FtZSBjb252ZXJzaW9uLCBzYW1lIFplcm9TaGFyZXMvZG9uYXRpb24gZ3VhcmQg4oCUIHNvIGl0IGFkZHMgbm8gbmV3ClBQUy1pbmZsYXRpb24gc3VyZmFjZTogc2hhcmVzIGFyZSBhbHdheXMgbWludGVkIGF0IHRoZSBjdXJyZW50IHByaWNlCmFnYWluc3QgYXNzZXRzIGFjdHVhbGx5IHB1bGxlZCBpbi4AAAAADGRlcG9zaXRfZnJvbQAAAAMAAAAAAAAABXBheWVyAAAAAAAAEwAAAAAAAAALYmVuZWZpY2lhcnkAAAAAEwAAAAAAAAAGYXNzZXRzAAAAAAALAAAAAQAAAAs=",
        "AAAAAAAAAMpFUkMtNDYyNiBgbWF4V2l0aGRyYXdgOiB3aGF0IGBhY2NvdW50YCBjYW4gdGFrZSBvdXQgcmlnaHQgbm93CihpdHMgcG9zaXRpb24sIGNhcHBlZCBieSB0aGUgbGlxdWlkaXR5IGEgd2l0aGRyYXcgY2FuIHJlYWNoOiBpZGxlIGNhc2gKcGx1cyB0aGUgY2FjaGVkIHN0cmF0ZWd5IHBvc2l0aW9uLCB3aGljaCBgd2l0aGRyYXdgIHB1bGxzIG9uIGRlbWFuZCkuAAAAAAAMbWF4X3dpdGhkcmF3AAAAAQAAAAAAAAAHYWNjb3VudAAAAAATAAAAAQAAAAs=",
        "AAAAAAAAAAAAAAAMdG90YWxfYXNzZXRzAAAAAAAAAAEAAAAL",
        "AAAAAAAAAEBUb3RhbCBzaGFyZXMgb3V0c3RhbmRpbmcgKG1pcnJvcnMgdGhlIEVWTSBFVmF1bHQgYHRvdGFsU3VwcGx5YCkuAAAADHRvdGFsX3N1cHBseQAAAAAAAAABAAAACw==",
        "AAAAAAAAALdPbmUtdGltZSBjb25zdHJ1Y3Rvci4gTG9ja3MgYSBzZWVkIGRlcG9zaXQgcGFpZCBieSBgc2VlZF9wYXllcmAgd2hvc2UKc2hhcmVzIGJlbG9uZyB0byB0aGUgY29udHJhY3QgYWRkcmVzcyBpdHNlbGY6IG5vYm9keSBjYW4gZXZlciByZWRlZW0KdGhlbSwgc28gdG90YWwgc3VwcGx5IG5ldmVyIHJldHVybnMgdG8gemVyby4AAAAADV9fY29uc3RydWN0b3IAAAAAAAABAAAAAAAAAAFwAAAAAAAH0AAAAApJbml0UGFyYW1zAAAAAAAA",
        "AAAAAAAAAitQYWdvIFBBUkNJQUwgKHJldm9sdmVudGUpOiBgYW1vdW50YCBzZSBpbXB1dGEgcHJpbWVybyBhbCBpbnRlcmVzL21vcmEKZGV2ZW5nYWRvIHkgZGVzcHVlcyBhbCBwcmluY2lwYWw7IGVsIHByZXN0YW1vIHNpZ3VlIGFjdGl2byBoYXN0YSBzYWxkYXIuClNpIGBhbW91bnRgIGN1YnJlIGVsIHNhbGRvIGRldmVuZ2FkbyBjb21wbGV0bywgY2llcnJhIOKAlCB5IEVTVEUgZXMgZWwKY2FtaW5vIGNvcnJlY3RvIHBhcmEgc2FsZGFyIGVuIHZpdm8gKHByZXZpZXcgKyBjb2xjaG9uKTogYHJlcGF5YCBzaW4KbW9udG8gcmVjYWxjdWxhIGVsIHNhbGRvIGFsIGVqZWN1dGFyIHkgZW4gbGEgcmVkIHJlYWwgZXNvIHJvbXBlIGxhCmF1dG9yaXphY2lvbiBmaXJtYWRhIChlbCBzYWxkbyBjcmVjZSBwb3Igc2VndW5kbykuClByZXN0YW1vcyBlbiBkZWZhdWx0IHF1ZWRhbiBleGNsdWlkb3MgKGVsIExNIGxvIHJlY2hhemEpOiBzdSBjdXJhY2lvbgpwb3N0LXdyaXRlLW9mZiBleGlnZSBlbCBwYWdvIHRvdGFsIHBvciBlbCBjYW1pbm8gZGUgYHJlcGF5YC4KTmV2ZXIgYmxvY2tlZCBieSBwYXVzZS4AAAAADXJlcGF5X3BhcnRpYWwAAAAAAAADAAAAAAAAAAVwYXllcgAAAAAAABMAAAAAAAAACGJvcnJvd2VyAAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAQAAAAs=",
        "AAAAAAAAAAAAAAANdXBncmFkZV9kZWxheQAAAAAAAAAAAAABAAAABg==",
        "AAAAAAAAABdBZG1pbiBvciBwYXVzZXIgKHZldG8pLgAAAAAOY2FuY2VsX3VwZ3JhZGUAAAAAAAEAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAA=",
        "AAAAAAAAAAAAAAAOdHJhbnNmZXJfYWRtaW4AAAAAAAEAAAAAAAAACW5ld19hZG1pbgAAAAAAABMAAAAA",
        "AAAAAAAAAAAAAAAPZGVjaW1hbHNfb2Zmc2V0AAAAAAAAAAABAAAABA==",
        "AAAAAAAAAC5BZG1pbiwgYWZ0ZXIgdGhlIGRlbGF5LCBzYW1lIGhhc2ggYXMgcHJvcG9zZWQuAAAAAAAPZXhlY3V0ZV91cGdyYWRlAAAAAAEAAAAAAAAADW5ld193YXNtX2hhc2gAAAAAAAPuAAAAIAAAAAA=",
        "AAAAAAAAAAAAAAAPcGVuZGluZ191cGdyYWRlAAAAAAAAAAABAAAD6AAAB9AAAAAOUGVuZGluZ1VwZ3JhZGUAAA==",
        "AAAAAAAAAEFBZG1pbjogc2NoZWR1bGUgYSB3YXNtIHVwZ3JhZGU7IGV4ZWN1dGFibGUgYWZ0ZXIgYHVwZ3JhZGVfZGVsYXlgLgAAAAAAAA9wcm9wb3NlX3VwZ3JhZGUAAAAAAQAAAAAAAAANbmV3X3dhc21faGFzaAAAAAAAA+4AAAAgAAAAAQAAAAY=",
        "AAAAAAAAAGlPbmx5IGVudHJ5IHBvaW50IHRvIHRha2UgYSBsb2FuLiBJbmxpbmUgY3JlZGl0IGNoZWNrICsgYXRvbWljIG9wZW5fbG9hbi4KQmxvY2tlZCBieSBwYXVzZSAobmV3IGV4cG9zdXJlKS4AAAAAAAAQYm9ycm93X3dpdGhfdGVybQAAAAQAAAAAAAAACGJvcnJvd2VyAAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAp0ZW5vcl9kYXlzAAAAAAAEAAAAAAAAAAdmZWVfYnBzAAAAAAQAAAABAAAACw==",
        "AAAAAAAAAIVSZWNvZ25pemUgYSBkZWZhdWx0ZWQgbG9hbidzIGxvc3MgaW4gdmF1bHQgYWNjb3VudGluZy4gQWRtaW4tZ2F0ZWQuClJlcXVpcmVzIHRoZSBsb2FuLW1hbmFnZXIgdG8gaGF2ZSBmbGFnZ2VkIHRoZSBib3Jyb3dlciBkZWZhdWx0ZWQuAAAAAAAAEG1hbnVhbF93cml0ZV9vZmYAAAACAAAAAAAAAAhib3Jyb3dlcgAAABMAAAAAAAAABmFtb3VudAAAAAAACwAAAAA=",
        "AAAAAAAAAENFUkMtNDYyNiBgY29udmVydFRvQXNzZXRzYDogdmFsdWUgb2YgYHNoYXJlc2AgYXQgdGhlIGN1cnJlbnQgcHJpY2UuAAAAABFjb252ZXJ0X3RvX2Fzc2V0cwAAAAAAAAEAAAAAAAAABnNoYXJlcwAAAAAACwAAAAEAAAAL",
        "AAAAAAAAAD1FUkMtNDYyNiBgY29udmVydFRvU2hhcmVzYDogc2hhcmVzIG1pbnRlZCB0b2RheSBmb3IgYGFzc2V0c2AuAAAAAAAAEWNvbnZlcnRfdG9fc2hhcmVzAAAAAAAAAQAAAAAAAAAGYXNzZXRzAAAAAAALAAAAAQAAAAs=",
        "AAAAAAAAAAAAAAARc2V0X2ZlZV9yZWNpcGllbnQAAAAAAAABAAAAAAAAAAlyZWNpcGllbnQAAAAAAAATAAAAAA==",
        "AAAAAAAAAAAAAAAVY2FuY2VsX2FkbWluX3RyYW5zZmVyAAAAAAAAAAAAAAA=",
        "AAAAAAAAAAAAAAAGYnVmZmVyAAAAAAAAAAAAAQAAB9AAAAAJQnVmZmVyQ2ZnAAAA",
        "AAAAAAAAAAAAAAAIc3RyYXRlZ3kAAAAAAAAAAQAAA+gAAAAT",
        "AAAAAAAAAEVPcGVyYXRvci4gT25lIHRyYW5jaGUgcGVyIGNhbGwgKGJvdW5kZWQgZm9vdHByaW50KTsgdGhlIGtlZXBlciBsb29wcy4AAAAAAAAJcmViYWxhbmNlAAAAAAAAAAAAAAEAAAAL",
        "AAAAAQAAAElCdWZmZXIgcG9saWN5LiBgdHJhbmNoZSA9PSAwYCBkaXNhYmxlcyByb3V0aW5nIGV2ZW4gaWYgYSBzdHJhdGVneSBpcyBzZXQuAAAAAAAAAAAAAAlCdWZmZXJDZmcAAAAAAAADAAAAAAAAAAtpZGxlX3RhcmdldAAAAAALAAAAAAAAAAttaW5fb3V0X2JwcwAAAAAEAAAAAAAAAAd0cmFuY2hlAAAAAAs=",
        "AAAAAAAAAElBZG1pbi4gYHRyYW5jaGUgPT0gMGAgZGlzYWJsZXMgcm91dGluZy4gYG1pbl9vdXRfYnBzYCBpbiBbOV8wMDAsIDEwXzAwMF0uAAAAAAAACnNldF9idWZmZXIAAAAAAAMAAAAAAAAAC2lkbGVfdGFyZ2V0AAAAAAsAAAAAAAAAB3RyYW5jaGUAAAAACwAAAAAAAAALbWluX291dF9icHMAAAAABAAAAAA=",
        "AAAAAQAAAHZNaXJyb3JzIG9mIERlRmluZGV4J3MgYFN0cmF0ZWd5YCAvIGBBc3NldFN0cmF0ZWd5U2V0YCAoZGVjb2RlZCBieSBmaWVsZApuYW1lLCBzbyB0aGUgbmFtZXMgbXVzdCBtYXRjaCB0aGVpcnMgZXhhY3RseSkuAAAAAAAAAAAACkRmU3RyYXRlZ3kAAAAAAAMAAAAAAAAAB2FkZHJlc3MAAAAAEwAAAAAAAAAEbmFtZQAAABAAAAAAAAAABnBhdXNlZAAAAAAAAQ==",
        "AAAAAQAAACdDYWNoZWQgRGVGaW5kZXggcG9zaXRpb24gb2YgdGhpcyB2YXVsdC4AAAAAAAAAAAtTdHJhdGVneVBvcwAAAAADAAAAAAAAAAZhc3NldHMAAAAAAAsAAAAAAAAACWxhc3Rfc3luYwAAAAAAAAYAAAAAAAAABnNoYXJlcwAAAAAACw==",
        "AAAAAAAAAGhQZXJtaXNzaW9ubGVzczogcmVmcmVzaCB0aGUgY2FjaGVkIHZhbHVlIG9mIHRoZSBwb3NpdGlvbiAoeWllbGQgc2hvd3MKdXAgaW4gdGhlIHNoYXJlIHByaWNlIGFmdGVyIHRoaXMpLgAAAA1zeW5jX3N0cmF0ZWd5AAAAAAAAAAAAAAEAAAAL",
        "AAAAAAAAABdBZG1pbiBvciBwYXVzZXIgKHZldG8pLgAAAAAPY2FuY2VsX3N0cmF0ZWd5AAAAAAEAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAA=",
        "AAAAAQAAAAAAAAAAAAAAD1BlbmRpbmdTdHJhdGVneQAAAAACAAAAAAAAAANldGEAAAAABgAAAAAAAAAIc3RyYXRlZ3kAAAPoAAAAEw==",
        "AAAAAAAAANBBZG1pbiBvciBwYXVzZXI6IGJyaW5nIGV2ZXJ5dGhpbmcgYmFjayB0byBpZGxlIChpbmNpZGVudCByZXNwb25zZSkuCldvcmtzIHdoaWxlIHBhdXNlZC4gQWNjZXB0cyB3aGF0ZXZlciB0aGUgc3RyYXRlZ3kgcmV0dXJucyAobWluX291dCAwKQpiZWNhdXNlIGdldHRpbmcgdGhlIGZ1bmRzIGhvbWUgYmVhdHMgYSBzbGlwcGFnZSBmbG9vciBpbiBhbiBlbWVyZ2VuY3kuAAAAEGVtZXJnZW5jeV91bndpbmQAAAABAAAAAAAAAAZjYWxsZXIAAAAAABMAAAABAAAACw==",
        "AAAAAAAAAAAAAAAQZXhlY3V0ZV9zdHJhdGVneQAAAAAAAAAA",
        "AAAAAAAAAAAAAAAQcGVuZGluZ19zdHJhdGVneQAAAAAAAAABAAAD6AAAB9AAAAAPUGVuZGluZ1N0cmF0ZWd5AA==",
        "AAAAAAAAAIRBZG1pbjogc2NoZWR1bGUgYSBzdHJhdGVneSBjaGFuZ2UgKG9yIHJlbW92YWwgd2l0aCBgTm9uZWApOyBleGVjdXRhYmxlCmFmdGVyIHRoZSB1cGdyYWRlIGRlbGF5IGFuZCBvbmx5IHdoaWxlIHRoZSBwb3NpdGlvbiBpcyBlbXB0eS4AAAAQcHJvcG9zZV9zdHJhdGVneQAAAAEAAAAAAAAACHN0cmF0ZWd5AAAD6AAAABMAAAABAAAABg==",
        "AAAAAAAAAAAAAAARc3RyYXRlZ3lfcG9zaXRpb24AAAAAAAAAAAAAAQAAB9AAAAALU3RyYXRlZ3lQb3MA",
        "AAAAAQAAAAAAAAAAAAAAEkRmQXNzZXRTdHJhdGVneVNldAAAAAAAAgAAAAAAAAAHYWRkcmVzcwAAAAATAAAAAAAAAApzdHJhdGVnaWVzAAAAAAPqAAAH0AAAAApEZlN0cmF0ZWd5AAA=",
        "AAAAAgAAAAAAAAAAAAAABFJvbGUAAAAEAAAAAAAAAAAAAAAFQWRtaW4AAAAAAAAAAAAAAAAAAAtVbmRlcndyaXRlcgAAAAAAAAAAAAAAAAhPcGVyYXRvcgAAAAAAAAAAAAAABlBhdXNlcgAA",
        "AAAAAgAAAKlJbnN0YW5jZS1zdG9yYWdlIGtleXMuIEEgc2VwYXJhdGUgZW51bSBmcm9tIHRoZSBjb250cmFjdCdzIGBEYXRhS2V5YCwgc28gdGhlCnR3byBjYW4gY29leGlzdCBpbiB0aGUgc2FtZSBpbnN0YW5jZSBtYXAgKHZhcmlhbnQgbmFtZXMgZGlmZmVyLCBzbyB0aGUKZW5jb2RlZCBrZXlzIGRpZmZlcikuAAAAAAAAAAAAAAZHb3ZLZXkAAAAAAAUAAAABAAAAAAAAAARSb2xlAAAAAQAAB9AAAAAEUm9sZQAAAAAAAAAAAAAADFBlbmRpbmdBZG1pbgAAAAAAAAAAAAAABlBhdXNlZAAAAAAAAAAAAAAAAAAOUGVuZGluZ1VwZ3JhZGUAAAAAAAAAAAAAAAAADFVwZ3JhZGVEZWxheQ==",
        "AAAABAAAAGpFcnJvciBjb2RlcyAxMDHigJMxMTAgYXJlIHJlc2VydmVkIGZvciBnb3Zlcm5hbmNlIHNvIHRoZXkgbmV2ZXIgb3ZlcmxhcCB0aGUKY29udHJhY3RzJyBvd24gZW51bXMgKDHigJM5OSkuAAAAAAAAAAAACEdvdkVycm9yAAAACgAAAAAAAAAMVW5hdXRob3JpemVkAAAAZQAAAAAAAAAGUGF1c2VkAAAAAABmAAAAAAAAAAlOb3RQYXVzZWQAAAAAAABnAAAAAAAAAA5Ob1BlbmRpbmdBZG1pbgAAAAAAaAAAAAAAAAAQTm9QZW5kaW5nVXBncmFkZQAAAGkAAAAAAAAAEFRpbWVsb2NrTm90UmVhZHkAAABqAAAAAAAAABNVcGdyYWRlSGFzaE1pc21hdGNoAAAAAGsAAAAAAAAADURlbGF5VG9vU2hvcnQAAAAAAABsAAAAAAAAAApSb2xlTm90U2V0AAAAAABtAAAAAAAAAAxNYXRoT3ZlcmZsb3cAAABu",
        "AAAAAQAAAAAAAAAAAAAADlBlbmRpbmdVcGdyYWRlAAAAAAACAAAAAAAAAANldGEAAAAABgAAAAAAAAAJd2FzbV9oYXNoAAAAAAAD7gAAACA=" ]),
      options
    )
  }
  public readonly fromJSON = {
    usdc: this.txFromJSON<string>,
        pause: this.txFromJSON<null>,
        repay: this.txFromJSON<i128>,
        redeem: this.txFromJSON<i128>,
        deposit: this.txFromJSON<i128>,
        unpause: this.txFromJSON<null>,
        get_role: this.txFromJSON<Option<string>>,
        set_role: this.txFromJSON<null>,
        withdraw: this.txFromJSON<i128>,
        is_paused: this.txFromJSON<boolean>,
        balance_of: this.txFromJSON<i128>,
        accept_admin: this.txFromJSON<string>,
        deposit_from: this.txFromJSON<i128>,
        max_withdraw: this.txFromJSON<i128>,
        total_assets: this.txFromJSON<i128>,
        total_supply: this.txFromJSON<i128>,
        repay_partial: this.txFromJSON<i128>,
        upgrade_delay: this.txFromJSON<u64>,
        cancel_upgrade: this.txFromJSON<null>,
        transfer_admin: this.txFromJSON<null>,
        decimals_offset: this.txFromJSON<u32>,
        execute_upgrade: this.txFromJSON<null>,
        pending_upgrade: this.txFromJSON<Option<PendingUpgrade>>,
        propose_upgrade: this.txFromJSON<u64>,
        borrow_with_term: this.txFromJSON<i128>,
        manual_write_off: this.txFromJSON<null>,
        convert_to_assets: this.txFromJSON<i128>,
        convert_to_shares: this.txFromJSON<i128>,
        set_fee_recipient: this.txFromJSON<null>,
        cancel_admin_transfer: this.txFromJSON<null>,
        buffer: this.txFromJSON<BufferCfg>,
        strategy: this.txFromJSON<Option<string>>,
        rebalance: this.txFromJSON<i128>,
        set_buffer: this.txFromJSON<null>,
        sync_strategy: this.txFromJSON<i128>,
        cancel_strategy: this.txFromJSON<null>,
        emergency_unwind: this.txFromJSON<i128>,
        execute_strategy: this.txFromJSON<null>,
        pending_strategy: this.txFromJSON<Option<PendingStrategy>>,
        propose_strategy: this.txFromJSON<u64>,
        strategy_position: this.txFromJSON<StrategyPos>
  }
}