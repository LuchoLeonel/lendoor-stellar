# Migrating Lendoor from EVM to Soroban — integration guide

This is a **guide, not a code change**. It tells the backend/frontend engineer
exactly what to swap to move Lendoor off the EVM stack (Celo/Base + Euler EVault +
LoanManagerV3) and onto the Soroban contracts in this folder
(`lendoor-vault` + `lendoor-loan-manager`).

The **contract-level semantics** (which function maps to which, inputs/outputs and
every justified divergence) are in [`PARITY.md`](./PARITY.md). This doc is the
**plumbing**: libraries, signer, transaction lifecycle, events, addresses.

The golden rule: **the boundary stays, the implementation swaps.** The backend
already hides all chain access behind one file + one interface. Keep them; rewrite
what's inside.

---

## 0. Mental model: what actually changes

| Concern | EVM today | Soroban |
|---|---|---|
| Backend role | `onlyOwner` operator wallet that signs writes | same — an operator **Keypair** that signs `require_auth` entries |
| User role | signs borrow/repay in their wallet (Lemon) | same — user signs with a Stellar wallet (Freighter / Lemon / Stellar Wallets Kit) |
| Who relays | backend posts the offer; **user** sends borrow/repay | identical split — no change to who does what |
| What breaks | the **encoding/signing/RPC layer** only | rewrite that layer; business logic untouched |

If you do this right, `loan.service.ts`, `loan-repayment.service.ts`,
`chain-sync.service.ts`, the HTTP endpoints, the pricing/tiers, the WhatsApp
notifications and the DB schema **do not change** (one exception: address format,
see §6).

---

## 1. Backend — the swap point

Everything chain-related lives in **two** places:

- `backend/src/config/contractConfig.ts` — ethers provider, signer, contract
  instance, the TX queue/nonce manager, and one function per contract call.
- `backend/src/infrastructure/blockchain/ethers-blockchain.gateway.ts` —
  implements the `BLOCKCHAIN_GATEWAY` interface, wired in `loan.module.ts`:
  ```ts
  { provide: BLOCKCHAIN_GATEWAY, useClass: EthersBlockchainGateway }
  ```

**Plan:** write a `SorobanBlockchainGateway` that implements the SAME
`BLOCKCHAIN_GATEWAY` interface, back it with a new `sorobanConfig.ts`, and flip the
one provider line. The five services that `@Inject(BLOCKCHAIN_GATEWAY)` keep
working unchanged.

### 1.1 Library + signer

| | EVM | Soroban |
|---|---|---|
| lib | `ethers` v6 | `@stellar/stellar-sdk` (includes the Soroban RPC client) |
| provider | `new JsonRpcProvider(ETH_RPC_URL)` | `new rpc.Server(SOROBAN_RPC_URL)` |
| signer | `new Wallet(ETH_PRIVATE_KEY, provider)` | `Keypair.fromSecret(STELLAR_OPERATOR_SECRET)` |
| network id | chain id | `Networks.PUBLIC` / `Networks.TESTNET` passphrase |
| contract | `new Contract(addr, ABI, signer)` | generated bindings `Client` (see §4) |

### 1.2 Env vars

| EVM | Soroban | Note |
|---|---|---|
| `ETH_RPC_URL` | `SOROBAN_RPC_URL` | e.g. `https://soroban-testnet.stellar.org` |
| `ETH_PRIVATE_KEY` | `STELLAR_OPERATOR_SECRET` | `S...` secret seed of the operator (= contract `owner`) |
| `ETH_LOAN_MANAGER` | `SOROBAN_LOAN_MANAGER` | `C...` contract id |
| — | `SOROBAN_VAULT` | `C...` vault contract id (backend may read it; users borrow against it) |
| — | `SOROBAN_USDC_SAC` | `C...` the USDC Stellar Asset Contract id |
| — | `NETWORK_PASSPHRASE` | network selector |

---

## 2. Transaction lifecycle (the biggest mechanical change)

EVM: build → `sendTransaction` → `wait(receipt)`, with a custom nonce manager and
EIP-1559 fee bumping.

Soroban writes are a **4-step dance** — every contract write goes through it:

```
1. build   tx = new TransactionBuilder(account, {fee, networkPassphrase})
                  .addOperation(contract.call("set_user_risk", ...scVals))
                  .setTimeout(30).build()
2. simulate sim = await server.simulateTransaction(tx)   // returns the resource fee + auth
3. prepare  tx  = rpc.assembleTransaction(tx, sim).build()  // bakes in fee + footprint
            tx.sign(operatorKeypair)                         // signs auth for owner-gated fns
4. send     const { hash } = await server.sendTransaction(tx)
            poll server.getTransaction(hash) until status === "SUCCESS"
```

Map your current helpers like this:

| EVM mechanic | Soroban equivalent | Note |
|---|---|---|
| nonce manager / auto-clear pending | **sequence number** per source account | Strictly sequential. **Keep the TX queue** (`highQueue`/`lowQueue`): one source account = one in-flight sequence, so serialization is *more* important, not less. |
| EIP-1559 fee bump (x2…x5) | base fee + **resource fee from simulation** | No mempool gas auction. If a send fails `TRY_AGAIN_LATER`, re-simulate and resend. |
| `tx.wait()` + confirm timeout | poll `getTransaction(hash)` (`NOT_FOUND` → `SUCCESS`/`FAILED`) | Same `CLM_TX_CONFIRM_TIMEOUT_MS` semantics; poll ~1s. |
| `isRetryableChainError` | retry on `TRY_AGAIN_LATER` / sim restore-needed | Plus: archived state may need a **restore** op (TTL); rare for hot loans. |

### 2.1 Auth model

Owner-gated writes (`set_user_risk`, `set_loan_offer`, `set_premium_config`,
`mark_default`, `set_owner`, `set_vault`, `upgrade`) require the contract's `owner`
to authorize. Because the operator Keypair **is** the owner, signing the
transaction satisfies `require_auth()` — no separate "onlyOwner modifier" concept,
the auth is part of the signed tx. User-gated calls (`deposit`, `withdraw`,
`borrow_with_term`, `repay`) are signed by the **user's** wallet, exactly as today.

---

## 3. Function-by-function mapping for the gateway

(Types: amounts are `i128` — pass JS `bigint`; addresses are `C...`/`G...` strkeys.)

### Writes the backend performs

| Backend fn today (`contractConfig.ts`) | EVM call | Soroban call | Change |
|---|---|---|---|
| `giveCreditScoreAndLimit(...)` | `setUserRisk(addr,score,kyc,validUntil,limit)` | `set_user_risk(account,score,kyc_ok,valid_until,limit)` | `score` u16→u32 (just a bigger int); rest identical |
| `createLoanOfferBackend(...)` | `setLoanOffer(addr,tenor,fee,validUntil,max)` | `set_loan_offer(borrower,tenor_days,fee_bps,valid_until,max_amount)` | identical args |
| `setPremiumConfig(...)` | `setPremiumConfig(addr,premium,late)` | `set_premium_config(borrower,premium_rate_per_sec_wad,late_rate_per_sec_wad)` | identical |
| `accrueLate(...)` | `accrueLate(addr)` **(onlyOwner)** | `accrue_late(borrower)` **(permissionless)** | **Simplification:** anyone can call it now. You can keep calling it from the backend in the preflight, OR fold it into the user's repay tx and drop the backend write entirely. |

### Reads the backend performs

| Backend fn today | EVM | Soroban | Change |
|---|---|---|---|
| `readCreditLimitOnChain` | `creditLimit(addr)` | `credit_limit(account)` | — |
| `readLoanFull` | `loans(addr)` (7-tuple) | `get_loan(borrower)` (full struct) | Returns **more** fields (`defaulted`, `last_accrued`) — you can derive `isDefaulted` from it and **drop the separate read**. |
| `readPremium` | `premiums(addr)` | `get_premium(account)` | — |
| `previewLoanWithLate` | `previewLoanWithLate(addr)` | `preview_loan_with_late(borrower)` → `(principal, owed)` | same tuple |
| `readIsDefaulted` | `isDefaulted(addr)` | `is_defaulted(borrower)` | still exists; or read from `get_loan` |
| `getChainBlockTimestamp` | `block.timestamp` via a call | `server.getLatestLedger()` → `closeTime` | ledger close time is the chain clock |

**Reads are free:** a Soroban view = `simulateTransaction` of the function. No
signature, no fee, no submitted tx. The generated bindings expose them as plain
async calls that simulate under the hood.

### Calls the backend does NOT make (unchanged ownership)

`open_loan` / `close_loan` are vault-gated and happen inside the user's
borrow/repay; `mark_default` is operator-only and stays a backend/admin action.

---

## 4. Generate typed bindings (do this first)

Replace the hand-maintained `LoanManagerV3.abi.json` + manual encoding with
generated TypeScript clients:

```bash
stellar contract bindings typescript \
  --network testnet --contract-id <SOROBAN_LOAN_MANAGER> --output-dir ./packages/loan-manager-client
stellar contract bindings typescript \
  --network testnet --contract-id <SOROBAN_VAULT> --output-dir ./packages/vault-client
```

This yields a typed `Client` with one method per contract function (correct i128
↔ bigint, structs, errors). Use the SAME package in backend and frontend — it
becomes the single source of truth, killing ABI drift.

---

## 5. Events / indexer (`chain-sync.service.ts`)

The poll-based model survives; only the API changes.

| EVM | Soroban |
|---|---|
| `contract.queryFilter(LoanOpened, fromBlock, toBlock)` | `server.getEvents({ startLedger, filters: [{ contractIds, topics }] })` |
| block cursor (`ChainScanCursor`) | **ledger** cursor (same persistent-cursor pattern) |
| `LoanOpened(address,uint256,...)` | event topic symbols emitted by the contracts: `loanopen`, `borrow`, `repay`, `default`, `writeoff`, `loanclos` (≤ 9-char Soroban symbols) |
| ABI-decoded event args | `scValToNative(event.value)` |

Both the LoanOpened drift scan and the loan-state reconciliation map 1:1 — read
`get_loan(borrower)` instead of `loans(addr)`.

---

## 6. Addresses & identity (the one DB-touching change)

EVM addresses are `0x…` (20 bytes, case-insensitive, stored **lowercased** via the
`normalize-wallet.ts` transformer). **Stellar strkeys are different and this WILL
bite you:**

- User accounts are `G…` (56 chars), contracts are `C…`. **Case-sensitive** —
  Base32, do **NOT** lowercase them.
- **Action:** remove the lowercasing in `normalize-wallet.ts` and the
  `user.entity.ts` `walletAddress` transformer; validate with `StrKey.isValidEd25519PublicKey`
  instead of a hex regex. Keep the UNIQUE index. The column stays `text`.

Everything keyed on `walletAddress` (loans, scores, limits) keeps working once the
format/validator is updated.

---

## 7. Amounts

USDC is still 6 decimals — `toUnits("50", 6) = 50_000_000n` is unchanged. The only
difference: pass values as `i128` (JS `bigint`) through the bindings instead of
`uint256`. Any borrow that fits in `uint256` fits in `i128` (2^127 headroom).

---

## 8. Frontend — EVM wallet → Stellar wallet

Mirror of the backend swap, on the wallet side. Replaces `wagmi`/`viem`/`ethers`
with `@stellar/stellar-sdk` + a wallet kit (Freighter / Lemon's Stellar support /
Stellar Wallets Kit). The hooks under `frontend/src/hooks/` are the surface.

| Frontend flow today | Change for Soroban |
|---|---|
| **Approve step** (`usdc.approve` + `allowance` before deposit/repay) | **DELETE.** The SAC `transfer` is authorized inside the user's signed tx via `require_auth`; there is no pre-approval. `useApproveAndDepositUSDC` becomes just `deposit`. |
| **EVC** (`enableController` / `isControllerEnabled` batch before borrow) | **DELETE.** No EVC on Soroban; borrow is a single atomic call. |
| `evault.deposit(amount, receiver)` | `vault.deposit(from, assets)` — one address (the connected wallet) |
| `evault.withdraw(amount, receiver, owner)` | `vault.withdraw(from, assets)` — still by **USDC amount**, same UX |
| `evault.borrowWithTerm(amount, receiver, tenor, fee)` | `vault.borrow_with_term(borrower, amount, tenor_days, fee_bps)` |
| `evault.repay(MaxUint256, receiver)` | `vault.repay(payer, borrower)` — **drop the `MaxUint256` sentinel**, full repay is implicit. If you want the latest late fee, call permissionless `accrue_late(borrower)` first (or batch it). |
| reads: `creditLimit / loans / users / premiums / nextBorrowTime / previewLoanWithLate` | `credit_limit / get_loan / get_user_risk / get_premium / next_borrow_time / preview_loan_with_late` |
| `balanceOf / totalSupply / totalAssets` | `balance_of / total_supply / total_assets` |
| read = `useReadContract` (eth_call) | read = bindings method (simulate, no signature) |
| write = `useWriteContract` | build → simulate → `wallet.signTransaction` → `server.sendTransaction` → poll |

**Custom error decoding:** the EVM `0x13790bf0 → InsufficientCash` mapping becomes
the contract `Error` enum (`InsufficientCash = 4`, etc.); the bindings surface it
as a typed error.

---

## 9. What you can delete vs. keep

**Delete:** ERC20 approve/allowance logic, EVC enable-controller batch, EIP-1559
fee-bump code, the `MaxUint256` repay sentinel, the nonce-gap auto-clear (sequence
numbers replace it).

**Keep:** the `BLOCKCHAIN_GATEWAY` interface and all five consumers, the TX
priority queue, the persistent scan cursor, the preflight response shape (compute
the same fields from Soroban reads), pricing/tiers, the loan state machine,
notifications, and the entire DB schema except the address format/validator.

---

## 10. Suggested order of work

1. Deploy both contracts to testnet; generate bindings (§4).
2. Build `SorobanBlockchainGateway` implementing `BLOCKCHAIN_GATEWAY`; port the
   write/read functions (§3) and the tx lifecycle (§2). Flip the DI line.
3. Fix `normalize-wallet.ts` + the user entity validator for `G…` strkeys (§6).
4. Port `chain-sync` to `getEvents` + ledger cursors (§5).
5. Swap the frontend wallet layer + hooks (§8); delete approve/EVC.
6. End-to-end on testnet: score → offer → deposit → borrow → repay → withdraw.
