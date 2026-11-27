# Lendoor on Soroban — Threat model (STRIDE) — SCF #45 Tranche 2, D2.4

Scope: the Tranche 2 contracts (`contratos/vault`, `contratos/loan-manager`, `contratos/common`) as
deployed on testnet pair T2-A (and T2-B with a DeFindex strategy), the backend that holds the
`underwriter` key, the keeper that holds the `operator` key, the Privy / Freighter signing path in the
frontend, and the CCTP executor. Date: 2026-11-27. Each threat names the mitigation in code and the
test that pins it (`contratos/*/src/test.rs`, `contratos/common/src/test.rs`).

## 1. Assets and trust boundaries

| Asset | Where | Who can touch it |
|---|---|---|
| LP principal + realized interest (USDC in the vault) | vault contract balance | LPs (own shares only), borrowers (via `borrow_with_term` within credit line), the DeFindex strategy (only through `rebalance` / pull-on-demand / `emergency_unwind`) |
| Share price integrity (`total_assets / total_supply`) | vault storage (`TotalShares`, `TotalBorrows`, `StrategyPos`) + live token balance | every LP, borrow and strategy operation |
| Credit records (score, KYC flag, limit, offer, loan state) | loan-manager persistent storage | `underwriter` key (backend), the vault (open / apply payment) |
| Admin powers (roles, fee sink, upgrade, strategy, buffer) | `gov` storage | `admin` = 2-of-3 Stellar account |
| DeFindex position (shares of our DeFindex vault) | DeFindex vault storage, mirrored in `StrategyPos` | the vault contract itself; DeFindex manager / emergency manager (us) on their side; Blend pool below them |
| Off-chain keys | backend `STELLAR_OPERATOR_SECRET` (underwriter), keeper key (operator), on-call key (pauser), 3 admin signers | ops |

Trust boundaries: user wallet ↔ frontend ↔ backend (SEP-53 auth) ↔ loan-manager; vault ↔ loan-manager
(vault-only entry points); vault ↔ USDC SAC; **vault ↔ DeFindex vault ↔ Blend strategy ↔ Blend pool
↔ (Soroswap for BLND harvests, not our surface)**; CCTP executor ↔ Iris ↔ CctpForwarder ↔ vault
(`deposit_from`).

## 2. STRIDE by component

### 2.1 Vault — LP side

| Threat | Scenario | Mitigation | Test |
|---|---|---|---|
| **S**poofing: deposit shares to someone else's benefit / withdraw someone else's | call `withdraw(from = victim)` with the attacker's signature | `from.require_auth()` on every LP entry; `deposit_from` authorizes only the payer | `every_write_requires_auth`, `deposit_from_requires_payer_auth_never_beneficiary` |
| **T**ampering: first-depositor / donation inflation | donate USDC to an empty vault so an honest deposit mints 0 shares and is swallowed | decimals offset 3 (1 000 virtual share units per asset unit) + an enforced seed deposit whose shares are locked in the vault address, so supply is never 0; `ZeroShares` guard kept as defense in depth (now needs a ≈1 000× donation to trip) | `seed_is_locked_in_the_contract_and_enforced`, `donation_before_first_deposit_is_blocked_no_fund_loss`, `tiny_deposit_at_high_price_now_reverts_instead_of_losing_funds`, `deposit_from_donation_guard_still_bites_no_fund_loss` |
| **T**: dust loss on withdraw | exact-asset withdraw burns too few shares and leaks value | `to_shares_ceil` on `withdraw` | `withdraw_ceil_rounds_up_at_price_above_one` |
| **T**: math overflow | `assets * (ts + VS)` beyond i128 | all conversions and fees through `mul_div_floor/ceil` over I256; typed `MathOverflow` | `share_math_overflow_is_a_typed_error_not_a_trap`, `mul_div_no_intermediate_overflow` |
| **D**oS: pause traps LP funds | governance pauses and LPs cannot exit | pause blocks only `deposit`, `deposit_from`, `borrow_with_term`, strategy push; `withdraw` / `redeem` / `repay*` / pull-on-demand / `emergency_unwind` stay open | `pause_blocks_new_exposure_but_never_exits_or_repayments`, `pause_blocks_investing_but_not_pulling_or_unwinding` |
| **D**: a repayment blocked by the fee path | a fee transfer that simulates as 0 but executes > 0 falls outside the footprint; a missing / deauthorized trustline on the fee recipient would fail every repay | fees **accrue** in the vault (`FeesAccrued`, excluded from `total_assets` and from all liquidity checks) and are pulled with `claim_fees()`; repayments never transfer to the recipient (review A3) | `fees_accrue_and_are_claimed_without_touching_lp_assets`, `accrued_fees_are_not_lendable_nor_withdrawable` |
| **I**nformation disclosure | — (all state is public by design) | — | — |
| **R**epudiation | admin actions without trace | every governance / strategy action emits an event (`roleset`, `adminprop`, `adminacc`, `pause`, `unpause`, `upgprop`, `upgexec`, `upgcancl`, `stratprop`, `stratexec`, `stratcncl`, `bufset`, `stratin`, `stratout`, `sync`, `syncfail`, `unwind`, `seeded`, `feerecip`) | `admin_actions_emit_events`, `strategy_events_are_emitted_per_action` |

### 2.2 Vault — credit side

| Threat | Scenario | Mitigation | Test |
|---|---|---|---|
| **S**: borrow against someone else's credit line | `borrow_with_term(borrower = victim)` signed by the attacker | `borrower.require_auth()` | `attacker_cannot_borrow_against_victims_credit_line` |
| **E**levation: skip the credit gate | borrow more than the limit / with a stale offer | inline `credit_limit` check + loan-manager `open_loan` re-validates offer, tenor, fee, cooldown, atomically | `borrow_over_limit_fails`, `borrow_unwinds_when_open_loan_rejects_over_offer` |
| **T**: double-count a write-off | full payoff after `manual_write_off` subtracts principal twice | universal `principal_in_borrows` clamp | `full_payoff_via_partial_on_writtenoff_does_not_double_decrement` |
| **T**: griefing with `accrue_late` | rewind the accrual anchor | anchor only moves forward | `permissionless_accrue_cannot_rewind_anchor_and_double_charge_floor` |
| **D**: pathological late rate locks repayment | `late_rate` overflow traps `repay` | checked accrual skips the late tranche instead of trapping | `repay_survives_pathological_late_rate_no_lock` |

### 2.3 Vault — DeFindex strategy (D2.2 surface)

| Threat | Scenario | Mitigation | Test |
|---|---|---|---|
| **T**: stale price sandwich | deposit right before a big `sync`, redeem right after, capturing yield earned before the deposit | best-effort `soft_sync` at the start of `deposit`, `deposit_from`, `withdraw`, `redeem` | `deposit_soft_syncs_so_a_late_depositor_cannot_capture_unsynced_yield` |
| **T**: trusting DeFindex's reported amounts | DeFindex `withdraw` returns the requested amount, not the delivered one; a strategy returns less | the vault measures its own token-balance and share-balance deltas; delivery below `min_out_bps` reverts (`StrategyShort`) | `a_short_delivery_reverts_cleanly_and_keeps_state` |
| **T**: `get_asset_amounts_per_shares` is a write on DeFindex's side | pricing in a view would lock fees / change their state | position is CACHED; views never call DeFindex; only `sync`, `rebalance`, pulls and `unwind` touch it | `yield_shows_in_the_share_price_only_after_sync` |
| **D**: DeFindex down or paused | user operations fail because an external contract fails | LP ops fall back to the cache (`syncfail` event); only operations that NEED the strategy (a pull beyond idle cash) fail, cleanly | `strategy_down_lp_ops_keep_working_on_the_cache` |
| **T**: misconfigured strategy on another asset | admin points the vault at a DeFindex vault that settles in a different token | `execute_strategy` reads `get_assets()[0].address` and requires it to equal the vault asset; fails closed on decode errors | `strategy_change_is_timelocked_validated_and_vetoable` |
| **E**: swap the strategy under an open position | redirect funds to a malicious "strategy" | strategy change is timelocked AND requires `StrategyPos.shares == 0`; the pauser can veto | `strategy_cannot_change_while_the_position_is_open` |
| **T**: wrong auth frame for the token pull | `authorize_as_current_contract` mismatches DeFindex's transfer → funds pulled by nobody / call fails | the entry describes exactly `token.transfer(vault, defindex, amount)`; verified with the real DeFindex wasm on testnet (spike 0.2); `push` asserts the measured cash delta equals the tranche | testnet run `413f0b86…` / `006f351c…`; `rebalance_invests_one_tranche_per_call_until_the_buffer_is_reached` |
| **D**: operator stops rebalancing | idle sits uninvested (lost yield) or below target (slower exits) | pull-on-demand serves exits/borrows regardless of the keeper; `sync_strategy` is permissionless | `withdraw_pulls_a_tranche_from_the_strategy_when_idle_cash_is_short`, `borrow_is_served_from_the_strategy_in_the_same_transaction` |
| Inherited: Blend pool at max utilization | the DeFindex strategy cannot unwind because Blend has no free liquidity | pulls revert cleanly (`StrategyShort` / host error) and LPs can still exit from idle cash; monitoring alerts on Blend utilization and failed pulls; buffer sizing | — (operational, see monitoring plan) |
| Inherited: DeFindex / Blend upgrade or exploit | their code changes under us | our DeFindex vault is created with `upgradable = false` and we hold its manager and emergency roles; the strategy itself is Paltalabs' deployed, audited contract; `emergency_unwind` brings funds home at any time | `emergency_unwind_brings_everything_home_even_with_a_haircut` |

### 2.4 Loan manager

| Threat | Scenario | Mitigation | Test |
|---|---|---|---|
| **S**: fake vault opens loans | call `open_loan` from another contract | `cfg.vault.require_auth()` on `open_loan`, `close_loan`, `apply_payment` | `attacker_signature_cannot_satisfy_vault_gate_on_open_loan` |
| **E**: backend key does admin things | the leaked underwriter key rewires the vault or upgrades | role split: `underwriter` can only write risk / offers / premiums / defaults; `admin` (multisig) owns config, roles, upgrade | `underwriter_cannot_do_admin_things_and_admin_cannot_write_risk` |
| **T**: overflow in fee / due timestamp | absurd principal or tenor | `mul_div_floor` + `checked_add/mul` → `MathOverflow`; accrual uses `checked_add` and skips rather than traps | `open_loan_math_overflow_is_typed` |
| **D**: pause blocks repayment | — | pause blocks only `open_loan` and `set_loan_offer`; `apply_payment`, `close_loan`, `accrue_late` stay open | `pause_blocks_open_loan_and_new_offers_but_not_repayment_or_accrual` |

### 2.5 Governance (common `gov`)

| Threat | Scenario | Mitigation | Test |
|---|---|---|---|
| **E**: single compromised admin key | one key upgrades the wasm and drains | `admin` is a Stellar account with thresholds 2-of-3 (Soroban enforces the medium threshold on `require_auth`): proven on T2-A, 1 signature → `TxBadAuth`, 2 → success | on-chain `a27d702e…` (rejected) / `143e6312…`; `operator_and_pauser_cannot_act_as_admin` |
| **T**: instant malicious upgrade | even with 2 keys, an upgrade lands before anyone can react | `propose_upgrade` → `upgrade_delay` (600 s testnet, 48 h mainnet) → `execute_upgrade(same hash)`; hash mismatch and early execution revert; the pauser can `cancel_upgrade` | `timelock_gates_execute_and_pauser_can_veto`, `timelock_execute_before_eta_fails_wrong_hash_fails_cancel_clears` |
| **T**: admin handed to a typo'd address | lose governance forever | two-step `transfer_admin` / `accept_admin` | `admin_transfer_is_two_step_and_old_admin_keeps_control_until_accept` |
| **E**: pauser escalates | pauser resumes operations or changes roles | pauser can only pause and veto; `unpause` and `set_role` are admin-only; `set_role` cannot target Admin | `pauser_cannot_unpause_and_stranger_cannot_pause`, `set_role_cannot_target_admin_and_rotates_operator` |

### 2.6 Off-chain components

| Component | Threat | Mitigation / status |
|---|---|---|
| Backend underwriter key | key theft → arbitrary limits / offers | limited blast radius by the role split (no admin powers); limits are capped by the ladder logic in the backend; rotate via `set_role(Underwriter, …)` with 2 admin signatures; alert on `riskset` volume (monitoring plan) |
| Keeper (operator) | key theft → forced pushes into the strategy | pushes respect `idle_target` / `tranche` set by the admin and are blocked when paused; cannot change the strategy address; funds only move between the vault and the configured DeFindex vault |
| Privy / Freighter signing | wrong account signs (Freighter installed + Privy session) | D2.1 fix: the active signer's address is the primary account; auth tx payload checked by the backend (SEP-53) |
| CCTP executor | mint without deposit, double delivery | idempotency anchored on `is_nonce_used`; `deposit_from` rejects the vault as beneficiary; documented residual window in `docs/reviews/pr5-cctp-executor.md` |
| KYC gate | borrow without verification | `assertKycGate` on `/loan/borrow`; on-chain `kyc_ok` flag inside `credit_limit` |

## 3. Residual risks accepted (and why)

1. **Cached strategy value lags real yield** by up to the keeper interval (10 min) plus whatever an LP
   operation's soft-sync cannot refresh (DeFindex down). Impact: share price slightly under-states
   yield between syncs; it never over-states, because yield only enters on a successful read.
2. **Locked seed earns a slice of interest** forever (1 USDC at deploy; ~0.01 % of a 10 k pool). Same
   trade-off as Uniswap v2 dead shares / OZ virtual shares; negligible at scale.
3. **Blend liquidity risk** is inherited by LPs of the BlendUSDC pair: at 100 % utilization pulls fail
   until liquidity returns. Mitigated by the idle buffer, pull-on-demand ordering (idle first) and
   monitoring; not eliminated.
4. **Testnet-only artifacts**: the DeFindex strategy used on testnet settles in Blend's test USDC, so
   the D2.2 demo runs on a second instance of the same wasm (T2-B). On mainnet both are Circle USDC.
5. **Resource budget of a pull-on-demand transaction** (review A2): an LP exit that crosses idle cash
   runs up to two DeFindex view-writes plus a DeFindex→Blend withdraw in one transaction. Contract
   panics on DeFindex's side are caught (`try_`), but budget exhaustion or archived DeFindex entries
   fail the whole operation. The LP can always exit from idle cash, and `emergency_unwind` brings
   funds home. Measuring the real budget on T2-B is a go/no-go item before mainnet.
6. **Timelock scope** (review B13): the timelock on upgrades and strategy changes is **notice to exit
   for LPs**, not a defense against a rogue admin; that is what the 2-of-3 admin is for. Role changes
   (`set_role`) and the loan manager's `set_vault` are therefore instant and paged (monitoring I10).
7. **Pause never blocks exits** (review B17): by design, so governance can never trap LP funds. The
   cost is that a share-minting exploit could exit during an incident. The idle buffer, the
   `ZeroShares` guard, the offset + seed and the invariants (I1–I4) limit that surface; an admin-only
   `freeze_exits` with a short auto-expiry is a candidate for Tranche 3 after the Audit Bank review.
8. **`manual_write_off` needs two admin signatures** (review B15): write-offs are rare, manual
   accounting decisions; if volume grows the role moves to `operator`.

## 4. Audit plan (reviewer feedback, 2026-09-09)

Submit this document, `monitoring-plan.md` and the adversarial suite to the **SCF Audit Bank** before
any mainnet deployment; target window: Q1 2027, after Tranche 2 is accepted and before D3.2 (mainnet
cutover). The suite to hand over: `cargo test` in `contratos/` (common 11, vault 121, loan manager 81
at the time of writing) with the adversarial blocks named above.
