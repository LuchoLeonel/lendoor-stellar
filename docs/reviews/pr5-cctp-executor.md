# Review PR #5 — D1.1: executor CCTP (Base Sepolia → Iris → mint → vault)

**Fecha:** 2026-10-08 · **Alcance:** `backend/src/cctp/{cctp-chains,cctp-message,evm-burn,stellar-mint,cctp-executor}.ts`, `scripts/cctp-demo.ts`, cambios a `cctp-transfer.ts`/`iris-client.ts` · **Método:** 10 ángulos, sin asunciones; cada claim verificado contra código, contra la referencia (lumenline, Apache-2.0) o contra la cadena.

## Verificaciones externas (no asumidas)

| Qué | Cómo se verificó |
|---|---|
| `mint_and_forward(message: Bytes, attestation: Bytes)` | `stellar contract info interface --id CA66Q2WF… --network testnet` (2026-10-08) — verbatim |
| `is_nonce_used(nonce: BytesN<32>) -> bool` | ídem, sobre el MessageTransmitter `CBJ6MT…` |
| Direcciones CCTP (Stellar testnet + Base Sepolia) | lumenline `chains.ts` (ellos las cruzaron contra docs de Circle y bytecode on-chain, VERIFIED.md §1.6/§3b-c) |
| `usdcSac` testnet == settlement asset del par Instaward | `CBIELTK6…DAMA` en ambos — grep contra `contratos/DEPLOYMENTS.md` |
| Layout del mensaje V2 (148+228+hook) | guía técnica de Circle vía lumenline, que lo cruzó con `decodedMessage` de burns reales |

## Hallazgos corregidos

1. **🔴 Modo vault: crash post-mint marcaba `delivered` sin depositar.** Si el proceso moría entre `mint_and_forward` y `deposit_from`, al reiniciar `is_nonce_used=true` y el atajo de idempotencia cerraba la fila: USDC en el relayer, usuario sin shares. Fix: `CctpTransfer.depositTxHash` registra el depósito; el atajo ahora ejecuta `deposit_from` si falta ese registro (tests: crash-post-mint → solo `deposit_from`, jamás re-mint; replay con depósito registrado → cero submits). *Ventana residual documentada:* crash entre el submit del `deposit_from` y la persistencia de la fila — misma clase de ventana, pero sin oráculo on-chain que la cierre (el vault no conoce el nonce CCTP). Aceptada para el demo; el fix definitivo es un memo de nonce en el propio `deposit_from`.
2. **🔴 `assertForwarderFields(body, …)` explotaba en runtime.** `destinationCaller` vive en el *header*, no en el body; ts-jest (transpile-only) no lo atrapa. Fix + comentario; el typecheck del CI (`tsc --noEmit`) sí lo atrapaba.
3. **🟡 Tests duplicados por importar un `.spec` desde otro.** Importar `cctp-message.spec` re-registraba sus describes en el suite importador (el "80 tests" era en realidad 62 + 18 duplicados). Fix: `cctp-test-helpers.ts` (no-spec) con `buildTestMessage`/`FORWARDER_32`/`TEST_G_ADDR`.
4. **🟡 `u32` de la referencia parsea negativo** con el bit alto encendido (OR de JS es int32 con signo). Fix `>>> 0` + test con dominio `0x80000001`. En la práctica los dominios reales son chicos; igual es incorrecto heredarlo.
5. **🟡 La fila no guardaba el `message` crudo de Iris** — es el PRIMER argumento de `mint_and_forward`; sin él, deliver no puede armar el mint. Fix: `CctpTransfer.message`, threading por `irisStatusFromHttp` → `reconcile` en todos los caminos (incluido chain-truth).
6. **🟢 `trustline` del demo imprimía PENDING** sin confirmar. Ahora espera SUCCESS/FAILED.
7. **🟢 Línea borrador rota en `cmdDeliver`** (`vaultContractId` con una expresión sin sentido) — reemplazada por la validación real: modo vault ⇒ `CCTP_VAULT_ID` obligatoria.

## Decisiones documentadas (no son bugs)

- **`deliver()` tira (no `failed`) ante fila sin `message`/`attestation`:** una anomalía transitoria de Iris no debe volverse terminal; el worker reintenta el poll y el próximo `complete` trae el message.
- **Standard Transfer (finality 2000, `maxFee 0`):** sin fee on-chain de Circle; la espera de minutos es aceptable para el demo. Fast (1000) exigiría `maxFee > 0`.
- **El modo (directo/vault) lo decide el hookData, nunca un input aparte:** `forwardRecipient == beneficiary` → directo; `== relayer` → vault; cualquier otro → `failed` ANTES de gastar fee (el mint le daría la plata a un tercero).
- **La guarda anti-fondos-varados corre en las DOS puntas:** al armar el burn en EVM (sobre los mismos bytes que se encodean) y al recibir el mensaje de Iris (un burn armado por otro puede llegar igual al poller). Circle: un `mintRecipient` distinto del forwarder deja los fondos "permanently stuck".
- **`is_nonce_used` por simulación** (lectura, cero fee) con el relayer como viewer.
- **Claves del demo:** SOLO claves de testnet creadas para esto, por env. Jamás una clave que haya tocado prod (regla post-incidente 7702).

## Gates

- `src/cctp`: **64 tests** (conteo real, sin duplicados) ✅
- backend completo: **179/179** ✅
- `tsc --noEmit`: **0 errores** ✅
