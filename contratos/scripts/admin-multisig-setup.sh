#!/usr/bin/env bash
# Admin multisig for the Tranche 2 contracts (D2.3) — Stellar account thresholds.
#
# The contracts' `admin` role is a plain Stellar account. Soroban honours the
# account's signature thresholds on `require_auth` (address credentials need
# the MEDIUM threshold), so a 2-of-3 admin needs NO contract code:
#   master key weight 1 + two extra signers weight 1, thresholds low/med/high = 2.
#
# Testnet: the three signers are throwaway stellar-cli identities. On mainnet
# they are the founders' hardware keys; the procedure is identical.
#
#   ./admin-multisig-setup.sh identities   # create + fund (friendbot) the 3 identities if missing
#   ./admin-multisig-setup.sh apply        # add signers, then raise thresholds (irreversible with 1 sig!)
#   ./admin-multisig-setup.sh show         # signers + thresholds from Horizon
#   ./admin-multisig-setup.sh demo <CONTRACT_ID> <WASM_HASH>
#        # proof for the video: propose_upgrade signed by ONE key fails (tx_bad_auth),
#        # signed by TWO keys succeeds
set -euo pipefail
export NO_COLOR=1
NET=${NET:-testnet}
ADMIN=${ADMIN:-lendoor-t2-admin}
S2=${S2:-lendoor-t2-signer2}
S3=${S3:-lendoor-t2-signer3}
HORIZON=${HORIZON:-https://horizon-testnet.stellar.org}
STEP=${1:-show}

addr() { stellar keys address "$1"; }

identities() {
  for k in "$ADMIN" "$S2" "$S3" "${PAUSER:-lendoor-t2-pauser}"; do
    if stellar keys address "$k" >/dev/null 2>&1; then echo "exists: $k $(addr "$k")"; else
      stellar keys generate --fund --network "$NET" "$k" >/dev/null && echo "created+funded: $k $(addr "$k")"; fi
  done
}

apply() {
  local a; a=$(addr "$ADMIN")
  echo "== adding signers to $a =="
  stellar tx new set-options --source "$ADMIN" --network "$NET" --signer "$(addr "$S2")" --signer-weight 1 | tail -1
  stellar tx new set-options --source "$ADMIN" --network "$NET" --signer "$(addr "$S3")" --signer-weight 1 | tail -1
  echo "== raising thresholds to 2 (master weight 1) — from now on every admin tx needs 2 signatures =="
  stellar tx new set-options --source "$ADMIN" --network "$NET" --master-weight 1 --low-threshold 2 --med-threshold 2 --high-threshold 2 | tail -1
  show
}

show() {
  local a; a=$(addr "$ADMIN")
  curl -s "$HORIZON/accounts/$a" | python3 -I -c '
import sys,json
d=json.load(sys.stdin)
print("account:", d["account_id"])
print("thresholds:", d["thresholds"])
for s in d["signers"]: print("signer:", s["key"], "weight", s["weight"])'
}

# Two-signature invocation of an admin-gated contract function.
# usage: multisig_invoke <contract> <fn> [args...]
multisig_invoke() {
  local id=$1 fn=$2; shift 2
  stellar contract invoke --id "$id" --source "$ADMIN" --network "$NET" --build-only -- "$fn" "$@" \
    | stellar tx simulate --source-account "$ADMIN" --network "$NET" \
    | stellar tx sign --sign-with-key "$ADMIN" --network "$NET" \
    | stellar tx sign --sign-with-key "$S2" --network "$NET" \
    | stellar tx send --network "$NET"
}

demo() {
  local id=${2:?contract id}; local hash=${3:?wasm hash}
  echo "== 1 signature: expected to FAIL (txBAD_AUTH) =="
  set +e
  stellar contract invoke --id "$id" --source "$ADMIN" --network "$NET" --build-only -- propose_upgrade --new_wasm_hash "$hash" \
    | stellar tx simulate --source-account "$ADMIN" --network "$NET" \
    | stellar tx sign --sign-with-key "$ADMIN" --network "$NET" \
    | stellar tx send --network "$NET"
  set -e
  echo "== 2 signatures: expected to SUCCEED (event upgprop) =="
  multisig_invoke "$id" propose_upgrade --new_wasm_hash "$hash"
}

case "$STEP" in
  identities) identities;;
  apply) apply;;
  show) show;;
  demo) demo "$@";;
  invoke) shift; multisig_invoke "$@";;
  *) echo "usage: $0 identities|apply|show|demo <contract> <wasm_hash>|invoke <contract> <fn> [args]"; exit 2;;
esac
