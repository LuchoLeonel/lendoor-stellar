# Deployments

On-chain addresses for the Lendoor Soroban contracts.

## Stellar Testnet — CANONICAL pair (the SCF award pair)

Network passphrase: `Test SDF Network ; September 2015`
RPC: `https://soroban-testnet.stellar.org`

**This is the only pair anything should point at.** It is the pair registered
with the SCF #45 Build Award, the pair the production backend at
`stellar.api.lendoor.xyz` operates against, and the pair baked into
`frontend/Dockerfile.stellar`. All code defaults (`backend/src/config/env.ts`,
`backend/src/config/sorobanConfig.ts`, `packages/*-client`) point here.

| Contract | Contract ID |
|---|---|
| `lendoor-vault` | `CDEJOQBQEZ7LUXSWXM4RF6EPBZLMJHMTGKC5GNWK5TNJR36TBHQLCULP` |
| `lendoor-loan-manager` | `CDIHUCP6DWKW7B6IUECP3SCK5WCI3W5ITNQDZEK2TNI55WLXDM6Y4WJJ` |
| USDC stand-in (native XLM SAC) | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |

Explorer:
- vault: https://stellar.expert/explorer/testnet/contract/CDEJOQBQEZ7LUXSWXM4RF6EPBZLMJHMTGKC5GNWK5TNJR36TBHQLCULP
- loan-manager: https://stellar.expert/explorer/testnet/contract/CDIHUCP6DWKW7B6IUECP3SCK5WCI3W5ITNQDZEK2TNI55WLXDM6Y4WJJ

### Config (read live from instance storage, 2026-10-05)
- `owner` (operator) of both contracts: `GDCZFUNJ7MXWBIQ6UUTJRGZIJF5EMRVJCSK73MA2U7K57GWMA4N3P6SL`
- vault `fee_recipient`: `GDCZFUNJ7MXWBIQ6UUTJRGZIJF5EMRVJCSK73MA2U7K57GWMA4N3P6SL` (same account)
- cross-wiring verified: vault `Config.loan_manager` → `CDIHUCP6…` and
  loan-manager `Config.vault` → `CDEJOQBQ…`
- vault state at read time: `TotalShares = 11_100_989_610`,
  `TotalBorrows = 1_000_000`, `total_assets = 11_101_844_645`
  (= cash `11_100_844_645` + borrows — invariant holds; share price ≈ 1.00008)
- **token decimals = 7** (read from the SAC's `decimals()`): classic Stellar
  assets, including the XLM SAC above and mainnet USDC, use 7 decimals — not
  the 6 of EVM USDC. Unit helpers must use 7 on every Stellar path.
- ⚠️ The operator secret (S…) for `GDCZFUNJ…` is **not in this repo or on dev
  machines** — it lives in the env of the staging container that serves
  `stellar.api.lendoor.xyz`.

### Wiring notes
- Deploy order resolves the chicken-and-egg: deploy `loan-manager` with a
  placeholder `vault`, deploy `vault` pointing at the `loan-manager` id, then call
  `loan-manager.set_vault(<vault id>)`.
- **USDC token:** this testnet deployment uses the **native XLM SAC**
  (`CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`) as a stand-in for
  USDC, only to exercise the money path. On mainnet pass the real **USDC SAC** as
  the vault's `usdc` constructor arg.
- ⚠️ Stellar testnet resets wipe every contract above. **Correction (2026-11-26): the official networks page says there are no more resets scheduled for 2026**; the 2026-12-16 date noted here earlier is stale. Resets are announced ≥ 2 weeks ahead, so evidence is still captured as screenshots, not only links. Original note: every contract above dies with
  it. Capture evidence (tx hashes, explorer links, recordings) before then.

### ⚠️ Deploy checklist — seed the vault first
Right after deploying the vault, the protocol MUST make the **first ("seed")
deposit itself**, before announcing the vault publicly. The vault's ERC-4626
share math reads the live token balance, so a direct token transfer ("donation")
into an empty vault inflates the price-per-share. The `deposit` `ZeroShares`
guard already prevents any fund loss (an honest deposit that would mint 0 shares
reverts instead of being swallowed), but seeding the first deposit also removes
the residual temporary DoS where deposits below a donated price would revert.
**Pair A below is the live proof of what happens when this is skipped.**

---

## Instaward (testnet, USDC nativo)

Par deployado para el **Instaward SOW** (crédito revolvente + pago parcial),
con el **USDC real de testnet** como settlement asset — no el SAC de XLM del
par del SCF award. Conviven: el par de arriba sigue siendo el canónico del
SCF #45; este es el del Instaward.

| Contract | Contract ID |
|---|---|
| `lendoor-vault` | `CCXUEBC3VOOB57NVDFMQVAJRN52FUQN37EAPLVMAU7MLSPUBMZNBVT2Q` |
| `lendoor-loan-manager` | `CB4QQU2JWC6264NQCUPE6WSVYQHJTJNJ5ZBVU7ZAOE7TYNJPYE26YVTD` |
| USDC (SAC nativo de testnet) | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |

Explorer:
- vault: https://stellar.expert/explorer/testnet/contract/CCXUEBC3VOOB57NVDFMQVAJRN52FUQN37EAPLVMAU7MLSPUBMZNBVT2Q
- loan-manager: https://stellar.expert/explorer/testnet/contract/CB4QQU2JWC6264NQCUPE6WSVYQHJTJNJ5ZBVU7ZAOE7TYNJPYE26YVTD

### Config (leída en vivo del instance storage, 2026-10-08)
- `owner` (operador) de ambos contratos: `GA6DMHI54NH3IEA7CLO43SVQMAFEG7BASELZL3NOLVOJ4OML2MKJYAGR`
  — identidad **local y descartable** del CLI (`instaward-op`), nunca una clave de prod.
- vault `fee_recipient`: `GABED6S3K5L2U5F2FTSLWYYCUGKUMQGPW3JX7WLU4KB5B4K3TC3PJ3T4` (`instaward-feesink`).
- cross-wiring verificado: vault `Config.loan_manager` → `CB4QQU2JWC6264NQCUPE6WSVYQHJTJNJ5ZBVU7ZAOE7TYNJPYE26YVTD`
  loan-manager `Config.vault` → `CCXUEBC3VOOB57NVDFMQVAJRN52FUQN37EAPLVMAU7MLSPUBMZNBVT2Q`
- USDC verificado on-chain: `symbol() = "USDC"`, **`decimals() = 7`**.
- Estado al leerlo: `TotalShares = 0`, `TotalBorrows = 0` — **pre-seed**. La regla
  del seed deposit (sección ⚠️ de arriba) aplica acá con más razón: el primer
  movimiento tras el faucet de Circle debe ser un `deposit` del protocolo,
  JAMÁS un transfer directo.
- Config de riesgo del borrower de la demo: límite **50 USDC**, oferta **7d / 5%**
  (aplicada por el operador; verificable con `get_user_risk(<borrower>)` /
  `credit_limit(<borrower>)` cuando se fije la wallet de la ceremonia).

### Procedimiento
Deploy reproducible: `contratos/deploy-testnet-usdc.sh` (build → LM con vault
placeholder → vault con USDC nativo → `set_vault`; identidades por friendbot).

### Par intermedio DESCARTADO — do NOT use
Un primer par del Instaward (`CBI5H4PA6NCOAOYGBGMELI76R7JULRFSIDMFWDUYVH7IGFKOUIR2VSR6` / `CAKDF53VKXZZCYMLIEIL75GBAM3FMHMNE3JCRRBZUCDU2MAFHJI67MSH`) quedó **descartado**:
se deployó con la semántica **pre-revolvente** (sin interés pro-rata ni
`repay_partial` / `apply_payment`). Nada debe apuntarle; el par válido es el
de la tabla de arriba.

---

## Deprecated pairs — do NOT use

Two older testnet pairs exist on-chain. Neither is referenced by code anymore;
they are documented here so nobody wires them back in by accident.

### Pair A — DEAD (first deploy, 2026-06-24, stellar-cli 27.0.0 / SDK 26)

| Contract | Contract ID |
|---|---|
| `lendoor-loan-manager` | `CAAS2N3OS6GKFJMWFAUWZLYKYAIAUMSHTWKVUB4E4CZHP5THBHID4HP2` |
| `lendoor-vault` | `CBENFIWPHQ4B4JVOBSSGVJ66BXANJZI4TVOLJE2D745YIRRH7IOVOJPV` |

owner: `GCSXUKJZWSBUW4JC3FEKBUZJWXU6ESXCPWYWGMAHGNZZ3RHLZHMQH76K` (disposable) ·
fee_recipient: `GBNUACGGIYNMTWP4D6CEKK6RL4VU5QDP4LMIKSDLPXOX2DARAQ333OFS`

**Why it is dead** (state read live 2026-10-05): `TotalShares = 0` with
`cash ≈ 960 XLM` and `TotalBorrows = 40 XLM` still outstanding. After the full
lifecycle test below, all shares were redeemed (supply → 0) and then **1000 XLM
were donated in to verify the inflation guard**. With supply 0 and a non-zero
balance, every honest `deposit` now computes 0 shares and reverts with
`Error(Contract, #9)` (`ZeroShares`) — permanently. There is no rescue path for
the donated XLM. The vault can never take deposits again; nothing may point at it.

The original full-lifecycle validation ran on this pair and remains valid as
evidence of the contract logic (each call signed by the relevant account):

| Flow | Result |
|---|---|
| LP `deposit` 1000 XLM | 1:1 shares minted; `total_assets` = 1000 XLM |
| operator `set_user_risk` + `set_loan_offer` (250 XLM, 7d / 5%) | `credit_limit` = 250 XLM |
| borrower `borrow_with_term` 100 XLM (uncollateralized) | +100 XLM to borrower; `total_assets` invariant; loan `active`, `amount_due` = 105 (+5%) |
| borrower `repay` (105 XLM) | fee 0.25 XLM (5% of interest) to `fee_recipient`; `total_assets` = 1004.75 XLM; loan closed; cooldown set |
| LP `redeem` all shares | 1004.75 XLM returned (1000 deposited + 4.75 net yield) |

Guards verified live on this pair:
- **Donation/inflation guard** — after a 1000 XLM donation into a 0-supply vault,
  an honest `deposit` reverts with `Error(Contract, #9)` (`ZeroShares`); no funds lost.
- **Inline credit gate** — a `borrow_with_term` above the borrower's credit limit
  reverts with `Error(Contract, #6)` (`OverCreditLimit`); a borrow within the limit succeeds.

Time-gated paths (`mark_default`, late-fee accrual, `manual_write_off`) require
~16+ days of real wall-clock to elapse, so they are not exercised live on testnet;
they are covered by the 150 contract unit tests (which time-travel the ledger).

### Pair C — deprecated (was the silent code default until 2026-10-05)

| Contract | Contract ID |
|---|---|
| `lendoor-loan-manager` | `CDBB3B6PZAV5OH7NACXQTL3YLZLJ3NNUMHCMFV54WIR6MDCO6GKGFSCJ` |
| `lendoor-vault` | `CDVWUWSBHFVQGPCZGLBRTHDDIJBKWLXTVC2QIPXG6UJWNDFGZUP7S7KO` |

owner = fee_recipient: `GALOA6IWZPNFRTMHDTZOK34HLLJ7AM2QRJJRLZKPE5GN52TR4OYMZXYW`.
Functional but **not the award pair** (state read 2026-10-05: shares
`1_000_000_000`, borrows 0, cash ≈ 100.02 XLM). It was never what production
served — only the hardcoded fallback in `env.ts` / `sorobanConfig.ts` /
`packages/*-client`, all of which now point at the canonical pair. Do not fund
it further.

## Stellar Mainnet

_Not deployed yet._

> Descartado también (2026-10-08, segundo intermedio): LM `CA2H4UFGUADAL3GFU6DM7TBJ4DY6WIZXZ67A42K4RKVUWEY7YZXRGV4R` /
> Vault `CDY27BWE7HYC26JRVU7NE7IC6GMKEUWMOTCB3B3MEPOZHXSWWLBQSBKA` — semántica revolvente
> pero sin el pull-exacto-con-vuelto de `repay_partial` (la testnet real demostró que el
> recálculo temporal rompe la auth firmada). El PAR VIGENTE es el de la tabla de arriba.
> Checklist ampliado: el FEE SINK también necesita trustline de USDC antes del primer repago.

> Nota (review PR #3, 2026-10-08): el par Instaward vigente es ANTERIOR al guard
> de `deposit_from` contra beneficiary==vault y al doble evento deposit/dep_from.
> Su evidencia ya esta capturada; NO se re-deploya por esto. Todo par nuevo sale
> con ambos fixes.


## Stellar Testnet — SCF #45 Tranche 2 pairs (hardened contracts, 2026-11-27)

Same wasm, two instances (see `deploy-testnet-t2.sh`). D2.3 role model: `admin`
(2-of-3 multisig account), `underwriter` (backend signer), `operator` (keeper),
`pauser` (on-call). Upgrades and strategy changes are timelocked (`upgrade_delay`
600 s on testnet; 48 h planned for mainnet). Enforced seed of 1 USDC whose
shares are locked in the vault itself; decimals offset 3 (1 asset unit = 1 000
share units at par).

### T2-A — Circle testnet USDC (app / D2.1 / D2.3)

| Piece | Value |
|---|---|
| Vault | `CA23BR7WLIPAA2SGYXTGCFSWJEIIFM2YI2QWN2ES6EJQ5VGROM5W4BZ3` |
| Loan Manager | `CCJTYVKKRD5MQI7BLHF4BYAYFXZS5S5J3SZ33ZXTJC4SA55V27NUBGX2` |
| Settlement asset | Circle testnet USDC SAC `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` (7 dp) |
| Admin (multisig account) | `GCOFNXHCQGA7EQL5PEPAGMZI53GQP7GA2VAHPDJIE3AVZ3FYX4ADF5UI` — master weight 1 + signers `GATMGUDZ…QOWA`, `GC7XAO52…MED7` weight 1; thresholds low/med/high = 2 |
| Underwriter / Operator | `GA6DMHI54NH3IEA7CLO43SVQMAFEG7BASELZL3NOLVOJ4OML2MKJYAGR` (testnet identity `instaward-op`) |
| Pauser | `GAUNCZDC2WS45ERG4TZIZTAFVKBCQ3EBXJSUHGRNYFWPTSL6TVXN7GOS` |
| Fee recipient | `GABED6S3K5L2U5F2FTSLWYYCUGKUMQGPW3JX7WLU4KB5B4K3TC3PJ3T4` (has the USDC trustline) |
| Seed | 1 USDC paid by `GAXU6PIN…7I3M` → 10 000 000 000 share units held by the vault address |
| Wiring tx | `set_vault` `2fc83d8c0dc7e699447c257daf0414e0718f116a7e0de8ee1ae3622522a1eb3e` |
| Strategy | none (`strategy = null`, buffer disabled) — this instance keeps everything idle |
| Result file | `contratos/result-t2a-testnet.json` |

Verified right after deploy: `usdc()` = the SAC above, `decimals_offset` 3,
`total_supply` 10 000 000 000 = `balance_of(vault)`, `total_assets` 10 000 000,
`is_paused` false, `upgrade_delay` 600.

### T2-B — BlendUSDC + Lendoor's own DeFindex vault (D2.2)

_Pending: needs BlendUSDC (Blend testnet faucet) for the seed and for the demo
LP. Create the DeFindex vault with `scripts/defindex-create-vault.sh`, then
`DEFINDEX_VAULT=<id> ./deploy-testnet-t2.sh t2b`._

### Interface changes vs Tranche 1 (for the app, the backend and the indexer)

Removed: `set_owner`, `upgrade` (and the `ownerset` event). Changed signers: `manual_write_off` /
`set_fee_recipient` = admin (2-of-3); every loan-manager risk / offer / premium / default write =
underwriter; `pause`, `cancel_upgrade`, `cancel_strategy`, `emergency_unwind` take an explicit
`caller`. New: `claim_fees` / `fees_accrued` (protocol fees accrue in the vault and are pulled;
repayments no longer transfer to the fee recipient), `convert_to_assets` / `convert_to_shares` /
`max_withdraw` / `decimals_offset`, the governance surface (`get_role`, `set_role`, `transfer_admin`,
`accept_admin`, `cancel_admin_transfer`, `pause`, `unpause`, `propose_upgrade`, `execute_upgrade`,
`cancel_upgrade`) and the strategy surface (`strategy`, `strategy_position`, `buffer`,
`pending_strategy`, `set_buffer`, `propose_strategy`, `execute_strategy`, `cancel_strategy`,
`rebalance`, `sync_strategy`, `emergency_unwind`). Event shapes of Tranche 1 are unchanged; new
events are listed in `docs/security/monitoring-plan.md`.

**Go/no-go before mainnet (review A2):** measure, on T2-B, the resource usage of one LP withdraw
that crosses idle cash (soft sync + pull + Blend withdraw in one tx) and record it here.

### Operating the admin (2-of-3)

Every admin-gated call needs two signatures: `scripts/admin-multisig-setup.sh
invoke <contract> <fn> [args]` (builds, signs with the master key and signer 2,
sends). `deploy-testnet-t2.sh` does this automatically once the thresholds are
raised. The pauser and the underwriter are single keys.
