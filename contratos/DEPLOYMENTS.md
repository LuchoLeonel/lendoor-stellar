# Deployments

On-chain addresses for the Lendoor Soroban contracts.

## Stellar Testnet

Network passphrase: `Test SDF Network ; September 2015`
RPC: `https://soroban-testnet.stellar.org`

| Contract | Contract ID |
|---|---|
| `lendoor-loan-manager` | `CDBB3B6PZAV5OH7NACXQTL3YLZLJ3NNUMHCMFV54WIR6MDCO6GKGFSCJ` |
| `lendoor-vault` | `CDVWUWSBHFVQGPCZGLBRTHDDIJBKWLXTVC2QIPXG6UJWNDFGZUP7S7KO` |

Explorer:
- loan-manager: https://stellar.expert/explorer/testnet/contract/CDBB3B6PZAV5OH7NACXQTL3YLZLJ3NNUMHCMFV54WIR6MDCO6GKGFSCJ
- vault: https://stellar.expert/explorer/testnet/contract/CDVWUWSBHFVQGPCZGLBRTHDDIJBKWLXTVC2QIPXG6UJWNDFGZUP7S7KO

### Wiring notes
- `owner` (operator) of both = the deployer account (testnet, disposable).
- Deploy order resolves the chicken-and-egg: deploy `loan-manager` with a
  placeholder `vault`, deploy `vault` pointing at the `loan-manager` id, then call
  `loan-manager.set_vault(<vault id>)`.
- **USDC token:** this testnet deployment uses the **native XLM SAC**
  (`CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`) as a stand-in for
  USDC, only to exercise the money path. On mainnet pass the real **USDC SAC** as
  the vault's `usdc` constructor arg.

### Verified live on testnet
deposit → set_user_risk / set_loan_offer → borrow_with_term → repay round-trips
correctly: `total_assets` is invariant at borrow and grows by exactly the net
interest on repay (5% protocol fee skimmed). Matches the unit-test math.

## Stellar Mainnet

_Not deployed yet._
