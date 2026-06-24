# Lendoor Stellar

**Embedded credit infrastructure for Latin America's credit-invisible, on Stellar.**

Built for the **PULSO Hackathon** (NearX × Stellar Development Foundation, Argentina track).

Lendoor is the credit layer that a wallet plugs into to extend uncollateralized, on-chain credit to the 186M+ adults in LatAm the formal financial system can't score. This repo ports that base from Celo/EVM to **Stellar (Soroban)**, with the credit lifecycle running in USDC on Stellar.

---

## The bet

There is a live version of Lendoor already running on Celo, distributed inside the **Lemon** wallet. This project makes the same move on a different stack:

> **Lemon on Celo → Bitso on Stellar.**

Same thesis (embedded credit for the credit-invisible), swapped to the rails where it can scale fastest in the region: **Bitso** as the distribution surface (one of LatAm's largest crypto wallets, already a Stellar ecosystem player) and **Stellar + USDC** as the money rail. The goal of this repo is to be *what Lendoor is, but inside Bitso and on Stellar*.

## Why now (and why Stellar)

- **186M+ credit-invisible adults** in LatAm: people the formal system can't underwrite, so they never get credit.
- Argentina's **Transferencias 3.0** is redefining local payment flows, while demand for **digital dollars** is among the highest in the region.
- The payment rails are getting solved. The missing layer is **credit on top of those rails**, for people no one can score without collateral.
- Stellar gives us cheap, fast USDC settlement and a real LatAm anchor/wallet ecosystem (Bitso among them) to reach those users.

## How it works

1. **Identity comes from the exchange, not from us.** Because Lendoor is embedded inside the wallet/exchange, it **leverages the exchange's KYC**: the user is already identity-verified, so there is no separate onboarding/KYC step. The exchange passes verified identity claims (name, etc.) to the credit layer. (The live version already does this via Lemon's `authenticate()`; the Stellar version does it via the exchange, e.g. Bitso.)
2. The protocol issues a small **uncollateralized** USDC loan on Stellar, sized by the user's on-chain credit limit.
3. Repaying on time **raises the limit** — a credit ladder ($1 → larger tickets) that compounds trust.
4. The repayment history becomes a **portable on-chain score** that travels with the user across integrations.

The hard, defensible part is not the lending pool. It is **underwriting the invisible without collateral**, riding the exchange's KYC for frictionless onboarding, and owning the **portable repayment data**.

> **For the demo:** we mock being embedded inside an exchange — it hands the credit layer a KYC-verified identity (e.g. a random name pulled from a fake exchange directory), so the loan flow starts from an already-verified user, exactly as it would inside Bitso. No re-KYC, no forms.

## Stellar integration (load-bearing, not on a slide)

The credit lifecycle itself runs on Stellar — this is the load-bearing integration the hackathon asks for:

- **Soroban smart contracts** (in `contratos/`, written in Rust — see below): a credit registry that holds each wallet's score/limit, and a loan manager that disburses and collects **USDC on Stellar** uncollateralized, updating the score on repayment.
- **USDC on Stellar** as the money rail for disbursement and repayment (testnet for the hackathon, mainnet as a scoring advantage).
- Optional: **anchor integration (SEP-24/31)** for fiat on/off-ramp of the loan, tying into the Transferencias 3.0 reality.

> `contratos/` is reserved for the **Soroban (Rust)** contracts and is built in a separate workstream. This README orients the project; it does not implement the contracts.

## Repo structure

```
lendoor-stellar/
├── frontend/    # the Lendoor mobile app front (admin + email/voice tooling removed)
├── backend/     # base: wallet auth (SIWE) + blockchain sync + DB persistence + email/phone verification
├── contratos/   # Soroban smart contracts (Rust) — separate workstream
└── specs/       # hackathon orientation: thesis, Stellar integration, customer discovery, submission checklist
```

> **Doing the contract↔backend↔frontend wiring?** Start at [`specs/004-wiring-task.md`](specs/004-wiring-task.md) — it points you to the narrative, the product, and your exact task (the EVM→Soroban swap), plus the migration how-to in `contratos/`.

### frontend/
The same mobile app front as Lendoor (Home, Borrow, Lend, Stats, Wallet Link). The wallet/contract layer currently targets EVM (wagmi/viem) and is the seam to re-point to Stellar (Freighter + Soroban).

### backend/
NestJS, pruned to the base: SIWE wallet login, blockchain connection + chain-sync, DB persistence (TypeORM + Postgres), and email + phone verification (dev OTP placeholders). The EVM chain integration is the seam to swap for `@stellar/stellar-sdk` / Soroban RPC. Compiles clean (`tsc --noEmit`).

## Deliberately out of scope (kept lean for the port)

Risk model, emailing/notification system, admin panel, and AI collections were **not** carried over from the Lendoor original. This is a clean base.

## How this maps to the judging criteria

- **Integration depth & technical complexity** — the full credit lifecycle (disburse, repay, score) runs on Soroban + USDC, two composed contracts, not a single call.
- **Impact on the Stellar ecosystem** — uncollateralized credit for the credit-invisible is a use case Stellar doesn't have today, and it plugs into the AR digital-dollar reality.
- **Customer discovery & validation** — see `specs/002-customer-discovery.md` (real Bitso/wallet users + a fintech operator).
- **Quality of testnet/mainnet deployment** — load-bearing testnet deploy; the live Celo version is evidence the model already works.

## Team & origin

Derived from the live Lendoor codebase (Celo/EVM, cashflow-positive, real loans on mainnet). This is the Stellar-native base for the PULSO build.
