#!/usr/bin/env bash
# Lendoor Soroban — SCF #45 Tranche 2 deploy (testnet).
#
# Deploys ONE pair (loan-manager + vault) of the hardened contracts with the
# D2.3 role model and, optionally, wires a DeFindex strategy (D2.2).
# Two pairs are deployed from this same script with different args:
#   t2a  settlement = Circle testnet USDC (the app / D2.1 / D2.3 demo)
#   t2b  settlement = BlendUSDC + our own DeFindex vault (D2.2 demo)
#
# Admin-gated calls go through `admin_invoke`, which signs with two keys once
# scripts/admin-multisig-setup.sh has raised the admin account to 2-of-3, so
# the script works before and after the multisig is applied.
#
# Identities are stellar-cli names (testnet, throwaway). Nothing here is a
# production key.
#
# Usage:
#   ./deploy-testnet-t2.sh t2a            # Circle USDC pair
#   ./deploy-testnet-t2.sh t2b            # BlendUSDC pair (+ strategy if DEFINDEX_VAULT is set)
#   ./deploy-testnet-t2.sh t2b strategy   # only the strategy wiring on an existing t2b
set -euo pipefail
export NO_COLOR=1
NET=${NET:-testnet}
PAIR=${1:-t2a}
STEP=${2:-all}
HERE=$(cd "$(dirname "$0")" && pwd)
RES="$HERE/result-$PAIR-$NET.json"

# ── identities (override with env) ─────────────────────────────────────────
ADMIN=${ADMIN:-lendoor-t2-admin}          # governance account (gets 2-of-3 thresholds later)
UNDERWRITER=${UNDERWRITER:-instaward-op}  # backend signer: risk / offers / premiums / defaults
OPERATOR=${OPERATOR:-instaward-op}        # keeper: rebalance / sync
PAUSER=${PAUSER:-lendoor-t2-pauser}       # on-call key: pause / veto only
FEESINK=${FEESINK:-instaward-feesink}
SEED_PAYER=${SEED_PAYER:-instaward-late}  # pays the 1 USDC seed (needs the asset)
SEED=${SEED:-10000000}                    # 1 USDC at 7 dp (>= MIN_SEED_ASSETS)
DELAY=${DELAY:-600}                       # upgrade / strategy timelock (seconds); mainnet: 172800

case "$PAIR" in
  t2a) ASSET=${ASSET:-CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA};;  # Circle testnet USDC SAC
  t2b) ASSET=${ASSET:-CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU};;  # BlendUSDC (USDC:GATALTGT…)
  *) echo "pair must be t2a or t2b"; exit 2;;
esac
# D2.2 (t2b only): our DeFindex vault + buffer policy
DEFINDEX_VAULT=${DEFINDEX_VAULT:-}
IDLE_TARGET=${IDLE_TARGET:-200000000}     # 20 USDC idle
TRANCHE=${TRANCHE:-1000000000}            # 100 USDC per push / pull
MIN_OUT_BPS=${MIN_OUT_BPS:-9900}

addr() { stellar keys address "$1"; }
WASM_LM="$HERE/target/wasm32v1-none/release/lendoor_loan_manager.wasm"
WASM_VAULT="$HERE/target/wasm32v1-none/release/lendoor_vault.wasm"

setres() { local tmp; tmp=$(mktemp); [ -f "$RES" ] || echo '{}' > "$RES"; jq --arg k "$1" --arg v "$2" '.[$k]=$v' "$RES" > "$tmp" && mv "$tmp" "$RES"; }
getres() { jq -r --arg k "$1" '.[$k] // empty' "$RES" 2>/dev/null; }
invoke() { # invoke <source> <contract> <fn> [args...]  -> prints tx hash or result
  local src=$1 id=$2 fn=$3; shift 3
  stellar contract invoke --id "$id" --source "$src" --network "$NET" -- "$fn" "$@"
}
# Admin-gated call. Once scripts/admin-multisig-setup.sh raised the account's
# thresholds to 2, a single signature is rejected (txBAD_AUTH), so this helper
# builds the tx, signs with the master key AND the second signer, then sends.
S2=${S2:-lendoor-t2-signer2}
admin_threshold() { curl -s "https://horizon-testnet.stellar.org/accounts/$(addr "$ADMIN")" | python3 -I -c 'import sys,json; print(json.load(sys.stdin)["thresholds"]["med_threshold"])' 2>/dev/null || echo 1; }
admin_invoke() { # admin_invoke <contract> <fn> [args...]
  local id=$1 fn=$2; shift 2
  if [ "$(admin_threshold)" -ge 2 ]; then
    stellar contract invoke --id "$id" --source "$ADMIN" --network "$NET" --build-only -- "$fn" "$@" \
      | stellar tx simulate --source-account "$ADMIN" --network "$NET" \
      | stellar tx sign --sign-with-key "$ADMIN" --network "$NET" \
      | stellar tx sign --sign-with-key "$S2" --network "$NET" \
      | stellar tx send --network "$NET"
  else
    invoke "$ADMIN" "$id" "$fn" "$@"
  fi
}
view() { local id=$1 fn=$2; shift 2; stellar contract invoke --id "$id" --source "$OPERATOR" --network "$NET" --send=no -- "$fn" "$@" 2>/dev/null | tail -1; }

build() {
  (cd "$HERE" && stellar contract build 2>&1 | grep -E "Wasm File|error" )
  ls -la "$WASM_LM" "$WASM_VAULT"
}

preflight() {
  echo "== preflight $PAIR on $NET =="
  for k in "$ADMIN" "$UNDERWRITER" "$OPERATOR" "$PAUSER" "$FEESINK" "$SEED_PAYER"; do
    stellar keys address "$k" >/dev/null 2>&1 || { echo "!! identity '$k' missing: stellar keys generate --fund --network $NET $k"; exit 1; }
  done
  echo "asset $ASSET: symbol=$(view "$ASSET" symbol) decimals=$(view "$ASSET" decimals)"
  local bal; bal=$(stellar contract invoke --id "$ASSET" --source "$SEED_PAYER" --network "$NET" --send=no -- balance --id "$(addr "$SEED_PAYER")" 2>/dev/null | tail -1 | tr -d '"')
  echo "seed payer $(addr "$SEED_PAYER") balance: $bal (needs >= $SEED)"
  [ "${bal:-0}" -ge "$SEED" ] || { echo "!! fund the seed payer with the asset first"; exit 1; }
}

deploy() {
  echo "== deploy loan-manager (source: operator; the constructor needs no admin signature) =="
  local lm; lm=$(stellar contract deploy --wasm "$WASM_LM" --source "$OPERATOR" --network "$NET" -- \
      --admin "$(addr "$ADMIN")" --underwriter "$(addr "$UNDERWRITER")" --pauser "$(addr "$PAUSER")" \
      --vault "$(addr "$ADMIN")" --upgrade_delay_secs "$DELAY" 2>&1 | tail -1)
  echo "loan-manager: $lm"; setres loanManager "$lm"

  echo "== deploy vault (seed payer signs: pulls $SEED of the asset) =="
  local p; p=$(jq -cn \
    --arg admin "$(addr "$ADMIN")" --arg operator "$(addr "$OPERATOR")" --arg pauser "$(addr "$PAUSER")" \
    --arg usdc "$ASSET" --arg lm "$lm" --arg fee "$(addr "$FEESINK")" --argjson delay "$DELAY" \
    --arg seeder "$(addr "$SEED_PAYER")" --arg seed "$SEED" \
    '{admin:$admin,operator:$operator,pauser:$pauser,usdc:$usdc,loan_manager:$lm,fee_recipient:$fee,upgrade_delay_secs:$delay,seed_payer:$seeder,seed_assets:$seed}')
  local vault; vault=$(stellar contract deploy --wasm "$WASM_VAULT" --source "$SEED_PAYER" --network "$NET" -- --p "$p" 2>&1 | tail -1)
  echo "vault: $vault"; setres vault "$vault"

  echo "== wire: loan-manager.set_vault (admin; 2 signatures if the multisig is already applied) =="
  admin_invoke "$lm" set_vault --vault "$vault" | tail -1
  setres asset "$ASSET"; setres admin "$(addr "$ADMIN")"; setres underwriter "$(addr "$UNDERWRITER")"
  setres operator "$(addr "$OPERATOR")"; setres pauser "$(addr "$PAUSER")"; setres feeRecipient "$(addr "$FEESINK")"
  setres seedPayer "$(addr "$SEED_PAYER")"; setres seed "$SEED"; setres upgradeDelay "$DELAY"; setres deployedAt "$(date -u +%FT%TZ)"
}

strategy() {
  [ -n "$DEFINDEX_VAULT" ] || { echo "DEFINDEX_VAULT not set; skipping strategy wiring"; return 0; }
  local vault; vault=$(getres vault)
  echo "== D2.2: propose strategy $DEFINDEX_VAULT (timelock $DELAY s) =="
  admin_invoke "$vault" propose_strategy --strategy "$DEFINDEX_VAULT" | tail -1
  echo "waiting $DELAY s for the timelock…"; sleep $((DELAY + 5))
  admin_invoke "$vault" execute_strategy | tail -1
  admin_invoke "$vault" set_buffer --idle_target "$IDLE_TARGET" --tranche "$TRANCHE" --min_out_bps "$MIN_OUT_BPS" | tail -1
  setres defindexVault "$DEFINDEX_VAULT"; setres idleTarget "$IDLE_TARGET"; setres tranche "$TRANCHE"; setres minOutBps "$MIN_OUT_BPS"
}

verify() {
  local lm vault; lm=$(getres loanManager); vault=$(getres vault)
  echo "== verify =="
  echo "vault.usdc            = $(view "$vault" usdc)   (expected $ASSET)"
  echo "vault.decimals_offset = $(view "$vault" decimals_offset)"
  echo "vault.total_supply    = $(view "$vault" total_supply)   (expected seed*1000 = $((SEED*1000)))"
  echo "vault.balance_of(self)= $(view "$vault" balance_of --account "$vault")"
  echo "vault.total_assets    = $(view "$vault" total_assets)   (expected $SEED)"
  echo "vault.is_paused       = $(view "$vault" is_paused)"
  echo "vault.get_role(Admin) = $(view "$vault" get_role --role Admin)"
  echo "vault.strategy        = $(view "$vault" strategy)"
  echo "vault.buffer          = $(view "$vault" buffer)"
  echo "lm.get_role(Underw.)  = $(view "$lm" get_role --role Underwriter)"
  echo "lm.upgrade_delay      = $(view "$lm" upgrade_delay)"
  echo "result file: $RES"; cat "$RES"
}

case "$STEP" in
  build) build;;
  preflight) preflight;;
  deploy) preflight; deploy; verify;;
  strategy) strategy; verify;;
  verify) verify;;
  all) build; preflight; deploy; strategy; verify;;
  *) echo "usage: $0 <t2a|t2b> [build|preflight|deploy|strategy|verify|all]"; exit 2;;
esac
echo
echo "NEXT: scripts/admin-multisig-setup.sh apply   (2-of-3 on $ADMIN; do it AFTER all single-sig wiring)"
