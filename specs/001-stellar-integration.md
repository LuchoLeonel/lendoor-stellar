# 001 — Stellar integration (load-bearing)

Goal: make the credit lifecycle **run on Stellar**, so the integration powers the product (judging criterion #1 & #4). This spec orients the work; the Soroban contracts themselves live in `contratos/` and are a separate workstream.

## Architecture

```
[ frontend (Freighter) ]  --signs txs-->  [ Stellar testnet ]
        |                                        ^
        v                                        |
[ backend (NestJS) ] --reads/indexes events--> [ Soroban: CreditRegistry + LoanManager ]
        |                                        |
   [ Postgres ]  <-- persists loans/score        +-- USDC (Stellar Asset Contract)
```

## Soroban contracts (in `contratos/`, Rust — separate terminal)
Two small contracts, composed:

- **CreditRegistry** — the moat. Stores `score` + `limit` per wallet; an `underwriter` role writes it (the off-chain risk model's signer); `record_repayment` bumps the limit on good repayment.
- **LoanManager** — the uncollateralized pool. `borrow` checks the registry limit and transfers **USDC on Stellar** with no collateral; `repay` pulls it back and calls `record_repayment`.

This README/spec only describes them — the contract code is written separately.

## Frontend seam (re-point EVM → Stellar)
Today the front uses wagmi/viem (EVM). Swap for:
- **Freighter** wallet connect (`@stellar/freighter-api`) for the web companion.
- `@stellar/stellar-sdk` (Soroban RPC) to read credit limit / build & submit `borrow`/`repay`.
- Replace the contract-call hooks/providers (`providers/ContractsProvider`, `providers/WagmiProvider`, `hooks/*`) with Stellar equivalents.
- Show the **Stellar testnet explorer link** (stellar.expert) after each tx — proves it is real and load-bearing.

## Backend seam (EVM chain-sync → Stellar)
- Today `loan/chain-sync.service.ts` uses `ethers`. Swap for Soroban RPC event reading (`@stellar/stellar-sdk`) to index loan/repayment events and persist to Postgres (the DB base already exists).
- Keep the DB persistence, wallet (SIWE-style) auth, and email/phone verification as-is.

## Minimal demo path (testnet)
0. **Mock the exchange identity** — stand in for being embedded in Bitso: a fake "exchange directory" hands the app a KYC-verified identity (a random name), so the user starts already verified (no re-KYC). This mirrors the live Lemon `authenticate()` → `lemon-profile` flow.
1. Underwriter sets a wallet's score/limit (simulates the risk model writing on-chain).
2. Borrower connects Freighter → sees the limit.
3. Borrower borrows USDC (no collateral) → wallet receives USDC, loan persisted in DB.
4. Borrower repays → limit goes up. Show the explorer txs.

## Stretch (only if time)
- Anchor on/off-ramp (SEP-24/31) for the loan disbursement to pesos — the strongest "load-bearing" upgrade, ties into Transferencias 3.0. Promise nothing; keep as upside.

## Non-negotiables for eligibility
- Public repo + this README ✓
- The Stellar integration must power a real part of the flow (the loan itself), not be cosmetic ✓
- Live **testnet** deployment of the contracts + a working tx in the demo ✓
