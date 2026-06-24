# EVM ↔ Soroban parity audit

Function-by-function comparison of the Lendoor EVM contracts (`LoanManagerV3` +
the modified Euler `EVault`) against the Soroban port (`lendoor-loan-manager` +
`lendoor-vault`). Goal: same names, inputs and outputs — and a documented reason
wherever they can't be.

## Blanket conventions (apply everywhere, not repeated per-row)

| EVM | Soroban | Why |
|---|---|---|
| `camelCase` | `snake_case` | Rust/Soroban idiom. Names are bindings-level, not part of the wire format; the Soroban frontend regenerates bindings anyway. |
| `uint256` / `uint128` | `i128` | Soroban has no `uint256`/`uint128`. `i128` is the widest integer and holds any USDC figure (2^127 ≫ total supply). Amounts are non-negative and guarded. |
| `uint16` (score, feeBps, tenorDays) | `u32` | Soroban's smallest unsigned int is `u32` (no `u16`). Value ranges are identical. |
| `uint32`/`uint64` time fields | `u64` | Uniform `u64` seconds for all timestamps/periods; avoids mixed-width time math. |
| `msg.sender` | explicit `Address` + `require_auth()` | Soroban has no implicit caller. The authorizing address is always a leading parameter. |
| public mapping getter (`users(a)`) | explicit `get_*` function | Soroban has no auto-generated public-mapping getters; every read is a function. |
| auto tuple from public mapping | typed `#[contracttype]` struct | Soroban returns typed structs; richer and self-describing. |

---

## Vault  (EVM `EVault` → Soroban `lendoor-vault`)

| EVM | Soroban | Inputs match? | Output match? | Notes / reason |
|---|---|---|---|---|
| `deposit(uint256 amount, address receiver) → uint256` | `deposit(from, assets) → i128` | ⚠ | ✅ shares | `receiver` collapsed into `from` (funder = share-receiver). No `msg.sender`; the frontend always passes `receiver = sender`. |
| `withdraw(uint256 amount, address receiver, address owner) → uint256` | `withdraw(from, assets) → i128` | ⚠ | ✅ shares burned | `receiver`+`owner` collapse into `from`. No ERC-20 allowance delegation in v1. Takes an **asset** amount, exactly like the frontend's `evault.withdraw(amount,…)`. |
| `redeem(uint256 shares, address receiver, address owner) → uint256` | `redeem(from, shares) → i128` | ⚠ | ✅ assets | Same collapse. Added for ERC-4626 parity ("withdraw everything"). |
| `borrowWithTerm(uint256 amount, address receiver, uint16 tenorDays, uint16 feeBps) → uint256` | `borrow_with_term(borrower, amount, tenor_days, fee_bps) → i128` | ⚠ | ✅ assets | `receiver` collapsed into `borrower`. Return aligned to the disbursed amount. |
| `repay(uint256 amount, address receiver) → uint256` | `repay(payer, borrower) → i128` | ⚠ | ✅ amount paid | EVM `amount` is **dropped**: EVK enforces `MustRepayFullAmountDue` and the frontend always sends `MaxUint256` (=full), so Soroban makes "full" implicit (reads stored `amount_due`). `payer` is explicit (no `msg.sender`). |
| `manualWriteOff(address borrower, uint256 amount)` | `manual_write_off(borrower, amount)` | ✅ | ✅ (void) | Name + inputs match. Owner-gated in both. |
| `balanceOf(address) → uint256` | `balance_of(account) → i128` | ✅ | ✅ | Renamed to mirror EVM. |
| `totalAssets() → uint256` | `total_assets() → i128` | ✅ | ✅ | |
| `totalSupply() → uint256` | `total_supply() → i128` | ✅ | ✅ | Renamed to mirror EVM. |
| `debtOf(address) → uint256` | — (none) | — | — | **Not ported.** Per-user debt lives in the loan-manager (`get_loan().amount_due` / `preview_owed`); the frontend reads it there, not from the vault. A vault proxy would be redundant. Easy to add as a thin pass-through if wanted. |
| `repayWithShares(...)` | — | — | — | Not used by the frontend; out of scope for v1. |
| — | `set_fee_recipient`, `upgrade`, `__constructor` | — | — | Additive governance. `upgrade` replaces the EVM UUPS proxy (Soroban upgrades in place). |

---

## Loan manager  (EVM `LoanManagerV3` → Soroban `lendoor-loan-manager`)

### Reads

| EVM | Soroban | Inputs | Output | Notes / reason |
|---|---|---|---|---|
| `creditLimit(address) → uint256` | `credit_limit(account) → i128` | ✅ | ✅ | Exact (modulo case + int width). |
| `users(address) → (score,kycOk,validUntil,lastUpdate,limit)` | `get_user_risk(account) → UserRisk` | ✅ | ✅ same fields | Public-mapping getter → explicit getter; returns the same 5 fields as a struct. |
| `loans(address) → (principal,amountDue,start,due,feeBps,gracePeriod,active)` | `get_loan(borrower) → Loan` | ✅ | ⚠ superset | Soroban returns the **full** struct incl. `defaulted` + `last_accrued`. EVM deliberately hides `defaulted` to force use of `isDefaulted` — but that's still available in Soroban (`is_defaulted`), so this is a harmless superset, not a behavior change. The vault needs the full struct cross-contract. |
| `nextBorrowTime(address) → uint64` | `next_borrow_time(account) → u64` | ✅ | ✅ | |
| `premiums(address) → (premiumRatePerSecWad,lateRatePerSecWad)` | `get_premium(account) → PremiumConfig` | ✅ | ✅ same fields | |
| `previewLoanWithLate(address) → (principal, amountDueWithLate)` | `preview_loan_with_late(borrower) → (i128,i128)` | ✅ | ✅ | Same tuple shape. |
| `isDefaulted(address) → bool` | `is_defaulted(borrower) → bool` | ✅ | ✅ | Exact. |
| `minHoldDaysByTenor(uint16) → uint16` | (set-only via `set_min_hold_for_tenor`) | — | — | Not read by the frontend; no getter exposed (add if needed). |
| — | `preview_owed(borrower) → i128` | — | — | Convenience (owed without the principal tuple). |

### Writes

| EVM | Soroban | Inputs | Notes / reason |
|---|---|---|---|
| `setUserRisk(address,uint16,bool,uint64,uint256)` | `set_user_risk(account,score,kyc_ok,valid_until,limit)` | ✅ | Same 5 inputs. Owner-gated. |
| `setLoanOffer(address,uint16,uint16,uint64,uint256)` | `set_loan_offer(borrower,tenor_days,fee_bps,valid_until,max_amount)` | ✅ | Same 5 inputs. |
| `openLoan(address,uint256,uint16,uint16)` | `open_loan(borrower,principal,tenor_days,fee_bps)` | ✅ | Same 4 inputs. Vault-gated. Identical validation order. |
| `closeLoan(address,uint256 paid)` | `close_loan(borrower,paid)` | ✅ | Same. Vault-gated. |
| `markDefault(address)` | `mark_default(borrower)` | ✅ | Same. Owner-gated. |
| `setPremiumConfig(address,uint128,uint128)` | `set_premium_config(borrower,premium_rate_per_sec_wad,late_rate_per_sec_wad)` | ✅ | Same. |
| `accrueLate(address)` **onlyOwner** | `accrue_late(borrower)` **permissionless** | ✅ inputs | ⚠ **auth differs by design.** EVM is `onlyOwner` and its own NatSpec flags the resulting keeper-leak; the recommended fix (make it permissionless — it's idempotent, no attack surface) is applied here. |
| `setOwner(address)` | `set_owner(new_owner)` | ✅ | |
| `setVault(address)` | `set_vault(vault)` | ✅ | |
| `setDefaultGracePeriod(uint32)` | `set_default_grace_period(secs:u64)` | ✅ | Width widened to `u64` seconds. |
| — | `set_min_hold_for_tenor(tenor_days,min_hold_days)` | — | Additive: EVM seeds these only in the constructor; Soroban adds a runtime setter. |
| — | `upgrade(BytesN<32>)`, `__constructor` | — | `upgrade` replaces UUPS. |

---

## Eliminated contracts (architectural, justified)

| EVM | Soroban | Reason |
|---|---|---|
| `RiskManagerUncollat` (collateral hook reads `creditLimit`) | inline check in `vault.borrow_with_term` | Soroban calls are atomic; the `amount ≤ credit_limit` check lives in the borrow path. A separate contract adds no value. |
| `EVC` — `enableController`, `isControllerEnabled` | — | The EVC exists to batch/authorize cross-vault controller state on EVM. Soroban has atomic invocation + `require_auth()`; nothing to enable. |
| USDC `approve` / `allowance` | — | The Stellar Asset Contract `transfer` is authorized via `require_auth()` in the same tx; no pre-approval step. |

## Summary

- **Same name + inputs + outputs:** all admin setters, `open_loan`, `close_loan`,
  `mark_default`, `credit_limit`, `is_defaulted`, `next_borrow_time`,
  `preview_loan_with_late`, `manual_write_off`, `total_assets`, `balance_of`,
  `total_supply`, the deposit/withdraw/redeem **returns**.
- **Justified divergences:** `receiver`/`owner` collapse (no `msg.sender`); `repay`
  drops its always-full `amount`; `get_loan` returns a superset; public-mapping
  getters become `get_*`; integer widths; `accrue_late` made permissionless (bug
  fix); EVC/RiskManager/approve eliminated; `debtOf`/`repayWithShares` not ported
  (unused by the frontend).
