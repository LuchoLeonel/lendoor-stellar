# Deployments

On-chain addresses for the Lendoor Soroban contracts.

## Stellar Testnet

Network passphrase: `Test SDF Network ; September 2015`
RPC: `https://soroban-testnet.stellar.org`
Deployed & verified: 2026-06-24 (stellar-cli 27.0.0, SDK 26).

| Contract | Contract ID |
|---|---|
| `lendoor-loan-manager` | `CAAS2N3OS6GKFJMWFAUWZLYKYAIAUMSHTWKVUB4E4CZHP5THBHID4HP2` |
| `lendoor-vault` | `CBENFIWPHQ4B4JVOBSSGVJ66BXANJZI4TVOLJE2D745YIRRH7IOVOJPV` |

Explorer:
- loan-manager: https://stellar.expert/explorer/testnet/contract/CAAS2N3OS6GKFJMWFAUWZLYKYAIAUMSHTWKVUB4E4CZHP5THBHID4HP2
- vault: https://stellar.expert/explorer/testnet/contract/CBENFIWPHQ4B4JVOBSSGVJ66BXANJZI4TVOLJE2D745YIRRH7IOVOJPV

### Config
- `owner` (operator) of both contracts: `GCSXUKJZWSBUW4JC3FEKBUZJWXU6ESXCPWYWGMAHGNZZ3RHLZHMQH76K` (testnet, disposable).
- vault `fee_recipient`: `GBNUACGGIYNMTWP4D6CEKK6RL4VU5QDP4LMIKSDLPXOX2DARAQ333OFS` (receives the 5% protocol fee on loan interest).

### Wiring notes
- Deploy order resolves the chicken-and-egg: deploy `loan-manager` with a
  placeholder `vault`, deploy `vault` pointing at the `loan-manager` id, then call
  `loan-manager.set_vault(<vault id>)`.
- **USDC token:** this testnet deployment uses the **native XLM SAC**
  (`CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`) as a stand-in for
  USDC, only to exercise the money path. On mainnet pass the real **USDC SAC** as
  the vault's `usdc` constructor arg.

### ⚠️ Deploy checklist — seed the vault first
Right after deploying the vault, the protocol MUST make the **first ("seed")
deposit itself**, before announcing the vault publicly. The vault's ERC-4626
share math reads the live token balance, so a direct token transfer ("donation")
into an empty vault inflates the price-per-share. The `deposit` `ZeroShares`
guard already prevents any fund loss (an honest deposit that would mint 0 shares
reverts instead of being swallowed), but seeding the first deposit also removes
the residual temporary DoS where deposits below a donated price would revert.

### Verified live on testnet
Full happy-path credit lifecycle, all on-chain, each call signed by the relevant account:

| Flow | Result |
|---|---|
| LP `deposit` 1000 XLM | 1:1 shares minted; `total_assets` = 1000 XLM |
| operator `set_user_risk` + `set_loan_offer` (250 XLM, 7d / 5%) | `credit_limit` = 250 XLM |
| borrower `borrow_with_term` 100 XLM (uncollateralized) | +100 XLM to borrower; `total_assets` invariant; loan `active`, `amount_due` = 105 (+5%) |
| borrower `repay` (105 XLM) | fee 0.25 XLM (5% of interest) to `fee_recipient`; `total_assets` = 1004.75 XLM; loan closed; cooldown set |
| LP `redeem` all shares | 1004.75 XLM returned (1000 deposited + 4.75 net yield) |

Guards verified live:
- **Donation/inflation guard** — after a 1000 XLM donation into a 0-supply vault,
  an honest `deposit` reverts with `Error(Contract, #9)` (`ZeroShares`); no funds lost.
- **Inline credit gate** — a `borrow_with_term` above the borrower's credit limit
  reverts with `Error(Contract, #6)` (`OverCreditLimit`); a borrow within the limit succeeds.

Time-gated paths (`mark_default`, late-fee accrual, `manual_write_off`) require
~16+ days of real wall-clock to elapse, so they are not exercised live on testnet;
they are covered by the 150 contract unit tests (which time-travel the ledger).

## Stellar Mainnet

_Not deployed yet._
