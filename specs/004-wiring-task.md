# 004 — Onboarding & task: wire the Soroban contracts to the app

> Single entry point for the engineer doing the contract↔backend↔frontend wiring (Steven). Read this first, then the files it points to.

## TL;DR
- **Product:** Lendoor is embedded credit infrastructure for LatAm's credit-invisible (the 186M+ adults banks can't score). It lends small, **uncollateralized USDC**; repaying on time raises your limit (a credit ladder) and builds a **portable on-chain score**.
- **This project:** the same thing, but on **Stellar (Soroban)** and aimed at distributing through **Bitso** (the way the live version runs on Celo via Lemon). Mental shortcut: *Lendoor, but inside Bitso, on Stellar.*
- **Your task:** the **Soroban contracts are already built** (`contratos/`). You wire them to the **backend** and **frontend** — replace the EVM connection (ethers / wagmi / viem) with Stellar (`@stellar/stellar-sdk` + Soroban RPC on the backend, Freighter on the frontend). You do NOT write contracts and you do NOT change product logic — just the chain seam.

## Read in this order
1. **`README.md`** (repo root) — the product, the narrative, the Bitso/Stellar bet. The story we pitch.
2. **`specs/000-overview.md`** — thesis + the enroque (Lemon/Celo → Bitso/Stellar), scope discipline, framing.
3. **`specs/001-stellar-integration.md`** — the target architecture and the load-bearing integration (what must run on Stellar).
4. **`contratos/MIGRATION_EVM_TO_SOROBAN.md`** — **your how-to.** Step-by-step EVM→Soroban swap: backend gateway, env vars, tx lifecycle, typed bindings, events/indexer, frontend wallet, suggested order of work.
5. **`contratos/PARITY.md`** — the function-by-function mapping between the old EVM contracts and the new Soroban ones (what each call becomes).

(1-3 = narrative & product. 4-5 = exactly what to do and how the contract surface maps.)

## The seam (where you actually work)

**Backend** (swap `ethers` → `@stellar/stellar-sdk` / Soroban RPC):
- `backend/src/config/contractConfig.ts` — addresses/signer/provider config.
- `backend/src/infrastructure/blockchain/ethers-blockchain.gateway.ts` — the gateway; this is the main swap point.
- `backend/src/loan/chain-sync.service.ts` — event indexer (reads on-chain events → persists to Postgres).
- `backend/src/loan/loan.service.ts`, `loan.module.ts` — callers of the gateway.

**Frontend** (swap wagmi/viem/RainbowKit → Freighter + stellar-sdk):
- `frontend/src/providers/` — `WagmiProvider.tsx`, `ContractsProvider.tsx`, `WalletProvider.tsx`, `BorrowerProvider.tsx`.
- `frontend/src/hooks/borrow/blockchain/` — `useBorrow.ts`, `useRepay.ts`, `useCreditLine.ts`.
- `frontend/src/hooks/lend/` — `useApproveAndDepositUSDC.ts`, `useWithdrawUSDC.ts`, `useVaultStats.ts`, `useSeniorYield.ts`; plus `useUsdcBalance.ts`.
- `frontend/src/abi/`, `frontend/src/contracts/` — EVM ABIs, replaced by Soroban typed bindings.

The DB persistence, wallet auth (SIWE), and email/phone verification stay as they are — don't touch them.

## Definition of done
The credit lifecycle works end-to-end **on Stellar testnet, through the app**:
1. Connect wallet (Freighter) → see your credit limit (read from the Soroban registry).
2. Borrow uncollateralized USDC on Stellar → it lands in the wallet, loan persisted in Postgres.
3. Repay → limit goes up.
4. Each tx shows a working **stellar.expert (testnet)** link.

## Don'ts
- Don't write or modify the Soroban contracts (they're done — `contratos/` is owned by another workstream).
- Don't rebuild product/business logic — only replace the chain connection.
- Don't bring back what was intentionally removed: risk model, emailing/notifications, admin panel, AI collections.

## When stuck
- Contract surface / what a call maps to → `contratos/PARITY.md`.
- How to do the swap mechanically → `contratos/MIGRATION_EVM_TO_SOROBAN.md`.
- Why it matters / what we're building → `README.md` + `specs/000`.
