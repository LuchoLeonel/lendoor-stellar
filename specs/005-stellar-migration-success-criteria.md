# 005 — Stellar mode success criteria

Use this as the final go/no-go checklist for **Stellar-mode flows** after
wiring Soroban support alongside the existing EVM paths.

This spec does **not** require removing EVM support. It verifies that a user
running the app in Stellar mode can complete the borrow/repay lifecycle on
Stellar testnet with backend and frontend state in agreement.

Stellar mode is successful only if every required item below passes.

## 1. Blockchain contracts

Required proof:

- `contratos` contract tests pass.
- Soroban testnet deployment addresses are configured for:
  - loan manager
  - vault
  - token/SAC used as USDC stand-in
- A testnet wallet can complete:
  - deposit liquidity
  - set user risk/credit limit
  - set loan offer
  - borrow
  - repay
- Borrow and repay txs are visible on `stellar.expert` testnet.

Pass condition:

```text
Soroban contracts execute the full credit lifecycle on testnet.
```

## 2. Blockchain -> Backend

Required proof:

- Backend reads a `G...` Stellar wallet credit limit from Soroban.
- Backend writes/refreshes user risk and credit limit on Soroban.
- Backend creates a loan offer on Soroban.
- Backend reads active loan state from Soroban.
- Backend verifies a repay tx by Stellar tx hash.
- Backend chain sync reads Soroban events by ledger cursor idempotently and persists loan state.
- Replayed events or duplicate tx hashes do not create duplicate loans or double-apply repayments.
- Backend stores Stellar addresses without lowercasing or converting them.

Pass condition:

```text
Backend DB state matches Soroban state for the test wallet.
```

Minimum commands/checks:

```bash
cd backend
yarn test
yarn build
```

Also run one real testnet backend smoke test against the deployed contracts.

## 3. Blockchain -> Frontend

Required proof:

- User can connect a Stellar wallet, preferably Freighter, on testnet.
- Frontend displays the connected `G...` address correctly.
- Frontend reads credit limit from Soroban.
- Frontend builds and submits borrow tx through the Stellar wallet.
- Frontend builds and submits repay tx through the Stellar wallet.
- In Stellar mode, frontend does not use EVM-only flows:
  - no `approve`
  - no `allowance`
  - no EVC/controller enable step
  - no `MaxUint256` repay sentinel
- Success UI shows Stellar tx hashes and `stellar.expert` links.

Pass condition:

```text
A user can borrow and repay from the UI using a Stellar wallet on testnet.
```

Minimum commands/checks:

```bash
cd frontend
yarn test
yarn build
npx playwright test
```

Automated UI tests may mock the Stellar wallet. A final manual smoke test should
use real Freighter signing.

## 4. Backend -> Frontend

Required proof:

- Frontend API calls send Stellar-shaped data:
  - wallet address is `G...`
  - tx hash is a Stellar tx hash
  - explorer URL is `stellar.expert`
- Backend accepts Stellar wallet addresses in all user/loan endpoints.
- Backend accepts Stellar tx hashes for open/repay reporting.
- Backend rejects non-Stellar wallet addresses and non-Stellar tx hashes at Stellar-mode endpoints.
- Existing app responses still power:
  - onboarding state
  - credit limit
  - loan terms
  - active loan
  - repayment status
  - score/limit updates
- Any EVM-specific API names that remain are only compatibility names, not EVM
  behavior.

Pass condition:

```text
The existing app flow still works with Stellar addresses and tx hashes.
```

## 5. Full end-to-end acceptance test

Run this exact flow on Stellar testnet:

```text
1. Start backend.
2. Start frontend.
3. Connect Freighter testnet wallet.
4. Backend/operator creates the wallet credit limit and loan offer on Soroban.
5. Frontend shows the credit limit and loan offer.
6. User borrows from the UI.
7. Borrow tx succeeds on Stellar testnet.
8. Borrow tx link opens on stellar.expert.
9. Backend records the open loan in Postgres.
10. User repays from the UI.
11. Repay tx succeeds on Stellar testnet.
12. Repay tx link opens on stellar.expert.
13. Backend records the repayment in Postgres.
14. Frontend shows updated loan/score/limit state.
```

Pass condition:

```text
One fresh test wallet completes borrow -> repay through the app, and chain,
backend DB, and frontend UI all agree.
```

## 6. Hard fail conditions (Stellar mode)

Stellar mode is not ready if any of these are true:

- Any **Stellar-mode** borrow/repay/onboarding flow still depends on an EVM
  wallet, EVM address format, or EVM tx hash format.
- Stellar addresses are lowercased.
- Borrow or repay only works through scripts, not through the app.
- Backend DB disagrees with Soroban loan state after sync.
- Replayed Soroban events or repeated tx-hash reports mutate loan state twice.
- Stellar-mode endpoints accept EVM wallet addresses or `0x` transaction hashes.
- Frontend shows a success state for a tx that is missing or failed on Stellar.
- Explorer links do not open the correct Stellar testnet tx.
- Tests only pass with mocked chain behavior and no real testnet smoke test was run.

## Final verdict format

An agent verifying the migration should report:

```text
Verdict: PASS or FAIL

Contracts:
- command/results
- deployed contract addresses
- network/testnet identifier
- testnet tx links

Backend:
- command/results
- DB vs Soroban check

Frontend:
- command/results
- wallet/UI check

End-to-end:
- wallet used
- borrow tx link
- repay tx link
- DB loan id
- remaining gaps, if any
```
