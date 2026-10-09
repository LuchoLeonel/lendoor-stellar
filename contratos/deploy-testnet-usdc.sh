#!/usr/bin/env bash
# Instaward — deploy reproducible del par Lendoor en Stellar TESTNET con USDC NATIVO.
#
# Entregable D2 del SOW (Instawards-SOW-Lendoor-testnet): vault + loan-manager
# deployados con el SAC real de USDC de testnet como settlement asset, en lugar
# del SAC de XLM que usaba el prototipo del hackathon.
#
# Requisitos: stellar-cli >= 27 (testnet corre protocolo 29), target rust
# wasm32v1-none, y tres identidades de testnet fondeadas por friendbot:
#   stellar keys generate <nombre> --network testnet --fund
#
# Uso:
#   OP=instaward-op FEESINK=instaward-feesink ./deploy-testnet-usdc.sh
# Nunca usa claves de prod: las identidades son locales y descartables.
set -euo pipefail

NETWORK="${NETWORK:-testnet}"
OP="${OP:-instaward-op}"                      # owner + operador (identidad local del CLI)
FEESINK="${FEESINK:-instaward-feesink}"       # cobra el 5% de fee de protocolo
# USDC nativo de TESTNET (verificado on-chain: symbol USDC, decimals 7).
# En mainnet seria CCW67TSZ... — NUNCA mezclar.
USDC="${USDC:-CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA}"

OP_ADDR=$(stellar keys address "$OP")
FEESINK_ADDR=$(stellar keys address "$FEESINK")
echo "operador:      $OP_ADDR"
echo "fee recipient: $FEESINK_ADDR"
echo "usdc:          $USDC"

echo "— build —"
stellar contract build >/dev/null
LM_WASM=target/wasm32v1-none/release/lendoor_loan_manager.wasm
VAULT_WASM=target/wasm32v1-none/release/lendoor_vault.wasm

# El huevo y la gallina (ver DEPLOYMENTS.md): primero el loan-manager con un
# vault placeholder, despues el vault apuntando al LM, y al final set_vault.
echo "— deploy loan-manager (vault placeholder) —"
LM_ID=$(stellar contract deploy --wasm "$LM_WASM" --source-account "$OP" --network "$NETWORK" \
  -- --owner "$OP_ADDR" --vault "$OP_ADDR" 2>/dev/null | tail -1)
echo "loan-manager: $LM_ID"

echo "— deploy vault (usdc nativo) —"
VAULT_ID=$(stellar contract deploy --wasm "$VAULT_WASM" --source-account "$OP" --network "$NETWORK" \
  -- --owner "$OP_ADDR" --usdc "$USDC" --loan_manager "$LM_ID" --fee_recipient "$FEESINK_ADDR" 2>/dev/null | tail -1)
echo "vault: $VAULT_ID"

echo "— set_vault —"
stellar contract invoke --id "$LM_ID" --source-account "$OP" --network "$NETWORK" --send=yes \
  -- set_vault --vault "$VAULT_ID" >/dev/null
echo "wiring OK"

echo "— verificacion (review PR #4: antes llamaba un getter inexistente y el fallo se tragaba) —"
GOT_USDC=$(stellar contract invoke --id "$VAULT_ID" --source-account "$OP" --network "$NETWORK" -- usdc 2>&1 | tail -1 | tr -d '"')
if [ "$GOT_USDC" = "$USDC" ]; then
  echo "vault.usdc VERIFICADO on-chain: $GOT_USDC"
else
  echo "🔴 VERIFICACION FALLO: vault.usdc='$GOT_USDC' esperado='$USDC'"
  echo "   (un wasm anterior al getter usdc() tambien cae aca: verificar A MANO)"
  exit 1
fi

cat <<RESUMEN

=== PAR INSTAWARD (testnet, USDC nativo) ===
LOAN_MANAGER=$LM_ID
VAULT=$VAULT_ID
OPERATOR=$OP_ADDR
FEE_RECIPIENT=$FEESINK_ADDR
USDC=$USDC
explorer: https://stellar.expert/explorer/testnet/contract/$VAULT_ID

SIGUIENTE (a mano, en orden):
 1. USDC de testnet del faucet de Circle al operador (deposito semilla) y al borrower.
 2. SEED DEPOSIT del protocolo ANTES de anunciar (regla anti-donacion, ver DEPLOYMENTS.md).
 3. set_user_risk + set_loan_offer al borrower, borrow_with_term, repay.
RESUMEN
