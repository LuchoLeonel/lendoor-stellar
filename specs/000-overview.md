# 000 — Overview & strategy (PULSO Hackathon)

## One-liner
Lendoor is embedded credit infrastructure for LatAm's credit-invisible. This build is **Lendoor on Stellar, distributed through Bitso** — the same thesis as the live Celo/Lemon version, swapped onto Stellar's rails.

## The enroque (the core move)
| | Live Lendoor (today) | This build (PULSO) |
|---|---|---|
| Chain | Celo (EVM) | **Stellar (Soroban)** |
| Money rail | USDC on Celo | **USDC on Stellar** |
| Distribution | Lemon wallet | **Bitso** (target) |
| Market | AR / LatAm | AR / LatAm |

The product, the UX, the credit model and the data moat stay the same. We swap the chain and the distribution surface. Aim: *be what Lendoor is, but inside Bitso, on Stellar.*

> Bitso is the **target** distribution partner (the Lemon-analog for Stellar), not a signed deal. Frame it as the wallet the credit layer embeds into.

## Why this wins on Stellar
- **Real problem, real region:** 186M+ credit-invisible adults; AR's Transferencias 3.0 reshaping payments; highest digital-dollar demand in the region. The hackathon brief itself calls out this AR reality.
- **Load-bearing integration:** the entire credit lifecycle (disburse → repay → score) runs on Soroban + USDC on Stellar. Not a logo on a slide.
- **Already proven:** the Celo version is live, cashflow-positive, with real loans on mainnet. We are porting a working model, not inventing one.

## What we are building in 10 days
A working, demo-able slice of the credit lifecycle on Stellar testnet:
1. Connect wallet (Freighter for the web companion).
2. See your on-chain credit limit (from the Soroban credit registry).
3. Take a small **uncollateralized USDC** loan on Stellar.
4. Repay → the limit goes up (the credit ladder).

The "wow": repaying builds a **portable on-chain score**, and the AI/data underwriting is what no payment-rail player has.

## Scope discipline
- IN: Soroban contracts (separate workstream, see `001`), the frontend flow re-pointed to Stellar/Freighter, the backend persisting on-chain state, 3 customer-discovery interviews, testnet deploy, deck, demo video.
- OUT (do not rebuild): risk model, emailing/notifications, admin panel, AI collections. The base already excludes these.
- DO NOT over-scope: a clean end-to-end loan on testnet beats a half-built everything.

## Honest framing for judges & pitch
- Lead with the problem and the proof (live Celo traction), sell the future without inflating it.
- Be explicit on the difference vs payment rails (Tempo/El Dorado/Pomelo move money; we extend credit to the uncollateralized).
- USDC risk is the issuer's, not ours; the testnet deploy is the eligible artifact, mainnet/traction is the scoring bonus.
