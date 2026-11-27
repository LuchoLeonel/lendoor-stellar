# On-chain monitoring plan — SCF #45 Tranche 2, D2.4

What we watch, where it comes from, what triggers an alert and what already exists. Companion of
[`threat-model.md`](./threat-model.md).

## 1. Sources

- **Contract events** via Soroban RPC `getEvents` (the backend already ingests `loanopen` /
  `loanclos` with a durable cursor: `backend/src/loan/chain-sync.service.ts`,
  `soroban-blockchain.gateway.ts`).
- **State reads** (simulation only, no fees): `total_assets`, `total_supply`, `is_paused`,
  `pending_upgrade`, `pending_strategy`, `strategy_position`, `buffer`, `get_role`; on our DeFindex
  vault `fetch_total_managed_funds`, `balance(vault)`; on the Blend pool `get_reserve(asset)`.
- **Horizon**: the admin account's signers / thresholds and its transaction stream.

## 2. Events to index (new in Tranche 2)

| Event | Emitted by | Meaning |
|---|---|---|
| `seeded(payer) → (assets, shares)` | vault constructor | the enforced seed deposit |
| `roleset(role) → addr`, `adminprop`, `adminacc`, `admincncl` | both contracts | role changes and admin transfer steps |
| `pause → caller`, `unpause → admin` | both | pause state |
| `upgprop → (hash, eta)`, `upgexec → hash`, `upgcancl → caller` | both | timelocked upgrade lifecycle |
| `stratprop → (strategy, eta)`, `stratexec → strategy`, `stratcncl → caller` | vault | timelocked strategy change |
| `bufset → (idle_target, tranche, min_out_bps)` | vault | buffer policy |
| `stratin → (amount, shares_minted, assets_after)` | vault | push into DeFindex |
| `stratout → (want, received, shares_burned, assets_after)` | vault | pull from DeFindex |
| `sync → (old_assets, new_assets)`, `syncfail → cached_assets` | vault | position refresh / DeFindex unreachable |
| `unwind → (received, shares_left)` | vault | emergency unwind |
| `feerecip → addr`, `graceset → secs`, `minhold(tenor) → secs`, `vaultset → addr` | admin setters | config changes |
| `feeclaim(recipient) → amount` | vault `claim_fees` | protocol fees pulled out (fees accrue in `fees_accrued()` until then) |

Existing events keep their shape: `deposit`, `dep_from`, `withdraw`, `redeem`, `borrow`, `repay`,
`partrepay`, `writeoff` (vault); `riskset`, `offerset`, `loanopen`, `loanclos`, `partpay`, `default`,
`premium` (loan manager).

## 3. Invariants and alerts

| # | Check (every 10 min, keeper cadence) | Alert when | Severity |
|---|---|---|---|
| I1 | `total_assets == cash + total_borrows + strategy_position.assets` (recompute from reads) | mismatch ≠ 0 | critical |
| I2 | share price `total_assets / total_supply` vs previous sample | drop not explained by a `writeoff` or `stratout.received < want` in the same window | critical |
| I3 | `strategy_position.assets` vs a fresh `get_asset_amounts_per_shares(shares)` read (simulation) | drift > 20 bps, or `last_sync` older than 1 h while `shares > 0` | high |
| I4 | `strategy_position.shares` vs DeFindex `balance(vault)` | different | critical |
| I5 | `cash < buffer.idle_target` | sustained for > 3 samples (keeper not pulling) | medium |
| I6 | any `syncfail` event | first occurrence | high |
| I7 | any `stratout` with `received < want * min_out_bps / 10_000` | should be impossible (the tx reverts); any occurrence = bug | critical |
| I8 | `is_paused() == true` | state change | high (page) |
| I9 | `pending_upgrade` / `pending_strategy` not null | new proposal: page with hash/strategy and `eta`; remind 1 h before `eta` | high |
| I10 | any `roleset`, `adminprop`, `adminacc` | state change | high |
| I11 | admin account: signers or thresholds changed (Horizon) | any change | critical |
| I12 | Blend pool `get_reserve(asset)` utilization = `d_supply*d_rate / (b_supply*b_rate)` | > 95 % (pulls may fail) | medium |
| I13 | DeFindex strategy `paused == true` (`get_assets`) or our DeFindex vault `fetch_total_managed_funds` invested share < 90 % | state change | medium |
| I14 | `riskset` count per hour from the underwriter | > 3× the 7-day median (possible key misuse) | high |
| I15 | loan-manager `pending_upgrade` and vault `pending_upgrade` proposed by the same tx stream without a matching announcement | manual | — |
| I16 | `fees_accrued()` growing without a `feeclaim` for > 7 days (the recipient's trustline may be broken: repayments are unaffected, but the fees are stuck until it is fixed) | > 7 days | low |

## 4. What exists today vs what Tranche 2 adds

| Piece | Today | Tranche 2 |
|---|---|---|
| Error reporting | Sentry (`backend/src/config/sentry.ts`) when `SENTRY_DSN` is set | alerts above are raised as Sentry events with the invariant id |
| Health | `GET /health`, `GET /health/db-chain-parity` | add `GET /health/vault-invariants` returning I1–I5, I8, I9 as JSON for an external uptime checker |
| Indexer | `chain-sync` BullMQ jobs (`sync-loans` 10 min, `renew-offers` 6 h, `sync-late-fees` 10 min) with a durable `ChainScanCursor` | new job `vault-invariants` (10 min) that runs the reads in §3 and a `strategy-keeper` job (10 min, T2-B only) that calls `sync_strategy` and `rebalance` with the operator key |
| Governance watch | — | subscribe to the governance events above and to the admin account's Horizon stream; page on I8–I11 |

The keeper and the invariants job are implemented as `chain-sync` processors so they inherit the
existing cursor, retry and logging; the operator key is a separate env var (`STELLAR_OPERATOR_SECRET`
stays the underwriter; `STELLAR_KEEPER_SECRET` is the operator role). No alert is routed to the
borrowers' WhatsApp channel; they are internal (Sentry + on-call).

## 5. Runbook snippets

- **Pause** (on-call key): `stellar contract invoke --id <vault> --source <pauser> -- pause --caller <pauser>`; the same on the loan manager. Exits and repayments keep working.
- **Resume** (admin, 2 signatures): `contratos/scripts/admin-multisig-setup.sh invoke <vault> unpause`.
- **Veto an upgrade / strategy change** (on-call): `cancel_upgrade --caller <pauser>` / `cancel_strategy --caller <pauser>`.
- **Bring strategy funds home** (on-call or admin): `emergency_unwind --caller <pauser>`; it accepts whatever DeFindex returns and works while paused.
- **Rotate the underwriter** (admin, 2 signatures): `invoke <loan-manager> set_role --role Underwriter --account <new key>` then update the backend env.
