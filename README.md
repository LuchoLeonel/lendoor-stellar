# Lendoor Stellar

Stellar / Soroban port of Lendoor's on-chain credit base. This repo takes the **essential base** of the Lendoor product (the mobile app front, the blockchain↔contract connection, and the DB persistence) and is being re-pointed from Celo/EVM to **Stellar (Soroban)**.

It is intentionally a clean base, not the full product.

## What's in here

```
lendoor-stellar/
├── frontend/    # the Lendoor mobile app front (copied as-is, admin/email stripped)
├── backend/     # the base: wallet auth + blockchain connection + DB persistence
└── contratos/   # Soroban smart contracts (Rust) — built separately, see below
```

### frontend/
The same mobile app front as Lendoor (Home, Borrow, Lend, Stats, Wallet Link, etc.). Copied without `node_modules`/build. The **admin panel, email-operator and voice tooling were removed**. The wallet / contract layer still points at EVM (wagmi/viem) and needs to be re-pointed to Stellar (Freighter + Soroban) as part of the port.

### backend/
NestJS. Pruned down to the **base only**: SIWE wallet login, the blockchain connection + on-chain sync, and DB persistence (TypeORM + Postgres). The EVM chain integration is the seam to swap for `@stellar/stellar-sdk` / Soroban RPC.

### contratos/
**Reserved for the Soroban (Rust) contracts**, built in a separate terminal. Nothing is auto-copied here — the original Lendoor contracts are Solidity/EVM and do not port to Soroban, so the Stellar contracts are written fresh.

## Intentionally excluded from the Lendoor original

To keep this a clean base, the following were **not** carried over:

- Risk / underwriting model
- Emailing & notifications
- Admin panel (dashboard, email operator, voice call center)
- AI collections (voice agent)

## Status / next steps

- [x] Frontend copied (admin/email/voice removed)
- [ ] Backend pruned to a compiling base (in progress)
- [ ] Re-point frontend wallet+contract layer to Stellar (Freighter + Soroban)
- [ ] Swap backend chain integration to the Stellar SDK / Soroban RPC
- [ ] Write Soroban contracts in `contratos/` (Rust) — separate terminal
- [ ] Wire backend ↔ Soroban + persist on-chain state in DB

## Origin

Derived from the Lendoor codebase (Celo/EVM). This is the Stellar-native base.
