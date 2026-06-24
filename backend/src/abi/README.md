# Compiled contract ABIs

**🚨 Do not hand-edit these JSON files.** They are extracted verbatim from
the Foundry build output (`evk-periphery/out/<Name>.sol/<Name>.json`) and
must stay in sync with the deployed bytecode.

## Why we don't write event signatures by hand

Hand-written ABI strings caused a 19-hour silent data-loss incident on
2026-05-20 (spec 070): an extra `uint64 start` was added to the
`LoanOpened` event string, which changed the topic-0 hash and caused
the Layer 2 scanner to match zero events while Layer 1 rejected every
valid `/loan/inform-open` POST.

Importing the ABI from the compiled artifact eliminates this entire
class of bugs — if the contract source changes, the build output
changes, and `yarn sync-abi` propagates it here.

## Updating after a contract change

```bash
cd backend
yarn sync-abi    # copies evk-periphery/out/*.json → backend/src/abi/
```

The script is idempotent. Commit the resulting changes to this folder
alongside the contract change so they ship together.
