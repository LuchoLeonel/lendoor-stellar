# Review — `scf/t2-hardening` (SCF #45 Tranche 2: D2.2 DeFindex routing + D2.3 custody hardening)

Independent security review of the contract changes (`contratos/common`, `contratos/vault`,
`contratos/loan-manager`) run on 2026-11-27 against commits `8d6781be..da337fab`, before any push.
Reviewer scope and method: full read of the diff and the current files, suites executed one crate at
a time (`cargo test -p … -j 2`), the built vault wasm checked against the hash uploaded to testnet.
No fund-stealing bug was found. 18 findings; what was done with each is below. Suites after the
fixes: **common 11, vault 134, loan manager 83**.

## A. Must fix before any real pair — all addressed

| # | Finding | Resolution |
|---|---|---|
| A1 | `push` had no value floor: a lossy DeFindex deposit (fee, rounding) would bleed LP price tranche after tranche; only `pull` had `min_out_bps`. | `strategy.rs::push` now requires `assets_after - assets_before ≥ bps_of(amount, min_out_bps)` after the strict sync, else `StrategyShort`. Pinned by `push_with_a_lossy_deposit_reverts` (floor arithmetic) and `push_at_a_price_above_par_keeps_total_assets_and_mints_fewer_shares`. |
| A2 | Pull-on-demand does up to 3 DeFindex view-writes + a Blend withdraw in one LP tx; mainnet budget unmeasured; "LP ops keep working when DeFindex is down" only covers contract panics, not budget exhaustion / archived entries. | `pull` reuses the valuation when a sync already ran in the same ledger (one view-write less). Budget measurement on the real pair is now an explicit go/no-go item for T2-B (`DEPLOYMENTS.md`). The caveat is written into the threat model (residual risk 5). |
| A3 | Unconditional fee transfer coupled every repay to the fee recipient's trustline: a missing/deauthorized trustline would block all repayments. | Fees now **accrue** in the vault (`FeesAccrued`, excluded from `total_assets` and from every liquidity check via `available_cash`) and are pulled with `claim_fees()` (anyone can call; money only goes to `fee_recipient`). Event `feeclaim`. Tests: `fees_accrue_and_are_claimed_without_touching_lp_assets`, `accrued_fees_are_not_lendable_nor_withdrawable`; all fee assertions in the suite go through `claim_fees`. |
| A4 | `min_out_bps = 10_000` allowed: DeFindex's floor rounding makes every pull 1 stroop short → every exit crossing idle would revert. | `set_buffer` caps `min_out_bps` at 9_999 (`BadBuffer` otherwise). |
| A5 | Test gaps. | Added: stranger signatures on `set_buffer` / `propose_strategy` / `execute_strategy` / `cancel_strategy` / `emergency_unwind` (`strategy_admin_functions_reject_a_stranger_signature`); `every_write_requires_auth` extended to `accept_admin`, `cancel_admin_transfer`, the strategy surface, `rebalance`, `emergency_unwind`; operator/pauser cannot execute a matured upgrade (vault) and underwriter/pauser cannot (loan manager); push at DeFindex price ≠ 1; tolerated haircut on withdraw (loss shared, position right) and on redeem (re-priced after the pull); position smaller than the deficit → `InsufficientCash` with the position intact; loan-manager pause blocks a borrow through the vault; stranger cannot accept a pending admin transfer; `deposit_from` soft-syncs. |

## B. Robustness — addressed unless noted

| # | Finding | Resolution |
|---|---|---|
| B6 | `redeem` priced before the pull, `withdraw` after → a tolerated haircut fell 100 % on the remaining LPs in `redeem`. | `redeem` re-prices after `ensure_cash`; test `redeem_reprices_after_a_tolerated_haircut`. |
| B7 | `ensure_cash` pulled `max(tranche, deficit)`: a withdraw 1 unit above idle dragged a whole tranche home and back (grief, rounding). | Pulls `ceil(deficit · 10 000 / min_out_bps)` capped at the position. The keeper restores the buffer in tranches on its own schedule. |
| B8 | `rebalance` panicked `StrategyDisabled` before the pull branch when `tranche == 0`. | Pull branch works with routing disabled; `StrategyDisabled` only when there is nothing to do either way. |
| B9 | `sync` treated an empty `Vec` as `assets = 0` (PPS collapse via permissionless `sync_strategy`). | Only a 1-element answer counts; anything else is a failed sync. |
| B10 | `emergency_unwind` withdrew the cached share count and wrote `assets: 0` for any remainder. | Uses DeFindex's live `balance(vault)`; remainder valued pro-rata of the last known value, then a best-effort sync. |
| B11 | `execute_strategy` validated only `assets[0]`. | Requires exactly one asset. |
| B12 | No expiry on matured proposals; re-proposing silently overwrote. | `PROPOSAL_WINDOW` = 7 days after `eta` (`GovError::ProposalExpired` / `StrategyProposalExpired`); re-proposing emits a cancel event first. Tests `matured_upgrade_expires_after_the_window`, `non_admin_cannot_execute_a_matured_upgrade_on_the_loan_manager`. |
| B13 | `set_role(Pauser)` and LM `set_vault` are instant (timelock asymmetry). | **Accepted and documented**: the timelock is LP notice-to-exit (pause never blocks exits), not a defense against a rogue admin, which the 2-of-3 is for. `vaultset` and `roleset` are paged by the monitoring plan (I10). |
| B14 | Checked-math leftovers: unbounded `set_default_grace_period` could overflow `due + grace`; `idle_target + tranche` plain; unused `GovError::MathOverflow`. | Grace bounded to 365 d (`grace_period_is_bounded`); `idle_target + tranche` checked; the unused code became `ProposalExpired`. |
| B15 | `manual_write_off` is admin-gated (2-of-3 per write-off). | **Kept** on purpose: write-offs are accounting decisions, taken manually today; the runbook states the 2-signature flow. Revisit if volume makes it operationally heavy (move to Operator). |
| B16 | `max_withdraw` ignored the slippage floor on the strategy part. | Strategy part is netted by `min_out_bps`. |
| B17 | Pause never blocks exits: removes the classic incident lever (cheap-share exploit exits during the incident). | **Accepted and documented** in the threat model; an admin-only `freeze_exits` with auto-expiry is listed as a candidate for Tranche 3 after the Audit Bank review. |
| B18 | Interface changes vs app/backend; LM doc comment said "6 decimals"; zero-amount transfer events on zero-fee repays. | Interface changes are the intended ones and are summarized in `DEPLOYMENTS.md`; comment fixed (7 dp); the zero-amount transfer events no longer exist (fees accrue). |

## Checked and found sound by the reviewer

Hash-swap / eta-reset / execute-after-cancel on the timelock; `authorize_as_current_contract`
arguments match DeFindex's `transfer(from, self, amount)`; soft-sync before every share-pricing
operation closes the stale-cache sandwich; seed shares are unredeemable; `GovKey`/`DataKey` names
do not collide; write-off clamps keep `total_borrows` from double-decrementing; `apply_payment`
partial-branch invariants hold.

## Consequence for the deployed testnet pair

T2-A was deployed from the pre-review wasm (`9d91a27f…`). The post-review wasm is applied through
the contract's own timelocked upgrade (2 signatures, 600 s), which is also the second on-chain
exercise of that path; hashes in `docs/deliverables/scf-tranche2/d2.3-hardening-evidencia.md`.
