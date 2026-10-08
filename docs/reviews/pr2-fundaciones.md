# Review PR #2 (scf45/fundaciones) — 2026-10-08, esfuerzo alto

11 hallazgos. 6 corregidos en esta rama; 5 documentados con su porqué (ninguno
descartado en silencio).

## Corregidos

| # | Hallazgo | Fix |
|---|---|---|
| 1 | `toUnits('-0.5')` devolvía **+500000** (whole `'-0'` → 0n y la fracción positiva se sumaba), saltando los guards de monto ≤ 0 | Signo explícito + 4 tests (`amount-units.spec.ts`) |
| 2 | `normalizeWalletOrNull` TIRABA `BadRequestException` en vez de devolver null → el polling de `statusForWallet` recibía 400 en loop con una address malformada | El helper honra su contrato: try/catch → null |
| 3 | El guard de decimales al boot fallaba ABIERTO ante cualquier error — justo en los deploys mal configurados que debía atrapar | Re-chequeo en background con backoff hasta validar; mismatch en vivo = `process.exit(1)` (igual que al boot) |
| 4 | Ventana de carrera en la migración del unique: una instancia vieja (blue-green/zombis, ya pasó en este proyecto) podía commitear un duplicado entre el dedup y el `CREATE UNIQUE INDEX` → crash-loop al boot | Retry acotado (3 intentos): si el CREATE pega 23505, re-corre el dedup y reintenta |
| 5 | `VaultActivityList` (subgraph EVM, formato /1e6) se renderizaba en el lend de modo Stellar: eventos de Celo a 6 dec al lado de cifras Soroban a 7 | Oculto en modo Stellar hasta que exista la fuente Soroban (el indexer del award) |
| 6 | `DEFAULT_CREDIT_LIMIT_USDC = toUnits(1)` triplicada en tres servicios — una futura suba del piso editaría dos y la tercera seguiría regalando el valor viejo | Una sola copia exportada desde `amount-units` |

## Documentados (no corregidos acá, con el porqué)

| # | Hallazgo | Por qué queda así |
|---|---|---|
| 7 | TOKEN_DECIMALS 6→7 "reinterpreta" valores previos 10× más chicos | La cadena SIEMPRE fue de 7 dec: los valores escritos con `toUnits(x, 6)` están 10× subdeclarados **on-chain mismo** — el fix expone la verdad, no la crea. Remedio correcto = **re-push operativo de límites** (`set_user_risk`) a los borrowers existentes del par del award tras el deploy, NO un rescale ciego de DB. Agregado al procedimiento de deploy |
| 8 | Build-args de Dockerfile degradan en silencio si el pipeline no los pasa | Tradeoff aceptado: secretos fuera del fuente > conveniencia. El warning vive en el propio Dockerfile y el runbook del deploy lista los args obligatorios. (Clase de falla ya documentada del proyecto) |
| 9 | 4ª copia del criterio de modo (`process.env` en amount-units) | Derivarlo de `env.ts` crea ciclo de imports (env → sorobanConfig → amount-units). Anotado para un refactor de config dedicado |
| 10 | Scaffolding de simulación duplicado (`simulateUsdcSacDecimals` vs `simulateLoanManagerCall`) | Cleanup diferido al próximo toque de `sorobanConfig` — extraer `simulateContractCall` genérico |
| 11 | CTE de dedup ejecutado dos veces en la migración | Mismo tx ⇒ snapshot y NULLeo son consistentes; costo de doble scan asumido una única vez al migrar. Nota de mantenimiento: no copiar el patrón fuera de una tx |

Gates tras los fixes: backend **13 suites / 129 tests**, frontend **440**, ambos builds ✓.
