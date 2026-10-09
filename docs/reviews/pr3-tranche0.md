# Review PR #3 (scf45/tranche-0) — 2026-10-08, esfuerzo alto

11 hallazgos sobre el código real. 9 corregidos; 2 resueltos por la estructura
del stack (documentados). Ninguno descartado en silencio.

## Corregidos (los dos primeros eran de los que queman plata)

| # | Hallazgo | Fix |
|---|---|---|
| 1 | Iris responde **200 con `status: pending_confirmations`** y attestation null o el sentinel literal `"PENDING"` — el mapeo lo trataba como `complete` (mint con attestation basura) o como `error` terminal (fondos ya quemados marcados failed) | `irisStatusFromHttp` consulta `body.status`: complete SOLO con status complete + attestation real ≠ "PENDING"; 200-no-listo = pending |
| 2 | 401/403 (credencial NUESTRA vencida) y 4xx desconocidos → `failed` terminal para transferencias con el USDC ya quemado en origen | Infra-4xx = `backoff`, jamás terminal desde polling; `error` reservado a 400 con body de error explícito |
| 3 | `deposit_from` aceptaba al **propio vault como beneficiary** → shares no transferibles + sin self-redeem = fondos bloqueados para siempre (el default plausible de un bridge mal cableado) | Guard de una línea + test; sin pull de fondos al rechazar |
| 4 | El no-op de mismo-estado **pisaba el patch**: una re-submisión con mintTxHash nuevo dejaba al poller mirando el tx muerto para siempre | `submitting→submitting` es arista legal con patch aplicado |
| 5 | `failed` excluido del chain-truth: una fila mal marcada quedaba failed con la plata ya entregada; y el doc contradecía la unicidad del nonce ("fila nueva con el mismo nonce") | `failed→delivered` vía nonce consumido; doc corregido: el nonce es único, failed se REVIVE |
| 6 | El walk del chain-truth descartaba la attestation que Iris trajo en el mismo poll → filas delivered sin attestation ni mint hash | El patch viaja por el walk |
| 7 | `attempts` declarado como contador de retries y jamás incrementado | `reconcile` cuenta cada poll en espera |
| 8 | 429 con backoff hardcodeado de 5 s y sin forma de pasar el `Retry-After` real de Circle | Firma extendida: `retryAfterSeconds` passthrough |
| 9 | `lastError` nunca se limpiaba: una entrega sana arrastraba "tx timeout" viejo y los dashboards la reportaban errada | Avanzar limpia lastError salvo patch explícito |

Extra del mismo lote: `dep_from` emitía un topic distinto a `deposit`, así que
todo indexer suscripto a depósitos se perdía los inflows del bridge → ahora
**doble evento** (`deposit` con la forma de LP + `dep_from` con el detalle).

## Resueltos por la estructura del stack (documentados)

| # | Hallazgo | Resolución |
|---|---|---|
| 10 | El vault-client de ESTA rama no expone `deposit_from` (la regeneración de bindings vive en la rama del PR #4) | Los PRs se mergean en cadena #2→#3→#4; el tip ya lo tiene (commit `f5f23374`). No se cherry-pickea para no duplicar historia |
| 11 | (meta) El intento anterior de este review se gastó en el working tree sucio — la spec privada contaminaba el diff | La spec se movió FUERA del repo; árbol limpio verificado antes de re-correr |

⚠️ **Nota de deploy:** el par del Instaward vivo en testnet (`CCXUEBC3…`) es
ANTERIOR al guard de beneficiary y al doble evento — su ceremonia de evidencia
ya está capturada y no se re-deploya por esto; todo par NUEVO (el de D1.1 en
adelante) sale con ambos.

Gates tras los fixes: cctp spec **23/23** · backend **138** · contratos
**73 + 88** (test nuevo del guard) · builds ✓.
