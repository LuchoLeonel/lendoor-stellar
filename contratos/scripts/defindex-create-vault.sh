#!/usr/bin/env bash
# Create Lendoor's OWN DeFindex vault on testnet (D2.2, step 0.3).
#
# Why our own vault: DeFindex's public testnet USDC vault is 100 % idle and only
# its manager (Paltalabs) can invest it. With our own vault we hold the manager
# and rebalance-manager roles, invest 100 % into the "USDC Blend Strategy"
# (Blend TestnetV2 reserve, ~85 % utilization on 26/11/2026) and the yield is
# real and visible within hours.
#
# Factory `create_defindex_vault` is permissionless (verified in factory/src/lib.rs
# and via `stellar contract info interface`, 26/11/2026):
#   (roles: Map<u32,Address>, vault_fee: u32, assets: Vec<AssetStrategySet>,
#    soroswap_router: Address, name_symbol: Map<String,String>, upgradable: bool)
#   roles: 0 EmergencyManager, 1 VaultFeeReceiver, 2 Manager, 3 RebalanceManager
#
# Then: a first deposit (>= 1001 stroops; 1000 shares stay locked in DeFindex)
# and ONE `rebalance(Invest)` so `invest=true` deposits allocate from then on.
#
#   ./defindex-create-vault.sh create
#   ./defindex-create-vault.sh seed <amount_stroops>     # first deposit from OPERATOR
#   ./defindex-create-vault.sh invest                     # rebalance: invest all idle into the strategy
#   ./defindex-create-vault.sh show
set -euo pipefail
export NO_COLOR=1
NET=${NET:-testnet}
FACTORY=${FACTORY:-CDSCWE4GLNBYYTES2OCYDFQA2LLY4RBIAX6ZI32VSUXD7GO6HRPO4A32}
ASSET=${ASSET:-CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU}            # BlendUSDC
STRATEGY=${STRATEGY:-CALLOM5I7XLQPPOPQMYAHUWW4N7O3JKT42KQ4ASEEVBXDJQNJOALFSUY}      # USDC Blend Strategy
ROUTER=${ROUTER:-CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD}          # Soroswap testnet router
MANAGER=${MANAGER:-lendoor-t2-admin}       # manager + emergency manager (governance)
OPERATOR=${OPERATOR:-instaward-op}         # rebalance manager (keeper)
FEESINK=${FEESINK:-instaward-feesink}
HERE=$(cd "$(dirname "$0")" && pwd)
RES="$HERE/../result-defindex-$NET.json"
STEP=${1:-show}

addr() { stellar keys address "$1"; }
setres() { local tmp; tmp=$(mktemp); [ -f "$RES" ] || echo '{}' > "$RES"; jq --arg k "$1" --arg v "$2" '.[$k]=$v' "$RES" > "$tmp" && mv "$tmp" "$RES"; }
getres() { jq -r --arg k "$1" '.[$k] // empty' "$RES" 2>/dev/null; }

create() {
  local roles assets names
  roles=$(jq -cn --arg em "$(addr "$MANAGER")" --arg fr "$(addr "$FEESINK")" --arg m "$(addr "$MANAGER")" --arg rm "$(addr "$OPERATOR")" \
          '{"0":$em,"1":$fr,"2":$m,"3":$rm}')
  assets=$(jq -cn --arg a "$ASSET" --arg s "$STRATEGY" '[{address:$a,strategies:[{address:$s,name:"USDC Blend Strategy",paused:false}]}]')
  names='{"name":"Lendoor Idle Buffer USDC","symbol":"LDIBU"}'
  echo "== create_defindex_vault (vault_fee 0, upgradable false) =="
  local out; out=$(stellar contract invoke --id "$FACTORY" --source "$MANAGER" --network "$NET" -- create_defindex_vault \
      --roles "$roles" --vault_fee 0 --assets "$assets" --soroswap_router "$ROUTER" --name_symbol "$names" --upgradable false 2>&1)
  echo "$out" | tail -3
  local id; id=$(echo "$out" | tail -1 | tr -d '"')
  setres defindexVault "$id"; setres asset "$ASSET"; setres strategy "$STRATEGY"; setres createdAt "$(date -u +%FT%TZ)"
  echo "our DeFindex vault: $id"
}

seed() {
  local amt=${2:-1000000}; local id; id=$(getres defindexVault)
  echo "== first deposit $amt from $OPERATOR (invest=false; the vault is idle until the first rebalance) =="
  stellar contract invoke --id "$id" --source "$OPERATOR" --network "$NET" -- deposit \
    --amounts_desired "[\"$amt\"]" --amounts_min "[\"$amt\"]" --from "$(addr "$OPERATOR")" --invest false | tail -2
  show
}

invest() {
  local id; id=$(getres defindexVault)
  local idle; idle=$(stellar contract invoke --id "$id" --source "$OPERATOR" --network "$NET" --send=no -- fetch_total_managed_funds 2>/dev/null | tail -1 | jq -r '.[0].idle_amount')
  echo "== rebalance: Invest $idle into $STRATEGY (rebalance manager = $OPERATOR) =="
  stellar contract invoke --id "$id" --source "$OPERATOR" --network "$NET" -- rebalance \
    --caller "$(addr "$OPERATOR")" --instructions "[{\"Invest\":[\"$STRATEGY\",\"$idle\"]}]" | tail -2
  show
}

show() {
  local id; id=$(getres defindexVault); [ -n "$id" ] || { echo "no vault yet"; exit 0; }
  echo "vault: $id"
  stellar contract invoke --id "$id" --source "$OPERATOR" --network "$NET" --send=no -- get_assets 2>/dev/null | tail -1
  stellar contract invoke --id "$id" --source "$OPERATOR" --network "$NET" --send=no -- fetch_total_managed_funds 2>/dev/null | tail -1
  echo "our shares: $(stellar contract invoke --id "$id" --source "$OPERATOR" --network "$NET" --send=no -- balance --id "$(addr "$OPERATOR")" 2>/dev/null | tail -1)"
}

case "$STEP" in
  create) create;; seed) seed "$@";; invest) invest;; show) show;;
  *) echo "usage: $0 create|seed <stroops>|invest|show"; exit 2;;
esac
