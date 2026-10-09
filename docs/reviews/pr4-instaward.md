# Review PR #4 (instaward/usdc-testnet) — 2026-10-08, esfuerzo alto

12 hallazgos. 10 corregidos; 2 documentados. Ninguno descartado en silencio.

## Corregidos

| # | Hallazgo | Fix |
|---|---|---|
| 1 | 🔴 Payoff TOTAL vía `repay_partial` sobre un préstamo con write-off **descontaba `total_borrows` dos veces** (el LM sólo bloquea parciales en default; el clamp del write-off faltaba) → borrows fantasma negativo, PPS de todos los LPs al piso | Clamp universal + test de regresión (sana EXACTO como el camino de `repay`) |
| 2 | 🔴 `accrue_late` (permissionless) y `apply_payment` **rebobinaban el ancla** si `now` < apertura+1d → el piso de 1 día se cobraba dos veces; griefing gratis contra cualquier borrower fresco | El ancla SOLO avanza; test: ataque a la hora 1 y el total al due sigue exacto |
| 3 | El frontend seguía llamando `vault.repay` — el mismo recálculo temporal que rompe la auth firmada y tiró abajo el par `CA2H4UFG/CDY27BWE` | `stellarRepay` migrado a `repay_partial(preview + colchón)`: tira EXACTO lo firmado, el vuelto vuelve solo |
| 4 | El retry 23505 de la migración era **código muerto**: dentro de la tx, el CREATE fallido aborta todo y el retry moría con 25P02 | SAVEPOINT/ROLLBACK TO: el retry funciona de verdad dentro de la transacción |
| 5 | Fee dust (`full_fee < tenor_days`): el fallback cobraba el fee completo al abrir Y lo devengaba de nuevo → `principal + 2×fee` | Con floor-fallback, el ancla va directo al due; test con P=100 @1%/7d |
| 6 | La "verificación" del script de deploy llamaba un **getter inexistente** con el fallo tragado (`2>/dev/null \|\| true`) — la clase falla-silenciosa de la casa | Getter `usdc()` agregado al vault + el script compara y **sale con error** si no coincide |
| 7 | `DEPLOYMENTS.md` citaba el cross-wiring con los IDs del par DESCARTADO | Corregido al par vigente |
| 8 | El cierre vía `repay_partial` (EL camino de liquidación en vivo) no emitía `repay` → los indexers del topic perdían justamente los cierres reales | Doble evento al cerrar (`repay` + `partrepay`), consistente con `deposit`/`dep_from` |
| 9 | `transition(mismo estado + patch)` descartaba el patch en silencio (un diagnóstico nuevo sobre una fila failed se perdía) | Mismo estado + patch = actualización de datos |
| 10 | El chain-truth conservaba la attestation para pending/failed pero **no para submitting** | El patch viaja también en ese caso |

Más el error propio `InvalidBeneficiary` (el guard usaba `ZeroShares` y mandaba
al operador a debuggear la guarda anti-donación en vez del bridge mal cableado).

## Documentados

| # | Hallazgo | Por qué queda así |
|---|---|---|
| 11 | `repay`/`repay_partial` hacen 3 llamadas cross-contract donde alcanzarían menos (get_loan redundante; principal derivable del retorno de apply_payment) | Optimización de fees/footprint sin cambio de comportamiento: va con el próximo toque del vault, no amerita re-churn ahora |
| 12 | El par del Instaward vivo es anterior a estos fixes de contrato | Su evidencia ya está capturada; TODO par nuevo (D1.1 en adelante) sale con el clamp, las anclas monotónicas, el getter y los eventos dobles. Nota en DEPLOYMENTS |

Gates tras los fixes: contratos **165** (73+92, 4 regresiones nuevas) · cctp
**23/23** · backend **139** · frontend **440** · builds ✓.
