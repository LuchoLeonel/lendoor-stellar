# SCF #45 — Tranche 2 (Testnet, $25 500): evidence index

Same format as [Tranche 1](../scf-tranche1/README.md): one row per deliverable with the award's
measure of completion, how we meet it, the evidence and the code. Status as of **2026-11-27**.

| Deliverable | Measure of completion (award text) | Evidence | Code | Status |
|---|---|---|---|---|
| **D2.1 — Privy end-to-end in the credit flow** ($4k) | an end-to-end testnet run: onboard via Privy, borrow, repay, score update | `d2.1-privy-e2e-evidencia.md` (recorded run on pair T2-A, hashes, score before/after) | frontend signer registry + `WalletProvider` fix, backend `inform-repayment` → `set_user_risk`; PRs listed in the doc (incl. #4, #7, #12 from Tranche 1) | ⏳ app/backend code ready on the branch; recording pending the T2-A cutover of the public site |
| **D2.2 — DeFindex idle-buffer** ($12k) | testnet run showing deposit into DeFindex, visible yield accrual, funds pulled back to serve a borrow | `d2.2-defindex-evidencia.md` (pair T2-B: `stratin`, two `sync` reads with growing `total_assets`, a borrow with `stratout` in the same tx) | `contratos/vault/src/strategy.rs`, mock + 16 tests; spike `413f0b86…` / `006f351c…` | ⏳ contracts done and tested; T2-B deploy waits for BlendUSDC |
| **D2.3 — Production hardening** ($8k) | upgrades gated by multisig and timelock; pause blocks borrow and deposit; roles and math covered by tests | [`d2.3-hardening-evidencia.md`](./d2.3-hardening-evidencia.md): `TxBadAuth` with 1 signature, `upgprop` with 2, `#106` before `eta`, `upgexec` after; pause → `#102` on deposit/borrow; roles/math test list | `contratos/common` (gov + math), vault + loan manager; 11 + 134 + 83 tests (after the independent review, `docs/reviews/pr-t2-hardening.md`) | ✅ on T2-A |
| **D2.4 — Threat model + monitoring + adversarial tests** ($1.5k) | threat model and monitoring docs, adversarial suite passing | [`docs/security/threat-model.md`](../../security/threat-model.md), [`docs/security/monitoring-plan.md`](../../security/monitoring-plan.md), adversarial blocks in `contratos/*/src/test.rs` | — | ✅ docs; keeper + invariants jobs in the backend ⏳ |

**Pairs** (testnet, same wasm): T2-A Circle USDC — vault `CA23BR7WLIPAA2SGYXTGCFSWJEIIFM2YI2QWN2ES6EJQ5VGROM5W4BZ3`,
loan manager `CCJTYVKKRD5MQI7BLHF4BYAYFXZS5S5J3SZ33ZXTJC4SA55V27NUBGX2`; T2-B BlendUSDC + Lendoor's own
DeFindex vault — pending. Full table, roles and scripts: [`contratos/DEPLOYMENTS.md`](../../../contratos/DEPLOYMENTS.md).

**Scope note for reviewers (same kind as D1.1's "Base instead of Celo"):** DeFindex's testnet
strategies settle in Blend's test USDC, not in Circle's testnet USDC that our canonical pair uses.
The D2.2 run therefore happens on a second instance of the identical contract (T2-B). On mainnet
both are the same Circle USDC.

**Tranche 1 notes addressed here:** D1.2 PRs #4 and #12 are listed next to #7 in the D2.1 doc; the
D2.1 recording shows explicitly which loan follows the KYC approval; the CCTP retry/reconciliation as
a running service is scheduled for D3.3.

Video (≤ 5 min, four segments): pending.
